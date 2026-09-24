# Troubleshooting

Written for: whoever is on the receiving end of "Dropbox isn't working".

Start here, always:

```
GET /api/dropbox/health      what the server believes
POST /api/dropbox/test       what Dropbox says right now
GET  /api/dropbox/sync/logs  what happened on the last run
GET  /api/dropbox/audit      who did what
```

`health` reports `unconfigured`, `disconnected`, `error`, `warning` or
`healthy`, and that alone usually names the problem.

---

## The server will not start

**`DROPBOX_TOKEN_ENCRYPTION_KEY is required`**
Run `npm run keygen` and put the line it prints in `.env`. Startup refuses
rather than running with unencrypted credentials.

**`…must decode to exactly 32 bytes`**
The key was truncated or re-encoded. Generate a fresh one. If a connection
already exists, an administrator must reconnect after changing it.

**`DATABASE_URL is required when DB_DRIVER=postgres`**
Set it, or go back to `DB_DRIVER=sqlite`.

---

## Connecting fails

**"Dropbox is not configured for this application yet." (503)**
`DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` are missing from the *backend*
environment. Not the frontend — they must never be there.

**Dropbox shows "invalid redirect_uri"**
`DROPBOX_REDIRECT_URI` and the entry in the App Console must match exactly:
scheme, host, port, path, trailing slash. The Dropbox Settings page shows the
value the server is actually using — copy it from there.

**"This Dropbox authorization link is no longer valid."**
The `state` expired (default 10 minutes), was already used, or did not match.
Press Connect again. If it happens every time, check that the browser reaches
the same backend instance or that instances share a database.

**"That Dropbox authorization has already been used."**
The authorization code was consumed. Normally this is invisible — a replayed
callback returns the first result. Seeing the message means a genuinely stale
callback was replayed. Start again from Connect.

**Connected, but `account_name` is empty**
The token works; only the profile lookup failed. Usually the
`account_info.read` scope was not granted. Add it in the App Console and
reconnect.

**"Dropbox returned no refresh token"**
The authorization was made without `token_access_type=offline`. This server
always sends it, so the cause is an authorization started somewhere else, or a
proxy rewriting the URL.

---

## Permissions and scopes

**"The Dropbox app is missing the "files.content.write" permission."**
Exactly what it says. Enable that scope in the App Console → **Permissions**,
press **Submit**, then **Reconnect** in Dropbox Settings.

**I enabled the scope and it still fails**
This is the one that catches everyone. **Scopes are granted at authorization
time, not at request time.** An existing refresh token carries the scopes it was
issued with, and it will never inherit new ones — no amount of waiting, syncing
or restarting changes that.

The fix is always the same:

1. App Console → **Permissions** → tick the scope → **Submit**
   (the Submit button is easy to miss; without it nothing is saved).
2. SlidesVault → Dropbox Settings → **Reconnect**.
3. Approve the consent screen, which will now list the new permission.

Reconnect deliberately starts a *fresh* authorization with `force_reapprove`
rather than reusing the old grant, which is what makes this work.

**Which scope does what**
`account_info.read` (connecting), `files.metadata.read` (browsing, sync),
`files.content.read` (downloads, previews, thumbnails), `files.content.write`
(rename only). The endpoint-by-endpoint table is in
[DEPLOYMENT.md](DEPLOYMENT.md).

**A Business account cannot authorize at all**
Check **Admin console → Settings → Third-party apps**. A Dropbox Business admin
can restrict which apps team members may connect; until SlidesVault is
allow-listed there, authorization fails regardless of scopes, redirect URI or
anything else in this document. Check this first on a Business account.

## Team spaces

**Only the member's own files appear; the team folders are missing**
The connection predates team-space support, so it still operates in the member's
home namespace. Run `POST /api/dropbox/test` — if it returns
`"teamSpaceAvailable": true, "teamSpaceEnabled": false`, press **Reconnect** and
then re-select the sync folder. The browser will show the team space root.

Existing connections are left alone on purpose: switching namespaces silently
would reinterpret every stored path against a different root.

**The sync folder path looks wrong after reconnecting**
Expected. Paths are now relative to the team space root rather than the member's
folder, so `/Decks` may no longer mean what it did. Re-select the folder in the
browser. The member's personal folder is at the `home_path` reported by
`GET /api/dropbox/status` (e.g. `/Avery Raman`).

**"The Dropbox team space has moved."**
A team reorganization changed the root namespace. The server stores the new one
and replays the request automatically, so this should resolve itself within a
single call. If it persists, reconnect.

## The connection breaks later

**"The Dropbox authorization is no longer valid. Reconnect Dropbox."**
The refresh token was rejected. One of: an admin revoked the app in their
Dropbox account, the account was deleted or suspended, the app secret was
rotated in the App Console, or the app's permissions changed. Press
**Reconnect** — a new authorization is the only fix; a rejected refresh token
cannot be repaired.

**"Could not decrypt the stored Dropbox credential"**
`DROPBOX_TOKEN_ENCRYPTION_KEY` changed, or the row was altered. Restore the old
key, or reconnect to store a fresh credential under the new one. The indexed
catalog is unaffected either way.

**Everything works, then fails after a few hours, then works again**
That is the access token expiring and being refreshed. It should be invisible.
If it is not, look for many instances refreshing at once — check that they share
a database so the advisory lock applies.

---

## Sync problems

**"A synchronization is already running."**
Expected when a manual run meets a scheduled one. If it persists past
`DROPBOX_SYNC_LOCK_TTL_MINUTES`, a process died mid-run; the lock expires on its
own and the next start marks the orphaned run as failed.

**The folder does not exist**
The synced folder was renamed, moved or deleted in Dropbox. Pick it again in
Dropbox Settings. The catalog is not archived on a failed listing — only a
*successful* listing can archive anything, precisely so a transient failure
cannot wipe the library.

**Files are missing from the library**
In order: is the file under the configured root folder? Is its extension in
`DROPBOX_SUPPORTED_EXTENSIONS`? Did the last sync report failures
(`GET /api/dropbox/sync/:id` lists the per-file errors)? Is it a shared folder
the connected account has not mounted?

**Everything got archived at once**
The root folder went missing, or the account lost access to it. Fix the folder
and run a sync; archived records are restored automatically when their files
reappear.

**Sync is slow**
The first run is the expensive one — every file is downloaded, extracted,
thumbnailed and classified. Later runs skip unchanged revisions entirely. If it
is still slow, raise `DROPBOX_MAX_CONCURRENT_FILES`, or set `AI_ENABLED=false`
to see how much of the time is the AI layer.

**429s in the log**
Dropbox is rate limiting. They are retried with backoff and the run still
completes. If it is constant, lower `DROPBOX_MAX_CONCURRENT_FILES`.

---

## Titles

**A deck is still called "Untitled (12)"**
Every tier failed. In order: the file has no metadata title, no extractable
text, and either no AI configured (`ANTHROPIC_API_KEY`), vision disabled
(`AI_VISION_ENABLED=false`), or the model produced something that failed
validation. Keeping the filename is the intended outcome — a misleading title is
worse than a boring one. Such files are retried on every sync, so configuring AI
later fixes them without a forced resync.

**A title looks wrong**
Rename it explicitly: `POST /api/dropbox/files/:id/rename` with a `title`. That
sets `title_source: manual`, which the sync will not overwrite.

**Image-only decks (Gamma, Canva) get no title**
Check `AI_VISION_ENABLED=true` and that an `ANTHROPIC_API_KEY` is set. The
vision input is the Dropbox render of slide 1, so also confirm thumbnails are
working — a format Dropbox cannot render has neither.

---

## Viewing

**The viewer shows a blank frame**
Check the browser console. If the frame was blocked, the app origin is missing
from `CORS_ORIGINS` — that list also drives the `frame-ancestors` policy on
content responses.

**Thumbnails do not load, or the session is not recognised**
Almost always a cross-site cookie problem: the app and the API are on different
sites, so a `SameSite=Lax` cookie is not sent. Put them on the same site with
`/api` proxied, or use `SESSION_COOKIE_SAMESITE=none` with
`SESSION_COOKIE_SECURE=true` over https.

**A preview is stale after the file changed**
It should not be — cache keys include the revision. If it happens,
`POST /api/dropbox/files/:id/invalidate` clears the derivatives.

**A PPTX will not preview**
Dropbox renders Office formats to PDF server-side and sometimes declines. The
response falls back to streaming the original. `.ppt` (the old binary format)
often cannot be rendered at all.

---

## PDF text is never extracted

`pdfjs-dist` is an optional dependency. Without it, PDF titles come only from
the document's `/Title` metadata. Install it to enable first-page text:

```bash
npm install pdfjs-dist
```

---

## Collecting a report

```bash
curl -b "$ADMIN_SESSION" https://api.example.com/api/dropbox/health
curl -b "$ADMIN_SESSION" 'https://api.example.com/api/dropbox/sync/logs?limit=5'
curl -b "$ADMIN_SESSION" 'https://api.example.com/api/dropbox/audit?limit=50'
```

None of these contain a credential — secrets are redacted by key and by pattern
before anything is written — so all three are safe to attach to a ticket.
