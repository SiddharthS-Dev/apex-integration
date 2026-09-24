# Inspironics SlidesVault

**Presentation Knowledge Hub** — an enterprise presentation library that syncs from Dropbox,
classifies every deck with AI, streams them in a locked-down viewer, and works offline.

---

## Quick start

On Windows, double-click **`start.bat`** — it installs dependencies on first run, starts the dev
server and opens the browser. **`stop.bat`** shuts it down again.

```bat
start.bat              :: dev server on http://localhost:5173
start.bat 3000         :: dev server on a different port
start.bat preview      :: production build, served from dist/ on port 4173

stop.bat               :: stop the dev server
stop.bat 3000          :: stop the server on that port
stop.bat preview       :: stop the preview server
stop.bat all           :: stop every SlidesVault server started from this folder
```

Both scripts only ever touch processes launched from this folder, so a server another project
happens to be running on the same port is reported and left alone.

Or use npm directly:

```bash
npm install          # one install covers every workspace
npm run dev          # API on :4000 and the web app on :5173, together
npm run dev:api      # just the API
npm run dev:web      # just the web app
npm run build        # production bundle in apps/web/dist/
npm run preview      # serve the production build
```

The app runs **without any cloud credentials**. With no backend configured it uses a
bundled local backend (`apps/web/src/api/localClient.js`): a seeded 32-deck catalog, localStorage
persistence, working analytics, RBAC, and a keyword-scored copilot. Presentations render as
generated PDFs so the viewer, downloads and offline mode are all live.

**Demo accounts** (password `slidesvault` for both, and the sign-in page can fill them in):

| Role   | Email                          |
| ------ | ------------------------------ |
| Admin  | `avery.raman@inspironics.net`  |
| Member | `sana.kapoor@inspironics.net`  |

---

## Connecting a real backend

`src/api/base44Client.js` is the only place that knows which backend is in play; everything above
it (`entities.js`, `functions.js`, `integrations.js`) has an identical API whichever it is.

| Mode | Selected by | What it is |
| ---- | ----------- | ---------- |
| **API server** | `VITE_API_BASE_URL` | The enterprise Dropbox integration layer in [`server/`](server/) |
| Base44 | `VITE_BASE44_APP_ID` | The serverless functions in [`base44/`](base44/) |
| Local | neither | The bundled demo backend |

### API server (recommended)

A Node backend that owns the Dropbox connection end to end: OAuth with refresh tokens, encrypted
credential storage, incremental sync, content extraction, AI title resolution with a vision
fallback, preview generation, audit logging, metrics and a scheduler.

```bash
npm install                                  # from the repo root
cp apps/api/.env.example apps/api/.env
npm run keygen                               # paste the printed line into apps/api/.env
#   … add DROPBOX_APP_KEY, DROPBOX_APP_SECRET, BOOTSTRAP_ADMIN_* …
npm run dev:api                              # http://localhost:4000
```

Then set `VITE_API_BASE_URL=/` in `apps/web/.env`, start the web app, sign in
as the admin, and open **Dropbox Settings**: register the redirect URI the page shows in the
Dropbox App Console, connect the account, pick a folder, and run a sync. After that the scheduler
keeps the library current on its own.

See [`apps/api/README.md`](apps/api/README.md), and
[`apps/api/docs/DEPLOYMENT.md`](apps/api/docs/DEPLOYMENT.md) for the full walk-through.

### Base44

1. Create a Base44 app and deploy the entities in [`legacy/base44/entities/`](legacy/base44/entities/) and the
   functions in [`legacy/base44/functions/`](legacy/base44/functions/).
2. Set the server-side secrets: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_ROOT_FOLDER`.
3. Copy `.env.example` to `.env` and set `VITE_BASE44_APP_ID`.
4. `npm install @base44/sdk` — it is loaded lazily, so it is only needed in this mode.
5. Sign in as an admin, open **Dropbox Settings**, register the redirect URI the page shows in the
   Dropbox App Console, connect the account, pick a folder and run a sync.

---

## Architecture

```
apps/
  web/                    @slidesvault/web — the React + Vite client
    src/
      api/          backend adapter — apiClient (the API server), localClient
                    (bundled offline backend), base44Client (legacy chooser),
                    entities / functions / integrations, seed catalog
      lib/          domains (palette over the shared taxonomy), offline-db
                    (IndexedDB), analytics, useTheme, AuthContext,
                    useLibraryData, utils
      components/   Layout, PresentationCard, SearchBar, AiCopilot, ScrollRow,
                    MostViewedSection, SkeletonCard, UserProfileChip, ui/
      pages/        Home, Library, PresentationViewer, Dashboard,
                    OfflineLibrary, Admin, DropboxSettings, UserManual,
                    auth screens, PageNotFound
    public/, index.html, vite.config.js, tailwind.config.js

  api/                    @slidesvault/api — the Dropbox integration layer
    src/
      config/       one validated config object, built from the environment
      http/         auth + RBAC, rate limiting, security headers, validation
      routes/       auth, entities, system
      integrations/ dropbox/ — auth, client, request executor, sync, content,
                    folders, thumbnails, rename, health
      domain/       storage/ — StorageProvider port, FileMetadata
      services/     extraction, document analysis, title resolution, audit,
                    scheduler, metrics, storage
      db/           driver (sqlite | postgres), migrations, repositories/
      container.js  dependency wiring
    tests/          unit / integration / e2e, all against an in-memory Dropbox
    docs/           architecture, security, API, schema, deployment
    data/           SQLite database + object store (gitignored)

packages/
  shared/                 @slidesvault/shared — contracts both apps import
    src/          domains (the taxonomy the classifier and the UI agree on),
                  roles, files. Imports nothing, so bare Node and Vite can
                  both consume it.

legacy/
  base44/         retired Base44 entities and functions, kept for reference
```

### Sync pipeline

```
Dropbox folder → list_folder (recursive, paginated)
  → for each .pdf/.pptx/.html:
      → skip if the revision is unchanged and the title is not generic
      → derive a title for untitled files:
          PPTX text via JSZip <a:t> runs → LLM
          no text (image-only deck) → extract slide1 image → vision LLM
          HTML → <title> or stripped text → LLM
      → classify into domain / sub-domain / tags / summary / objectives
      → thumbnail via get_thumbnail_v2 (JPEG 640×480)
      → create or update the Presentation record
  → archive records whose files are gone from Dropbox
  → write a SyncLog row and update DropboxConfig
```

### Viewing pipeline

```
open a presentation
  → IndexedDB has a cached blob?  → blob URL, badge "Offline"
  → else Presentation.file_url?   → use it
  → else getPresentationStream    → get_preview (Office) or get_temporary_link (PDF/HTML)
                                  → upload the PDF once, cache the URL on the entity
  → render in an iframe with #toolbar=0&navpanes=0
```

---

## Security model

- **Token handling** — only the Dropbox *refresh* token is persisted, encrypted with AES-256-GCM
  on the API server. Access tokens are minted per request, held in process memory, auto-refreshed
  on 401, and never written to the database, an API response or a log. The status endpoint returns
  an explicit allow-list that cannot leak the refresh token.
- **Content** — the PDF viewer hides the browser toolbar (`#toolbar=0&navpanes=0`), disables the
  context menu and text selection, and `@media print { body { display: none } }` blocks printing
  the application.
- **Downloads** — stored as blobs in IndexedDB inside the app sandbox, never as loose files, with
  LRU eviction when the origin approaches its storage quota.
- **RBAC** — every route except the auth screens is behind `ProtectedRoute`; the Admin console and
  Dropbox Settings check `user.role === 'admin'` on the client *and* in every admin backend
  function (`requireAdmin`).
- **OAuth** — `token_access_type=offline`, and exchanged codes are deduped so React StrictMode's
  double mount cannot burn a single-use code.

---

## Design system

Dark-first glassmorphism with a persistent light mode (`localStorage` key `pkhub-theme`). All
colours are HSL CSS variables in `src/index.css`, mapped into Tailwind tokens. Glass surfaces are
`bg-card/60 backdrop-blur-xl ring-1 ring-border`; heroes use
`from-indigo-600 via-violet-600 to-fuchsia-600`.

The five domains each own a gradient used consistently across cards, badges, filter dots and
charts:

| Domain                | Gradient                      |
| --------------------- | ----------------------------- |
| Engineering           | `from-blue-500 to-cyan-500`     |
| Products              | `from-violet-500 to-purple-500` |
| Business              | `from-amber-500 to-orange-500`  |
| Human Resources       | `from-rose-500 to-pink-500`     |
| Research & Innovation | `from-emerald-500 to-teal-500`  |

---

## Keyboard shortcuts

| Key        | Action                          |
| ---------- | ------------------------------- |
| `⌘K`/`Ctrl+K` | Focus search                  |
| `←` `→`    | Previous / next page            |
| `Space`    | Next page                       |
| `F`        | Fullscreen                      |
| `+` `-`    | Zoom in / out                   |
| `B`        | Bookmark the current page       |
| `Esc`      | Close find, fullscreen or panel |
