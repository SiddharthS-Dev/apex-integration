# Architecture

Written for: engineers maintaining or extending the SlidesVault Dropbox integration.

## The shape of it

The browser never talks to Dropbox. Every Dropbox operation — authorization,
listing, download, preview, thumbnail, rename — goes through the backend, which
holds the only credential and applies the application's own authorization first.

```
                         ┌─────────────────────┐
                         │      ADMIN UI       │
                         │  Dropbox Settings   │
                         └──────────┬──────────┘
                                    │  session cookie (http-only)
                                    v
                         ┌─────────────────────┐
                         │   Express API       │  RBAC, rate limits, CORS
                         └──────────┬──────────┘
                   ┌────────────────┼────────────────┐
                   v                v                v
           DropboxAuthService   SyncService    ContentService
                   │                │                │
                   │                v                │
                   │         StorageProvider  ◄───────┘   (provider-neutral)
                   │                │
                   │                v
                   └──────► DropboxStorageProvider
                                    │
                                    v
                            DropboxClient          (the only endpoint names)
                                    │
                                    v
                          DropboxRequestExecutor   (auth, retry, backoff)
                                    │
                                    v
                              Dropbox API
```

Supporting services sit beside, not inside, that stack:
`ContentExtractionService`, `TitleResolver`, `DocumentAnalysisService`,
`DropboxThumbnailService`, `AuditService`, `SyncScheduler`, `Metrics`.

## The layers, and why each one exists

| Layer | File | Why it is separate |
|---|---|---|
| Composition root | `src/container.js` | Every dependency is wired in one place. No service reaches for a singleton, so the whole stack can be built against an in-memory database and a fake Dropbox. |
| Auth | `integrations/dropbox/DropboxAuthService.js` | One owner of the credential lifecycle. Nothing else knows how a token is obtained. |
| Executor | `integrations/dropbox/DropboxRequestExecutor.js` | One choke point for retries, backoff, timeouts and metrics. A policy change is one edit, not forty. |
| Client | `integrations/dropbox/DropboxClient.js` | The only file that names a Dropbox endpoint. |
| Provider | `domain/storage/StorageProvider.js` | The sync engine is written against this, not against Dropbox. |
| Adapter | `integrations/dropbox/DropboxStorageProvider.js` | The last file that mentions `rev`, `path_lower` or `get_thumbnail_v2`. |
| Services | `integrations/dropbox/Dropbox*Service.js` | One responsibility each: sync, content, folders, thumbnails, rename, health. |
| Content | `services/content-extraction/` | Knows file formats and nothing else. No AI, no Dropbox. |
| AI | `services/document-analysis/`, `services/title-resolution/` | Behind an interface, so it can be swapped, disabled or stubbed. |

## Adding a storage provider

The reason the abstraction is there: OneDrive, SharePoint, Google Drive, S3.

1. Implement `StorageProvider` (ten methods, all documented in the interface).
2. Translate that provider's metadata into `FileMetadata`.
3. Wire it in `container.js`:

```js
const provider = new OneDriveStorageProvider({ client, logger });
```

Nothing in `DropboxSyncService`, `ContentExtractionService`, `TitleResolver` or
the routes changes. The sync engine does not know which provider it is walking.

## Request flow: every Dropbox call

```
request
  ├─ get a valid access token        cached in memory, refreshed on demand
  ├─ add Dropbox-API-Path-Root       team space, on path-addressing endpoints only
  ├─ execute
  │   ├─ 200                    → return
  │   ├─ 401 expired token      → refresh once, replay once
  │   ├─ 401 missing_scope      → fail fast, naming the scope
  │   ├─ 422 invalid_root       → store the new namespace, replay once
  │   ├─ 429                    → honour Retry-After, else backoff, retry
  │   ├─ 5xx                    → backoff, retry
  │   ├─ network                → backoff, retry
  │   └─ other                  → classified error, no retry
  └─ bounded by DROPBOX_MAX_RETRIES; never an unbounded loop
```

Two of those are worth their own note, because both look like something they
are not:

- **401 is overloaded.** Dropbox answers it both for an expired token and for a
  permission that was never granted. Treating the second as the first sends an
  admin round a reconnect loop that cannot help, so `missing_scope` is
  classified separately and names the scope.
- **422 `invalid_root` is recoverable.** It means the stored team-space
  namespace is stale, and the response carries the correct one. The executor
  stores it and replays, so a team reorganization heals itself.

## Sync pipeline

```
list_folder(root, recursive)          paginated, cursor-followed, never buffered whole
  │
  ├─ revision unchanged & title fine  → skip (no download, no AI, no thumbnail)
  │
  └─ new / changed / generic title / failed last time
       ├─ thumbnail   Dropbox render, cached by (file id, revision)
       ├─ download    only if under MAX_FILE_SIZE and an extractable type
       ├─ extract     pptx → slide XML + slide images; pdf → text + /Title; html → visible text
       ├─ title       metadata → first line → AI text → AI vision → filename
       ├─ classify    domain, tags, keywords, objectives, summary
       └─ upsert by (provider, external_id)
  │
  ├─ files no longer in Dropbox → status = archived (never deleted)
  └─ one SyncLog row with the full tally
```

Concurrency is a bounded worker pool (`DROPBOX_MAX_CONCURRENT_FILES`). One bad
file fails alone; the run reports `197 processed, 3 failed` and carries on.

## Source of truth

| Layer | Role |
|---|---|
| Dropbox | The files. The only authority on what exists and what it contains. |
| `stored_file` | Indexed metadata and application state. Rebuildable by a full resync. |
| `data/objects` | Derived cache: thumbnails, rendered previews. Deletable at any time. |
| AI fields | Derived intelligence. Regenerated on demand. |

Confusing these is how integrations rot. The catalog is never the authority on
a file's existence, and a cached preview is never the authority on its content.

## Concurrency and multi-instance

Two independent mechanisms, because they solve different problems:

- **In-process** — `SingleFlight` coalesces concurrent token refreshes so three
  simultaneous requests mint one token, and the other two reuse it.
- **Cross-instance** — `advisory_lock` rows in the shared database, each with an
  expiry so a killed process cannot hold a lock forever. Used for the sync run,
  the token refresh and the bulk rename.

With three instances behind a load balancer, all three tick the scheduler. Two
of them take the lock, fail, and return "already running". That is the design,
not a race.

## Restart resilience

Nothing about the connection lives in memory. On start the server:

1. validates its configuration and refuses to start if it is wrong;
2. migrates the database;
3. marks abandoned `running` sync rows as failed;
4. resets a `sync_status` of `running` that no live run owns;
5. listens, then starts the scheduler.

The refresh token is in the database, encrypted. A restart, a redeploy, a
container rebuild and a server reboot are all invisible to the Dropbox
connection.

## Testing seams

Three, and they are why the suite runs in under two seconds with no network:

- `fetchImpl` — the fake Dropbox is injected into the auth service and the
  executor, so the production code path is what runs.
- `aiProvider` — a stub replaces Claude.
- `DB_FILE=:memory:` — a real schema, a real SQL engine, no files.
