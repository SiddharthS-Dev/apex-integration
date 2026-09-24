# Inspironics Innovation Showcase

An immersive, dark-themed digital gallery of Inspironics innovation material — architecture plates,
command decks, value frameworks and presentation decks. **Dropbox holds the files**; the API indexes
them, gives each a real title and a business classification, and serves them to a searchable gallery
with a 3D ecosystem explorer, an in-browser viewer and offline reading.

The governing rule of the design: **the browser never talks to Dropbox.** Every Dropbox operation
goes through our own API, and file bytes are proxied through it. No Dropbox URL, access token or
share link ever reaches a user.

- **Cinematic hero** and a **3D smart-city Ecosystem Explorer** (Three.js) that filters the gallery
- **Flip-card gallery** and a full-screen viewer — images with zoom and pan; PDF, PowerPoint and HTML in a frame
- **AI copilot** that answers from the whole corpus
- **Offline library** — save any plate to this browser and read it without a connection
- **Admin console** — connect Dropbox, pick the sync folder, run a sync, read sync logs, analytics,
  users and login history
- **Monthly report** rendered to a multi-page PDF in the browser

## Quick start

On Windows, double-click **`start.bat`**. It installs dependencies on the first run, creates
`apps/api/.env` from the example, and starts both servers. Or:

```bash
npm install
npm run dev          # API on http://localhost:4100, web on http://localhost:5180
```

```bat
start.bat            :: API + web dev servers
start.bat prod       :: build, then serve everything from the API on :4100 (one origin)
start.bat demo       :: web only, on the bundled demo backend — no server, no Dropbox
stop.bat             :: stop both
```

The ports are 4100/5180 rather than the usual 4000/5173 so this project can run alongside others
on the same machine.

**First run:** register an account — in development the first account becomes the administrator.
Open **Admin console** from the account menu, click **Connect Dropbox**, approve, then **Run sync
now**. The gallery fills as the sync finishes.

### Connecting Dropbox

1. Create an app at <https://www.dropbox.com/developers/apps> (Scoped access). Grant
   `account_info.read`, `files.metadata.read` and `files.content.read`.
2. Under **OAuth 2 → Redirect URIs**, register exactly:
   `http://localhost:4100/api/dropbox/oauth/callback` — character-for-character. A mismatch is the
   most common reason connecting fails.
3. Put the key and secret in `apps/api/.env`:

   ```env
   DROPBOX_APP_KEY=…
   DROPBOX_APP_SECRET=…
   DROPBOX_ROOT_PATH=/Inspironics/Showcase     # optional; also settable in the admin console
   ```

To carry the curated metadata over, upload the original plates (`apps/web/inspironics/*.jpg`) to
the sync folder: files whose names match the original corpus keep their hand-written titles and
classification (see *Seed overlay* below).

## Repository layout

An npm-workspaces monorepo:

| Path              | Package               | What it is                                                                                            |
| ----------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| `apps/web`        | `@inspironics/web`    | the React client                                                                                      |
| `apps/api`        | `@inspironics/api`    | the Dropbox integration layer: auth, sync, content proxy, analytics                                   |
| `packages/shared` | `@inspironics/shared` | contracts both import — taxonomy, roles, file types, the plate record. Imports nothing, so bare Node and Vite can both consume it |
| `legacy/`         |                       | the retired Next.js prototype and static gallery                                                      |

## Tech stack

**Backend** — Node ≥ 22.5, ESM, Express 4. Few dependencies: `express`, `cookie-parser`, `jszip`
(reads `.pptx`, which are ZIP archives), `@anthropic-ai/sdk`, and optional `pg`. No ORM, no
Passport, no helmet, no Dropbox SDK: auth, RBAC, rate limiting, security headers, validation,
logging, metrics and the scheduler are hand-rolled on the standard library.

Storage is dual-driver behind one interface: **SQLite via `node:sqlite`** (Node's built-in — no
native module to compile) for development, **Postgres** (`DATABASE_URL`) for production. Raw SQL
through a repository layer with its own migration runner.

Auth is a session cookie (`insp_session`, httpOnly, SameSite=Lax, 12 h), passwords hashed with
scrypt, three roles (`admin`, `viewer`, `guest`) enforced server-side by `requireAdmin` /
`requireAuth`. Email verification and password reset use six-digit codes stored only as hashes.

**Frontend** — React 18 + Vite 5, React Router 6, Tailwind 3, Framer Motion, Three.js, jsPDF.
Offline reading is IndexedDB.

## How Dropbox connects to the backend

OAuth 2 authorization-code flow with refresh tokens. An admin clicks **Connect**; the API builds a
consent URL with `token_access_type=offline` (which is what makes Dropbox return a refresh token)
and a single-use CSRF `state` bound to that admin. Dropbox redirects to
`/api/dropbox/oauth/callback`.

The credential model:

- **Refresh token** — long-lived, encrypted with AES-256-GCM (`ENCRYPTION_KEY`), stored in the
  database. This *is* the connection.
- **Access token** — short-lived, minted on demand, held in process memory only. Never written to
  the database, never returned by an API, never logged (the logger also redacts anything
  credential-shaped as a backstop).

A leaked database row can't be replayed against Dropbox without the encryption key as well.
Concurrent refreshes collapse to one call: an in-process single flight, plus a DB lock across
instances. A refresh token Dropbox rejects flags the connection *reconnect required* in the console.

For team spaces every request carries `Dropbox-API-Path-Root`, using the `root` variant rather than
`namespace_id` so Dropbox checks the namespace is still current — and if a team reorganisation moved
it, the API stores the namespace Dropbox reports and retries, instead of silently syncing the wrong
folder.

## The sync pipeline

Triggered by the scheduler (every 30 min), an admin's **Run sync now**, or startup
(`SYNC_ON_STARTUP`). A DB lock — a Postgres advisory lock, or a lease row on SQLite — means only one
run happens at a time across all instances; a second request gets *"A synchronization is already
running."*

1. **Discover** — `files/list_folder`, recursive and paginated, from the configured folder,
   filtered to `jpg jpeg png webp gif pdf pptx html`.
2. **Compare** — each file is matched to its stored record by Dropbox id and revision. Unchanged
   files are skipped, but their last-seen stamp is refreshed so the archive pass stays truthful —
   which is also why an interrupted sync is cheap to resume.
3. **Process**, through a bounded pool (8). Per file:
   - **Thumbnail first**, via `files/get_thumbnail_v2`, because the rendered image doubles as the
     vision input. A file Dropbox can't render (`unsupported_image`) is a warning, not a failure;
     it gets a labelled placeholder.
   - **Content extraction** — `.pptx` unzipped with JSZip (core.xml title + slide text), PDF
     `/Title` and Flate-compressed text, HTML `<title>` and body. Skipped above `MAX_EXTRACT_MB`
     (150).
   - **Classification** — category, technologies, products, ESG/AI/IoT flags, objective, flow,
     components, benefits, takeaway, keywords and a confidence score, constrained to the taxonomy
     in `@inspironics/shared`. Order of precedence: an admin's edits → the **seed overlay** →
     Claude (`AI_ENABLED`) → unclassified.
   - **Title resolution** — seed → embedded metadata → first meaningful line → the model's reading
     of the text → vision on the thumbnail → the filename. A candidate no better than the filename
     ("PowerPoint Presentation", "Slide 1", the filename restated) is rejected.
4. **Archive** — anything active that this run did not see is archived, never deleted. This runs
   only when discovery genuinely succeeded and the run finished, so a transient failure can't wipe
   the library. It's also why narrowing the sync folder archives everything outside it.
5. **Record** — counts, duration, errors and warnings to `sync_log`: `success`, or `partial` if any
   file failed.

**Seed overlay.** The original corpus (`apps/web/public/data/showcase.json`, 235 plates with
hand-written metadata) is loaded at startup. A synced file whose name matches a seed plate takes its
title and classification as-is, at no model cost.

**AI.** Off unless `AI_ENABLED=true` and `ANTHROPIC_API_KEY` are both set; then each new or changed
file costs one Claude call (image + extracted text, structured JSON output, `claude-opus-5` by
default — `AI_MODEL` overrides). Files left unclassified while AI was off are picked up by the next
sync once it's on.

## How it reaches the gallery

The web app calls its own origin. `VITE_API_BASE_URL=/` means same-origin — in development through
the Vite proxy (`/api` → `:4100`), in production because the API serves the built app. That's
deliberate: the session is a SameSite=Lax cookie, and pointing the app at a different origin would
still work for fetches, but the viewer `<iframe>` would load without the cookie and come back 401.

The client's backend is swappable behind one interface (`VITE_BACKEND`): **`api`** (default) or the
bundled **`local`** demo backend (static corpus, browser-only accounts). No page or hook knows which
is in play — the auth service and the catalog loader are the only two seams.

The gallery reads `GET /api/entities/plates` — the `stored_file` rows with `status='active'`, in the
same record shape the original static corpus used. The admin console reads `/analytics`,
`/sync-logs` and `/login-history`.

Viewing goes through the **content proxy**:

| Route                                  | Serves                                                                           |
| -------------------------------------- | -------------------------------------------------------------------------------- |
| `GET /api/dropbox/files/:id/thumbnail` | 640×480 JPEG (or a placeholder)                                                  |
| `GET /api/dropbox/files/:id/preview`   | images at 2048×1536; `.pptx` rendered to PDF by Dropbox; PDF/HTML as the original |
| `GET /api/dropbox/files/:id/content`   | the original, streamed, with `Range` support; `?download=1` for an attachment    |

The API fetches from Dropbox under its own authorization and streams the bytes back; HTML is served
with `Content-Security-Policy: sandbox` so its scripts never run with our origin's privileges.
Thumbnails and previews are cached in a local object store (`apps/api/data/objects`) keyed by
(file id, revision, kind) — content-addressed in effect, so when a file changes in Dropbox its old
derivatives are simply never looked up again rather than needing invalidation. The cache is
disposable; Dropbox remains the source of truth.

**Offline** — IndexedDB holds downloaded blobs plus per-user reading state (favourites, recently
viewed), and the last good copy of the catalog so the gallery still opens without a connection.
Blobs stay in the browser sandbox rather than as loose files.

## Configuration

- **API** — `apps/api/.env`; every variable is documented in
  [`apps/api/.env.example`](apps/api/.env.example). In production (`NODE_ENV=production`) the API
  refuses to start without `ENCRYPTION_KEY` and an https `PUBLIC_API_URL`, never returns dev codes,
  and never makes the first registrant an admin — use `BOOTSTRAP_ADMIN_EMAIL`/`_PASSWORD` or
  `npm run create-admin -w @inspironics/api -- you@company.com 'password'`.
- **Web** — `apps/web/.env.local`; see [`apps/web/.env.example`](apps/web/.env.example).
  `VITE_GOOGLE_CLIENT_ID` enables real Google sign-in; set the same value as `GOOGLE_CLIENT_ID` on
  the API, which verifies the credential server-side.

No mail is sent. Outside production, verification and reset codes are returned to the client and
shown on screen so the flows complete; production needs a mail transport added in
`apps/api/src/routes/auth.js` (`issueCode`).

## Deploying

One origin: build the web app, then run the API with `SERVE_WEB=true` (the default in production)
behind TLS.

```bash
npm ci
npm run build                        # apps/web/dist
NODE_ENV=production DATABASE_URL=postgres://… ENCRYPTION_KEY=… PUBLIC_API_URL=https://showcase.example.com \
  DROPBOX_APP_KEY=… DROPBOX_APP_SECRET=… TRUST_PROXY=true npm start
```

Register `https://showcase.example.com/api/dropbox/oauth/callback` in the Dropbox App Console.
Several instances can share one Postgres: the sync and token-refresh locks are database-wide.

## Testing

```bash
npm test                              # shared + API (30) + web (67)
npm run lint:arch -w @inspironics/web # layer boundaries
npm run typecheck -w @inspironics/web
```

The API tests run the real app against an in-memory SQLite database and a **fake Dropbox** that
speaks the wire format — OAuth, `list_folder` with cursors, thumbnails, previews, `Range` downloads,
the path-root check — so the sync, credential model, content proxy and RBAC are exercised end to
end without a network. Among other things they assert that no Dropbox URL or token appears in any
response.

Browser suites (need a local Chrome; set `CHROME_PATH` if it isn't in the default Windows location):

```bash
# demo backend
VITE_BACKEND=local npm run dev:web
npm run smoke -w @inspironics/web          # auth gate, 3D, gallery, lightbox, copilot, PDF, mobile

# API backend, against the fake Dropbox with real plates
E2E_PORT=4100 node apps/api/test/e2e-server.mjs
npm run dev:web
npm run test:e2e -w @inspironics/web -- http://localhost:5180
```

## Where things live

```
apps/api/src/
  server.js · app.js · services.js   entry, HTTP wiring, composition root
  config.js                          the only reader of process.env
  db/                                sqlite + postgres drivers, migrations, runner
  repos/                             raw SQL per aggregate
  dropbox/                           auth.js (credential model) · client.js (HTTP API, path root, retries)
  sync/                              pipeline · extract · titles · seeds · scheduler
  ai/enricher.js                     the Claude classification call
  routes/                            auth · dropbox (+ content proxy) · entities · admin
  middleware/                        security headers, CORS, origin guard, rate limit, sessions/RBAC
  storage/objectStore.js             derivative cache
apps/web/src/
  app/                               composition root — routes, Home, Navbar
  features/                          auth · showcase · ecosystem · copilot · report · site
                                     · offline (IndexedDB library) · admin (console)
  shared/                            config · apiClient · idb · ui
packages/shared/src/                 taxonomy · roles · fileTypes · plate
docs/                                ARCHITECTURE.md and decision records
```

The web app's layering (`shared/` → `features/` → `app/`, enforced by `npm run lint:arch`) is
described in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); the move to a Dropbox-backed API is
[ADR 0008](docs/adr/0008-dropbox-backed-api.md).
