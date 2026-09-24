# Deployment

Written for: whoever stands this up and keeps it running.

## 1. Create the Dropbox app

At <https://www.dropbox.com/developers/apps>:

1. **Create app** → *Scoped access* → *Full Dropbox* (or *App folder*, if you
   are content to sync only `/Apps/<your app>`).
2. **Permissions** tab — tick these and press **Submit**. The list is derived
   from the endpoints the code actually calls; see the table below.

   | Scope | Required? | What stops working without it |
   |---|---|---|
   | `account_info.read` | Yes | Connecting at all — the account name/email lookup and the connection test |
   | `files.metadata.read` | Yes | Folder browsing and the whole sync |
   | `files.content.read` | Yes | Downloads, previews, thumbnails, title extraction |
   | `files.content.write` | Only for rename | The bulk rename. Leave it off and set `DROPBOX_ALLOW_RENAME=false` for a strictly read-only integration |

   Nothing else is needed. In particular `files.metadata.write`,
   `sharing.*` and the `team_*` scopes are not used.

   **Permissions are granted at authorization time.** Changing them later does
   nothing to an existing connection — you must press **Reconnect** in Dropbox
   Settings so a new authorization is issued with the new scopes.
3. **Settings** tab — under **Redirect URIs**, add the value the Dropbox
   Settings page shows, exactly. It must match character for character.
   - local: `http://localhost:4000/api/dropbox/oauth/callback`
   - production: `https://api.example.com/api/dropbox/oauth/callback`
4. Copy the **App key** and **App secret**.

### Which endpoint needs which scope

| Scope | Endpoints this code calls |
|---|---|
| `account_info.read` | `users/get_current_account` |
| `files.metadata.read` | `files/list_folder`, `files/list_folder/continue`, `files/get_metadata` |
| `files.content.read` | `files/download`, `files/get_preview`, `files/get_thumbnail_v2`, `files/get_temporary_link` |
| `files.content.write` | `files/move_v2` (rename only) |
| — none — | `oauth2/token`, `auth/token/revoke` |

`DropboxClient` also exposes `delete`, `createFolder`, `search` and
`getSpaceUsage`. No route or service calls them, so they need no scope; if you
ever wire one up, revisit this table.

### If you get a scope wrong

Dropbox answers a missing permission with HTTP 401 — the same status as an
expired token. The error classifier tells them apart and names the scope, so
the admin sees:

> The Dropbox app is missing the "files.content.write" permission. Enable it in
> the Dropbox App Console, press Submit, then reconnect Dropbox so the new
> permission is granted.

rather than being sent round a reconnect loop that cannot help.

### Dropbox Business / team spaces

Supported natively. A team member has two namespaces — their personal home
folder and the team space — and the API operates in the home namespace unless
told otherwise. At authorization time the server reads `root_info` from
`users/get_current_account` and stores the account's root namespace; every
namespace-aware call then carries

```
Dropbox-API-Path-Root: {".tag":"root","root":"<root_namespace_id>"}
```

so the folder browser starts at the **team space root** and a library there is
reachable without anyone mounting it.

Consequences worth knowing:

- **Paths become team-space-relative.** `/Company/Decks` means that path in the
  team space, not inside the member's folder. The member's own folder appears at
  the `home_path` the status endpoint reports, e.g. `/Avery Raman`.
- **The `root` variant, not `namespace_id`.** It makes Dropbox verify the id is
  still the account's root. If a team reorganization changes it, Dropbox answers
  422 with the correct value, the server stores it and replays the request — so
  a reorganization heals itself instead of breaking every sync.
- **`GET /api/dropbox/status`** reports `team_space`, `root_namespace_id`,
  `home_namespace_id` and `home_path`.

#### Upgrading an existing connection

A connection made before this feature has no stored namespace, and keeps its old
home-namespace behaviour. That is deliberate: enabling it silently would
reinterpret every stored path against a different root, and a working sync would
start pointing somewhere else.

To switch a team account over, press **Reconnect** in Dropbox Settings, then
re-select the sync folder — the browser will now show the team space.
`POST /api/dropbox/test` says whether this applies to you:

```json
{ "ok": true, "teamSpaceAvailable": true, "teamSpaceEnabled": false,
  "hint": "This account has a Dropbox Business team space. Reconnect Dropbox to browse and sync it directly…" }
```

#### Team admin allow-listing

A Dropbox Business admin may have restricted third-party apps
(**Admin console → Settings → Third-party apps**). Until SlidesVault is
allow-listed there, a team member's authorization fails no matter how the app is
configured — so confirm this **before** debugging anything else on a Business
account.

## 2. Configure

```bash
cd apps/api
cp .env.example .env
npm install
npm run keygen          # prints DROPBOX_TOKEN_ENCRYPTION_KEY=…
```

Put the key, the app key and the app secret in `.env`, then set the first
administrator:

```
BOOTSTRAP_ADMIN_EMAIL=you@example.com
BOOTSTRAP_ADMIN_PASSWORD=a-password-of-at-least-ten-characters
```

That account is created on first start only, and only if it does not already
exist. Remove the two lines afterwards.

Every setting is documented in `.env.example`. The ones worth deciding
deliberately:

| Variable | Why you would change it |
|---|---|
| `DROPBOX_SYNC_INTERVAL_MINUTES` | How fresh the library needs to be against how much Dropbox traffic you want. |
| `DROPBOX_MAX_CONCURRENT_FILES` | Raise for a faster first sync; lower if you hit Dropbox rate limits or AI quota. |
| `DROPBOX_MAX_FILE_SIZE_MB` | Files above this are indexed by metadata only, never buffered. |
| `AI_ENABLED` | Off means deterministic titles only — no Claude calls, no API key needed. |
| `DROPBOX_ALLOW_RENAME` | Off means the integration is strictly read-only against Dropbox. |
| `DROPBOX_ALLOW_ADMIN_DOWNLOAD` | Off means no direct Dropbox link is ever minted. |

## 3. Run

```bash
npm start            # migrates, then listens on PORT
npm run dev          # the same, with --watch
npm test             # 143 tests, no network needed
```

Then, in the browser app: sign in as the admin, open **Dropbox Settings**,
press **Connect Dropbox**, approve, pick a folder, and press **Run sync now**.
After that the scheduler keeps it current.

## 4. Point the frontend at it

In the repository root:

```
VITE_API_BASE_URL=http://localhost:4000
```

`src/api/base44Client.js` picks the backend from that variable. With it set,
the app uses this server for everything; with it unset it falls back to Base44
or to the bundled local demo backend.

**Serve the app and the API on the same site.** One domain, with `/api` proxied
to the backend, is the arrangement the session cookie is designed for
(`SameSite=Lax`). A genuinely cross-site split needs
`SESSION_COOKIE_SAMESITE=none` plus `SESSION_COOKIE_SECURE=true`, and browsers
are steadily restricting that.

## 4a. Google sign-in (optional)

Off by default. While `GOOGLE_OAUTH_ENABLED` is false the sign-in screen does
not show the button at all, rather than showing one that fails.

At <https://console.cloud.google.com/apis/credentials>:

1. **Create credentials** -> *OAuth client ID* -> **Web application**.
2. Under **Authorised redirect URIs**, add the value of `GOOGLE_REDIRECT_URI`,
   exactly:
   - local: `http://localhost:4000/api/auth/google/callback`
   - production: `https://api.example.com/api/auth/google/callback`
3. Copy the client ID and client secret into `server/.env`:

```ini
GOOGLE_OAUTH_ENABLED=true
GOOGLE_CLIENT_ID=<client id>
GOOGLE_CLIENT_SECRET=<client secret>
GOOGLE_ALLOWED_DOMAINS=inspironics.net
GOOGLE_AUTO_CREATE_USERS=true
```

### Who gets in

Google proves *who someone is*. It never proves they should be allowed to read
this library, so two gates sit in front of it:

| Setting | Effect |
|---|---|
| `GOOGLE_ALLOWED_DOMAINS` | Only these email domains may sign in. Empty means no domain filter. |
| `GOOGLE_AUTO_CREATE_USERS` | `false` (default): Google signs people in to accounts that already exist. `true`: a first sign-in creates one, always with the `user` role. |

`GOOGLE_AUTO_CREATE_USERS=true` with an empty `GOOGLE_ALLOWED_DOMAINS` is
refused at startup. That combination would let anyone holding any Google
account create themselves an account and read the whole catalog, and it is a
one-character mistake with no visible symptom — so it stops the process rather
than producing a warning nobody reads.

Sign-in is also refused when Google reports the address as unverified, which is
what stops a fresh Google account from claiming an existing administrator's
address.

### Notes

- Accounts created this way have no password, so they cannot also be reached
  through the password form. Give someone a password by having an administrator
  set one.
- Only `openid email profile` is requested, and only an online grant — nothing
  here ever calls Google on the person's behalf, so no refresh token is stored.
- A wrong redirect URI shows as `invalid_grant` or a Google error page. The
  exact reason Google gave is in the server log; the visitor sees a plain
  message on the sign-in page.

## 5. Docker

```bash
cd apps/api
docker compose up -d api
```

Secrets come from a `.env` beside `docker-compose.yml`, or from the
orchestrator. The image contains none. `/data` holds the database and the
preview cache and must be a volume — the connection survives a restart because
the encrypted refresh token is in there, not in memory.

## Multi-instance

```bash
docker compose --profile postgres up -d api-pg postgres
```

What changes: `DB_DRIVER=postgres` and a shared `DATABASE_URL`. What does not:
anything in the application. The advisory locks live in the database, so with
three replicas all three tick the scheduler, one takes the lock and syncs, and
the other two return "already running". Token refresh is the same story.

Share `/data/objects` between instances (the compose file does) so any instance
can serve a preview another one rendered. If you cannot, each instance simply
renders its own on first request.

Set `TRUST_PROXY=1` behind a load balancer, so rate limiting sees the real
client address rather than the proxy's.

## Using a real job system

The bundled scheduler is an in-process timer, which is honest about its limits.
To drive syncs from Celery, BullMQ, Quartz, Hangfire, Temporal or a cloud
scheduler, call the same entry point the timer does and set
`DROPBOX_SYNC_ENABLED=false`:

```bash
curl -X POST https://api.example.com/api/dropbox/sync \
     -H 'Content-Type: application/json' \
     -b "$ADMIN_SESSION" -d '{"trigger":"scheduled"}'
```

The lock still applies, so an overlapping schedule is harmless.

## Operating it

| Check | Where |
|---|---|
| Is the process alive? | `GET /api/health` — unauthenticated, cheap |
| Is Dropbox healthy? | `GET /api/dropbox/health` — admin, no Dropbox traffic |
| Did the last sync work? | `GET /api/dropbox/sync/logs` |
| Who changed what? | `GET /api/dropbox/audit` |
| Metrics | `GET /api/metrics` — Prometheus text |

Worth alerting on: `dropbox_sync_failures_total` rising,
`dropbox_api_errors_total{kind="DropboxAuthenticationError"}` rising (the
authorization is going bad), and `/api/dropbox/health` reporting `warning` or
`error`.

Retention is automatic and daily: sync logs
(`RETENTION_SYNC_LOG_DAYS`), audit rows (`RETENTION_AUDIT_LOG_DAYS`), expired
OAuth state and sessions, and cached previews (`OBJECT_CACHE_TTL_HOURS`).

## Backups

Back up the database. It holds the encrypted refresh token, the catalog, the
logs and the audit trail.

Back up the encryption key **separately** — a backup of the database with the
key beside it is a backup of the credential in plaintext.

`data/objects` needs no backup. It is a cache; it regenerates.

## Upgrading

Migrations are append-only and run at startup, so a rolling deploy is safe.
`npm run migrate` exists for deployments that prefer to migrate as a separate
step before rolling new instances.
