# API reference

Written for: engineers integrating with the SlidesVault backend.

All routes are under `/api`. Requests and responses are JSON unless noted.
Authentication is an http-only session cookie; send `credentials: 'include'`.

Roles: **admin** — administrator only. **auth** — any signed-in user.
**public** — no session required.

## Errors

Every failure returns the same shape. The message is written for a person; the
detail behind it goes to the server log, not to the client.

```json
{ "error": "Dropbox authentication expired. The connection is being renewed automatically…",
  "code": "DropboxAuthenticationError",
  "retryable": false }
```

| Status | Meaning |
|---|---|
| 400 | The request was malformed — a bad id, an invalid path, a rejected title. |
| 401 | No session, or it expired. |
| 403 | Signed in, but the role is not sufficient; or the feature is disabled. |
| 404 | No such route, presentation or cached asset. |
| 409 | A conflict — a sync already running, a code already being exchanged. |
| 429 | Rate limited. `Retry-After` says how long to wait. |
| 5xx | Dropbox or the server failed. `retryable` says whether trying again may help. |

---

## Authentication

### `POST /api/auth/login` — public
```json
{ "email": "admin@example.com", "password": "…" }
```
Sets the session cookie. Returns `{ "user": { id, email, full_name, role, … } }`.
Rate limited to 10 attempts per 15 minutes per IP + email. A wrong password and
an unknown account give byte-identical responses.

### `POST /api/auth/logout` — public
Revokes the session and clears the cookie.

### `GET /api/auth/me` — public
The signed-in user, or 401.

### `POST /api/auth/register` — public
`{ email, password (≥10 chars), full_name }`. Always creates a plain user.

### `GET /api/auth/users` — admin
Every account, without password hashes.

### `GET /api/auth/config` — public
Which sign-in methods and features this deployment offers, so the sign-in
screen never shows a button that cannot work:
```json
{ "password": true, "google": false, "ai": false }
```
`google` is true only when Google sign-in is enabled and configured; `ai` only
when `AI_ENABLED=true` and an Anthropic key is set (it gates the Copilot).

### `GET /api/auth/google/start?next=/library` — public
A redirect (302) to Google's consent screen, not JSON — the browser navigates
here. Issues a single-use OAuth `state`. `next` (≤300 chars) is where to land
after sign-in; only an in-app path is honoured. Fails when Google sign-in is
not enabled (404) or not configured.

### `GET /api/auth/google/callback` — public (Google calls it)
Google's redirect target. Validates the `state`, exchanges the `code`, applies
`GOOGLE_ALLOWED_DOMAINS` / `GOOGLE_AUTO_CREATE_USERS` and refuses unverified
addresses. On success it sets the session cookie and redirects to
`APP_BASE_URL` + `next`; on any failure (including the visitor pressing
Cancel) it redirects to `APP_BASE_URL/login?error=<message>`. It never returns
JSON. See DEPLOYMENT.md §4a.

### Forgotten passwords
There is no emailed reset link and no reset endpoint for the person
themselves. An administrator sets a temporary password with
`POST /api/users/:id/password` (below) and hands it over directly.

---

## Users

Administrator-only. Both endpoints write an audit record
(`user.role_changed`, `user.password_set_by_admin`) and share the admin rate
limit.

### `PATCH /api/users/:id` — admin
```json
{ "role": "admin" }
```
Changes a user's role. `role` must be one of the shared roles
(`packages/shared/src/roles.js`: `admin`, `user`); it is the only field
accepted. Returns `{ "user": {…}, "changed": true }` (`changed: false` if the
user already had that role).

| Status | When |
|---|---|
| 400 | `role` missing or not a known role; `:id` not a UUID |
| 403 | the caller is not an admin |
| 404 | no such user |
| 409 | `code: "last_admin"` — the change would leave no active administrator (including an admin demoting themselves when they are the last one). The refusal is audited with `outcome: "failure"`. |

The last-admin check is part of the `UPDATE` statement, so two admins demoting
each other concurrently cannot both succeed.

### `POST /api/users/:id/password` — admin
```json
{ "password": "a-temporary-password" }
```
Sets a temporary password (at least 10 characters, the same floor as
registration) and **revokes every session** that user has, so they are signed
out everywhere. Returns `{ "ok": true, "sessions_revoked": true }`. The
password is never written to the audit log. 400 for a short or missing
password, 403 for a non-admin, 404 for an unknown user.

---

## Connection

### `GET /api/dropbox/status` — admin
```json
{ "provider": "dropbox", "connection_status": "connected", "sync_status": "idle",
  "account_id": "dbid:…", "account_name": "Avery Raman", "account_email": "…",
  "root_folder": "/Company/Decks", "last_connected_at": "…",
  "last_token_refresh_at": "…", "last_sync_at": "…", "last_sync_status": "success",
  "last_error": "", "configured": true,
  "redirect_uri": "https://api.example.com/api/dropbox/oauth/callback",
  "supported_extensions": ["pdf","pptx","ppt","html"],
  "scheduler": { "enabled": true, "interval_minutes": 30 } }
```
`connection_status` is one of `connected`, `disconnected`, `error`.

### `GET /api/dropbox/health` — admin
Local state only; makes no Dropbox calls, so it is safe to poll.
```json
{ "connected": true, "configured": true, "account": "…", "rootFolder": "/Company/Decks",
  "lastSync": "…", "lastSyncStatus": "success", "lastTokenRefresh": "…", "lastError": null,
  "syncRunning": false, "scheduler": { "enabled": true, "intervalMinutes": 30 },
  "indexedFiles": 190, "archivedFiles": 2,
  "tokenCache": { "cached": true, "expiresInSeconds": 13800 },
  "status": "healthy" }
```
`status`: `healthy` | `warning` | `error` | `disconnected` | `unconfigured`.
`warning` means the connection works but wants attention — a failed last run, or
no successful sync in three intervals.

### `GET /api/health` — public
Liveness for a load balancer. `{ "status": "ok", "database": "ok", "uptimeSeconds": n }`.
503 when the database is unreachable.

---

## OAuth

### `GET /api/dropbox/auth/url` — admin
Returns `{ url, redirect_uri, expires_at }`. The URL requests
`token_access_type=offline` and carries a single-use `state`. Send the browser
to it. The state value is not returned separately, by design.

### `GET /api/dropbox/oauth/callback` — public (Dropbox calls it)
`?code=…&state=…`, or `?error=access_denied&error_description=…`.
Validates the state, exchanges the code, stores the encrypted refresh token, and
**redirects** (302) to `${APP_BASE_URL}/dropbox-settings` with either
`?dropbox_connected=1&account=…` or `?dropbox_error=…`.

### `POST /api/dropbox/oauth/exchange` — admin
`{ code, state }`. The same exchange for deployments where the SPA is the
registered redirect URI. A replayed code returns the first result with
`"replayed": true` rather than an error.

### `POST /api/dropbox/test` — admin
A live check. Authentication and folder access are reported separately, so "the
token works but the folder was deleted" is distinguishable from "the
authorization was revoked".
```json
{ "ok": true, "connected": true, "authenticated": true, "folderAccessible": true,
  "accountName": "…", "accountEmail": "…", "rootFolder": "/Company/Decks", "error": null }
```

### `POST /api/dropbox/reconnect` — admin
Returns a fresh authorization URL with `force_reapprove`. Reconnecting always
starts a new authorization; it never reuses a credential that already failed.

### `POST /api/dropbox/disconnect` — admin
Revokes at Dropbox, clears the stored credential, keeps the indexed catalog.
`{ "disconnected": true, "revoked": true, "indexedFilesRetained": 190 }`.

---

## Folders

### `GET /api/dropbox/folders?path=/Company` — admin
Folders only. `path` omitted means the account root.
```json
{ "path": "/Company", "pathDisplay": "/Company", "parent": "",
  "breadcrumbs": [{ "name": "Company", "path": "/Company" }],
  "entries": [{ "name": "decks", "path_lower": "/company/decks", "path_display": "/Company/Decks", "id": "id:…" }] }
```

### `POST /api/dropbox/folder` — admin
`{ "root_folder": "/Company/Decks" }`. The folder is verified to exist before it
is stored; a typo is a 400, not a broken sync an hour later. The path is
normalized (`" Company / Decks / "` → `/Company/Decks`).

---

## Synchronization

### `POST /api/dropbox/sync` — admin
`{ "trigger": "manual", "force": false }`. `force` reprocesses every file.
```json
{ "status": "success", "sync_id": "…", "total": 190, "new": 12, "updated": 8,
  "deleted": 2, "skipped": 168, "failed": 0, "errors": [] }
```
`status` is `success`, `partial` (some files failed), or `skipped` when a run is
already in flight — in which case `reason` says so. A run already in progress is
not an error.

### `GET /api/dropbox/sync/logs?limit=25&offset=0` — admin
`{ "logs": [ … ], "running": false }`.

### `GET /api/dropbox/sync/:id` — admin
One run, including `details` with the per-file errors.

---

## Files

### `GET /api/dropbox/files/:id` — auth
The presentation record.

### `GET /api/dropbox/files/:id/preview` — auth
What the viewer should load. Never contains a Dropbox URL.
```json
{ "kind": "cached", "fileType": "pptx", "contentType": "application/pdf",
  "url": "/api/assets/preview-….pdf",
  "streamUrl": "/api/dropbox/files/…/content" }
```
`kind` is `cached` (a rendered PDF is on disk) or `stream` (proxy it live).

### `GET /api/dropbox/files/:id/content` — auth
The bytes, proxied. `?original=true` skips the rendered preview and serves the
source file. Records a view. PDFs and images are embeddable; synced HTML is
served sandboxed into an opaque origin.

### `GET /api/dropbox/files/:id/download` — admin
A short-lived direct Dropbox link. Audited. Disabled entirely when
`DROPBOX_ALLOW_ADMIN_DOWNLOAD=false`.
`{ "url": "https://…", "expiresAt": "…", "fileName": "…" }`

### `POST /api/dropbox/files/:id/rename` — admin
`{ "title": "Zero Trust Architecture", "dryRun": false }`. The title must pass
validation; a generic or over-long one is a 400.

### `POST /api/dropbox/files/rename-untitled` — admin
`{ "dryRun": true, "limit": 50 }`.

**`dryRun` defaults to `true`.** An omitted flag never renames anything.

```json
{ "dryRun": true, "examined": 12,
  "proposals": [
    { "id": "…", "currentName": "Untitled (12).pptx",
      "proposedName": "Autonomous Infrastructure Platform.pptx",
      "proposedPath": "/Company/Decks/Autonomous Infrastructure Platform.pptx",
      "title": "Autonomous Infrastructure Platform", "titleSource": "ai_vision", "skipped": false },
    { "id": "…", "currentName": "Untitled (99).pdf", "proposedName": null,
      "skipped": true, "reason": "No confident title could be derived; the original filename is kept." }
  ] }
```
With `dryRun: false` the response adds `renamed`, `failed`, and per-proposal
`finalName`. Collisions get a deterministic ` (1)`, ` (2)` suffix; nothing is
ever overwritten.

### `POST /api/dropbox/files/:id/invalidate` — admin
Drops the cached preview and thumbnail. They regenerate on the next request.

---

## Catalog

### `GET /api/presentations?limit=200&offset=0&sort=-updated_at` — auth
`{ "items": [ … ], "total": 190, "limit": 200, "offset": 0 }`.
`status=archived` is honoured for admins only.

### `GET /api/presentations/:id` — auth

### `GET /api/analytics?limit=200` — auth

### `POST /api/analytics/view` — auth
`{ "presentation_id": "…", "reading_seconds": 42, "offline": false }`

### `GET /api/sync-logs`, `GET /api/dropbox-config`, `GET /api/login-history` — admin

---

## AI

### `POST /api/ai/copilot` — auth
```json
{ "question": "Which decks cover onboarding?", "history": [{ "role": "user", "content": "…" }] }
```
The library Copilot. The browser sends only the question (≤1000 chars) and up
to the last 6 history turns; the server builds the prompt from its own catalog
— the 300 most-viewed active decks (title, domain, tags, a short summary), not
the whole library and not the deck text. Returns
`{ "reply": "markdown text", "picks": [presentation, …] }` with at most 5
picks. Rate limited per user (`AI_COPILOT_MAX_PER_MINUTE`, default 10).
503 `AiUnavailable` when AI is disabled or no key is set; 502 (retryable) when
the model call fails or returns nothing usable.

---

## Observability

### `GET /api/metrics` — admin
Prometheus text by default; `?format=json` for the admin UI.

### `GET /api/dropbox/audit?limit=50&offset=0&action=dropbox.connected` — admin
The administrative audit trail, newest first: `{ "events": [...], "limit", "offset" }`.
`limit` is 1–500 (default 50), `offset` pages through older entries, `action`
filters to one action. Contains no credentials. The Admin console's "Audit log"
section reads this endpoint.

### `GET /api/assets/:key` — auth
Cached thumbnails and rendered previews. Keys are hashes of
(file id, revision, kind), so a URL reveals nothing about the Dropbox path and
the bytes behind a key never change.
