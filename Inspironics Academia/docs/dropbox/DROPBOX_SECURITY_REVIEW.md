# Dropbox security review

Reviewed: Academia API (`dropbox/*`, `files/*`, `studio/routes.js`, `meetings/routes.js`), SlidesVault and
Showcase Dropbox integrations, as of 2026-11-10.

## Credentials

| Item | Handling | Verdict |
|---|---|---|
| App key / secret | API `.env` only; never in the web bundle or responses | OK |
| Refresh token | AES-256-GCM with `TOKEN_ENCRYPTION_KEY` (32 bytes), stored in the database; never returned by any endpoint | OK |
| Access token | Minted on demand, kept in process memory, expires (4 h); dropped and re-minted on 401 | OK |
| OAuth state | Random, single use, bound to the admin who started it, 10-minute TTL, only its SHA-256 stored | OK |
| Logs | Academia's logger redacts fields named like token/secret/password/authorization/cookie; Dropbox error summaries are truncated to 160 characters and contain no tokens | OK |
| Showcase logs | Redaction by key name only | Low — recommend also matching `Bearer …` values |

The test suite asserts that no endpoint response contains the refresh token.

## Access to files

| Route | Who | Notes |
|---|---|---|
| `/api/playbooks/:id/content` | Admin | Streams the source; `Content-Disposition` uses an RFC 5987 percent-encoded file name (no header injection) |
| `/api/meetings/:id/content` | Admin | Same |
| `/api/studio/dropbox/*`, `/api/studio/storage*` | Admin (router-level `requireAdmin`) | |
| `/api/outputs/project/:id/video` | Admin | |
| `/api/outputs/lesson/:id/video` | Signed-in user | Same rule as `/api/media` |
| `/api/outputs/meeting/:id/video` | Signed-in user if published, else admin | |

- The browser never receives a Dropbox URL, temporary link or token; everything is proxied.
- `Range` headers are passed through only when they match `bytes=<n>-<n>`.
- Browse rejects any path containing `..`; the account parameter is validated against configured
  connections (unknown → 400).
- Files are addressed by Dropbox id; a user cannot make the API read an arbitrary path through the
  processing endpoints except within the connected app's own scope (App-folder apps are confined by
  Dropbox itself; Full-access apps are admin-only here).
- The video output folder cannot be `/`; file names are sanitised and include the record id.

## Data written to Dropbox

Only rendered videos, only when an admin turns on Dropbox output, only into the configured output
folder, and only with `files.content.write` granted. Originals are never written, moved or deleted.

## Local storage

- Temporary folders are created under `TEMP_PROCESSING_DIR` with unique names; removal refuses any path
  outside that folder.
- Object keys are SHA-256 hashes; `/api/media/:key` accepts only 64 hex characters and only objects
  whose metadata says `source: media` — Dropbox copies and uploads are not reachable through it.
- Under the temporary policy, document contents are no longer at rest on the APEX server, which reduces
  exposure if the server's disk is compromised.

## Least privilege

Recommended scopes per app: `account_info.read`, `files.metadata.read`, `files.content.read`; add
`files.content.write` only to the app that receives rendered videos. Prefer **App folder** access where
the content can live in one folder; use Full Dropbox only where necessary (then a folder must be chosen,
never the whole Dropbox).

## Findings

| # | Finding | Risk | Action |
|---|---|---|---|
| F1 | Showcase log redaction by key name only | Low | Recommend value-pattern redaction |
| F2 | Showcase guest access on by default | Info | Product decision; review before production |
| F3 | Lesson videos on Dropbox are viewable by any signed-in user who knows the id | Low (matches existing `/api/media` rule) | None |
| F4 | `TOKEN_ENCRYPTION_KEY` rotation requires reconnecting Dropbox | Info | Document in runbook |

No secrets were found in source control. `.env` files, databases and backups are excluded from commits.
