# Inspironics SlidesVault

**Presentation Knowledge Hub** — an enterprise presentation library that syncs from Dropbox,
classifies every deck with AI, streams them in a locked-down viewer, and works offline.

---

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production bundle in dist/
npm run preview      # serve the production build
```

The app runs **without any cloud credentials**. With no `VITE_BASE44_APP_ID` set it uses a
bundled local backend (`src/api/localClient.js`): the real 190-deck catalog, localStorage
persistence, working analytics, RBAC, and a keyword-scored copilot. Presentations render as
generated PDFs so the viewer, downloads and offline mode are all live.

### The catalog

`src/api/catalog.json` is a committed snapshot of the Base44 app's `Presentation`
entity — 195 records, 190 of them active — and the local backend seeds from it.
Refresh it whenever the Base44 library changes:

```bash
npm run sync:catalog
```

The entity endpoint is public, so this needs no credentials. A browser that
already holds an older catalog reseeds itself automatically: `localClient.js`
stamps the catalog it seeded and drops the presentation tables when that stamp
moves. Accounts, sessions and saved searches survive.

Author and slide count are empty on most real records and are shown as `—`
rather than filled with invented values. Deck files themselves still come from
Dropbox via the Base44 functions; in local mode the viewer renders a generated
PDF built from each record's metadata.

**Demo accounts** (password `slidesvault` for both, and the sign-in page can fill them in):

| Role   | Email                          |
| ------ | ------------------------------ |
| Admin  | `avery.raman@inspironics.net`  |
| Member | `sana.kapoor@inspironics.net`  |

---

## Connecting the real backend

1. Create a Base44 app and deploy the entities in [`base44/entities/`](base44/entities/) and the
   functions in [`base44/functions/`](base44/functions/).
2. Set the server-side secrets: `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET`, `DROPBOX_ROOT_FOLDER`.
3. Copy `.env.example` to `.env` and set `VITE_BASE44_APP_ID`.
4. `npm install @base44/sdk` — it is loaded lazily, so it is only needed in this mode.
5. Sign in as an admin, open **Dropbox Settings**, register the redirect URI the page shows in the
   Dropbox App Console, connect the account, pick a folder and run a sync.

`src/api/base44Client.js` is the only place that knows which backend is in play; everything above
it (`entities.js`, `functions.js`, `integrations.js`) has an identical API either way.

---

## Architecture

```
src/
  api/          backend adapter — base44Client (chooser), localClient (offline backend),
                entities / functions / integrations (stable API surface), seed catalog
  lib/          domains (the 5-domain design system), offline-db (IndexedDB),
                analytics, useTheme, AuthContext, useLibraryData, utils
  components/   Layout, PresentationCard, SearchBar, AiCopilot, ScrollRow,
                MostViewedSection, SkeletonCard, UserProfileChip, ui/ primitives
  pages/        Home, Library, PresentationViewer, Dashboard, OfflineLibrary,
                Admin, DropboxSettings, UserManual, auth screens, PageNotFound
base44/
  entities/     JSON schemas for Presentation, DropboxConfig, SyncLog,
                PresentationAnalytics, LoginHistory
  functions/    syncDropbox, dropboxAuth, getPresentationStream, trackView,
                recordLogin, renameUntitledPresentations, getDownloadLinks
  shared/       dropboxClient.ts — OAuth, token refresh, resilient request wrapper
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

- **Token handling** — only the Dropbox *refresh* token is persisted. Access tokens are minted per
  request, held in isolate memory, auto-refreshed on 401, and never written to the database. The
  status endpoint returns an explicit allow-list that cannot leak the refresh token.
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
