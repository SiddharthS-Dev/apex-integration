# Dropbox integration audit

Scope: the three APEX apps that read Dropbox — **Academia** (playbooks, meeting transcripts, category
sources), **SlidesVault** and **Showcase**. This audit was completed before any code was changed; the
findings below describe the code as it was, and the "Status" column says what has been done since.

## How each app talks to Dropbox

| | Academia | SlidesVault | Showcase |
|---|---|---|---|
| Client | Raw `fetch` (`apps/api/src/dropbox/client.js`), no SDK | Provider class (`integrations/dropbox/`) | `createDropboxClient` (`apps/api/src/dropbox/`) |
| Auth | OAuth 2 code flow, `token_access_type=offline`, one-time CSRF state (SHA-256 stored, 10 min TTL) | OAuth 2, refresh token | OAuth 2, refresh token |
| Refresh token at rest | AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) | AES-256-GCM | AES-256-GCM (`ENCRYPTION_KEY`) |
| Access token | In memory only, minted from the refresh token, retried once on 401 | In memory | In memory |
| Connections | Several: `playbooks`, `meetings`, `source:<category>` (AsyncLocalStorage `withDropboxAccount`) | One | One |
| Team spaces | `Dropbox-API-Path-Root` with the root namespace, self-healing on `invalid_root` | — | — |
| Change detection | Full listing each sync, compared by file id + `rev` / `content_hash` | Full listing, by revision | Full listing, by revision |
| Endpoints | `list_folder(+/continue)`, `get_metadata`, `download`, `users/get_current_account`; now also `get_space_usage`, `upload`, `upload_session/*` | `list_folder`, `get_thumbnail`, `download`, `get_temporary_link` (admin download only) | `list_folder`, `download`, thumbnails |

Every file is identified by its **Dropbox file id** (`id:…`) plus revision. File names and paths are
display data only and are refreshed on each sync.

## Where file bytes went (Academia, before the change)

`files/playbookSource.js → loadPlaybookBytes(record)` was the single place that fetched a Dropbox file.
It **always wrote a permanent copy** into the object store (`data/objects/<shard>/<sha256(dropbox,id,rev,source)>`)
and nothing ever deleted it (`deleteObject` had no callers). Callers:

| Caller | Why it downloaded | Problem |
|---|---|---|
| `sync/pipeline.js` (new and changed playbooks) | Pre-download "so extraction is fast" | Downloaded even with `AUTO_EXTRACT_ON_SYNC=false` — sync was not metadata-only |
| `pipeline/processPlaybookExtract.js` | Text extraction | Copy kept forever, also for old revisions |
| `pipeline/processMeeting.js` | Transcript parsing | Same |
| `GET /api/playbooks/:id/content` | Admin preview / download | First view of any file stored a full copy |
| `GET /api/meetings/:id/content` | Transcript preview | Same |

Consequences (measured, see `APEX_STORAGE_CONSUMPTION_REPORT.md`): 226 Dropbox copies, 1,620 MB, of which
192 files / 1,317.5 MB belonged to playbooks that had since been deleted or replaced by a newer revision.

## Findings

| # | Finding | Severity | Status |
|---|---|---|---|
| A1 | Every Dropbox file touched was copied permanently to the server | High (storage) | **Fixed** — copies are temporary by default (`DROPBOX_SOURCE_CACHE=temporary`) |
| A2 | Sync downloaded file bytes even when extraction was off | High (bandwidth, storage) | **Fixed** — sync is metadata-only unless `AUTO_EXTRACT_ON_SYNC=true` |
| A3 | Copies of deleted records and old revisions were never removed | High (storage) | **Fixed** — `storage/storage.js` classifies them; clean-up removes them (dry run first) |
| A4 | Previews downloaded the whole file to disk before serving | Medium | **Fixed** — streamed from Dropbox with Range passthrough |
| A5 | Re-running extraction on an unchanged revision downloaded and parsed again | Medium (time, AI cost downstream) | **Fixed** — skipped when `extracted_revision` matches; `force` overrides |
| A6 | No visibility of what is stored or why | Medium | **Fixed** — AI Studio → Storage & Dropbox |
| A7 | Render and Piper temp dirs in `os.tmpdir()` with ad-hoc cleanup; a crash left them behind | Low | **Fixed** — `files/tempStore.js` (owner file, abandoned-dir sweep) |
| A8 | PPTX documents could not be processed | Low (feature) | **Fixed** — slides + speaker notes extracted |
| A9 | Images / audio / video / legacy Office files failed with a generic error | Low | **Fixed** — clear 415 messages |
| A10 | Generated videos could only live on the APEX server | Feature | **Added** — optional upload to Dropbox |
| A11 | Full listing on every sync (no `list_folder` cursor) | Low (API calls) | Open — recommendation R1 |
| S1 | SlidesVault: preview-cache retention ran only when scheduled sync was on | Medium | **Fixed** — daily sweep always runs |
| S2 | SlidesVault: a failed `putBuffer` left a `.tmp` file | Low | **Fixed** |
| S3 | SlidesVault: `invalidate` removes only the current revision's derivatives | Low | Covered by the TTL sweep (S1) |
| W1 | Showcase: derived cache had no TTL — old revisions accumulated forever | Medium | **Fixed** — `OBJECT_CACHE_TTL_HOURS` (default 14 days), daily sweep |
| W2 | Showcase: a failed `put` left a `.tmp` file | Low | **Fixed** |
| W3 | Showcase: log redaction is by key name only | Low | Open — see `DROPBOX_SECURITY_REVIEW.md` |
| W4 | Showcase: guest access on by default (`GUEST_ENABLED=true`) | Info | Unchanged (product decision) |

## Open recommendations

- **R1** — Use `list_folder` cursors (`list_folder/continue` with a saved cursor, or `list_folder/longpoll`)
  so a sync only fetches what changed. Not done here: the full listing is metadata-only and cheap at the
  current size (hundreds of files), and the change touches move/delete detection in three apps.
- **R2** — Webhooks instead of polling for near-real-time updates (needs a public HTTPS endpoint).
- **R3** — Showcase: value-based log redaction (bearer-token pattern), as Academia's logger does by key.
