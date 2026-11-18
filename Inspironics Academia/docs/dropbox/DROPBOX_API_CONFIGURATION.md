# Dropbox API configuration

## Apps and connections

Academia can use up to three kinds of Dropbox app, each with its own key, secret and connection:

| Connection | Env vars | Redirect URI to register (behind the gateway) |
|---|---|---|
| Playbooks (main) | `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_REDIRECT_URI` | `http://localhost:5173/academia/api/dropbox/oauth/callback` |
| Meetings (optional) | `DROPBOX_MEETINGS_APP_KEY`, `DROPBOX_MEETINGS_APP_SECRET` | `…/api/dropbox/meetings/oauth/callback` |
| Category source, e.g. Learning (optional) | `DROPBOX_LEARNING_APP_KEY`, `DROPBOX_LEARNING_APP_SECRET`, `DROPBOX_LEARNING_ACCESS=full` | `…/api/dropbox/sources/learning/oauth/callback` |

The redirect URI must match character for character. Keys and secrets live only in the API's `.env`;
they are never sent to the browser.

## Permissions (scopes)

APEX does not request scopes in the OAuth URL, so the scopes ticked on the app's **Permissions** tab in
the Dropbox App Console are what the connection gets. Changing them requires reconnecting
(Admin → Integrations → Disconnect, then Connect).

| Scope | Needed for | Required? |
|---|---|---|
| `account_info.read` | Showing who is connected; team root namespace | Yes |
| `files.metadata.read` | Sync, browse, change detection, space usage | Yes |
| `files.content.read` | Extraction, previews, AI Studio from a Dropbox file | Yes |
| `files.content.write` | Uploading rendered videos to Dropbox | Only for video output to Dropbox |
| `team_data.member` / team scopes | Not used | No |

Without `files.content.write`, an upload fails with HTTP 403 "Dropbox permission missing: enable
files.content.write on the Dropbox app, then reconnect Dropbox." The render itself still succeeds and the
video stays on APEX; the error is recorded on the record (`*_output_error`) and the upload can be retried
(`publishRenderedVideo` job) after reconnecting.

## Endpoints used

| Endpoint | Purpose |
|---|---|
| `oauth2/token` | Code exchange; refresh-token → short-lived access token |
| `users/get_current_account` | Account name, team root namespace |
| `users/get_space_usage` | Dashboard |
| `files/list_folder`, `files/list_folder/continue` | Sync and browsing (metadata only) |
| `files/get_metadata` | Existence, revision and size check before processing |
| `files/download` | Extraction (into memory), previews (streamed, `Range` header supported) |
| `files/upload` | Video output up to 150 MB |
| `files/upload_session/start` → `append_v2` → `finish` | Video output over 150 MB, 64 MB chunks |

Team accounts are addressed with `Dropbox-API-Path-Root: {".tag":"root", …}`; when the root changes,
APEX stores the new namespace and retries once.

## Storage and output variables (new)

| Variable | Default | Meaning |
|---|---|---|
| `DROPBOX_SOURCE_CACHE` | `temporary` | `temporary`: never keep a copy of a Dropbox document. `permanent`: keep one per revision |
| `TEMP_PROCESSING_DIR` | `<OS temp>/apex-academia` | Working folders for renders and voice conversion |
| `TEMP_MAX_AGE_HOURS` | `6` | Age after which a temp folder whose job is not running is removed |
| `AI_CACHE_RETENTION_DAYS` | `90` | |
| `TTS_CACHE_RETENTION_DAYS` | `180` | |
| `SCENE_CACHE_RETENTION_DAYS` | `30` | |
| `EXTRACT_CACHE_RETENTION_DAYS` | `90` | |
| `STORAGE_AUTO_CLEANUP` | `false` | `true`: daily safe clean-up. `false`: only abandoned temp folders daily |
| `VIDEO_OUTPUT_DESTINATION` | `apex` | `apex` or `dropbox` |
| `DROPBOX_OUTPUT_FOLDER` | `/APEX Generated Videos` | Folder in the Playbooks Dropbox; videos go to `<folder>/<lessons\|meetings\|projects>/` |
| `VIDEO_KEEP_LOCAL_COPY` | `true` | With Dropbox output, also keep the MP4 on APEX |

The last three are defaults; admins can change them in AI Studio → Storage & Dropbox (stored in the
database, the saved setting wins). The output folder must not be `/` (the whole Dropbox).

## Limits

- `MAX_EXTRACT_MB` (500) — larger documents are refused before download.
- Dropbox rate limits (HTTP 429) are retried with `Retry-After`.
- Single uploads are limited to 150 MB by Dropbox; larger files use upload sessions automatically.
