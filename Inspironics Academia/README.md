# Inspironics Engineering Academy — How It Works

## What it is

A learning platform built from engineering playbooks. Playbooks (PDF/DOCX) come from a Dropbox folder or a manual upload. The Academy indexes them, extracts their chapters, designs a course (modules → lessons) with traceability back to the source, generates teaching content, quizzes, flashcards and exams with Claude, and serves everything through a review-then-publish workflow, a learner catalog, tests and verifiable certificates.

**The governing rule: the browser never talks to Dropbox (or any storage).** Every Dropbox operation goes through the API, and file bytes are proxied through it. No Dropbox URL, access token or share link ever reaches a user.

## Repository layout

npm-workspaces monorepo:

| Path | Package | Role |
|---|---|---|
| `apps/web` | `@academy/web` | React client |
| `apps/api` | `@academy/api` | API: auth, entities + RLS, content pipeline, Dropbox integration, sync |
| `packages/shared` | `@academy/shared` | Contracts both import — entity schemas + RLS rules, query matcher, roles, file types. Imports nothing, so bare Node and Vite both consume it. |
| `legacy/base44` | — | Retired Base44 artifacts (reference only) |

## Tech stack

**Backend** — Node ≥ 22.5, ESM, Express 4 on port 4000. Dependencies: `express`, `cookie-parser`, `jszip` (DOCX), `pdf-parse` (PDF), `@anthropic-ai/sdk`, optional `pg`. No ORM, no Passport, no Dropbox SDK — auth, RBAC, rate limiting, security headers, validation, logging, metrics and the scheduler are hand-rolled on the standard library.

**Storage** is dual-driver behind one interface: SQLite via `node:sqlite` for development (no native module to compile; Node prints an experimental warning) and Postgres for production (`DATABASE_URL`). Raw SQL through a repository layer with its own migration runner. Each entity gets its own table, generated from the shared schema; new schema properties are added as columns automatically.

**Auth** is a session cookie (`iea_session`, HttpOnly, SameSite=Lax, 12 h). Passwords are hashed with scrypt. Roles `admin` / `user` are enforced server-side, as are the per-entity row-level security rules from `packages/shared`. The first registered account becomes admin.

**Frontend** — React 18 + Vite 5, React Router 6, TanStack Query 5, Tailwind 3 + shadcn/ui, Recharts, react-markdown, jsPDF.

## Content pipeline

```
Dropbox folder ──sync──┐
Manual upload ─────────┴─► Playbook
  processPlaybookExtract    PDF/DOCX text → chapters (TOC-guided / hybrid / regex, LLM fallback) → PlaybookVersion snapshot
  processPlaybookStructure  course design → Course + Modules + Lessons (pending); old courses archived, never deleted
Content Studio (/admin/studio/:playbookId)
  generateLessonContent     teaching script, summary, key points, examples, 6 MCQs, 5 flashcards
  generateLessonMedia       video + narration (pluggable provider, off by default)
  generateAssessment        module test (15) · course assessment (50) · certification (60)
  Approve All → Publish     learners see it at /courses
Learners → lessons → chapter tests → final test → certificate (/verify/:id is public)
```

All AI-generated content starts as `pending_review` and is invisible to learners until an admin approves it.

**AI** — Claude through `@anthropic-ai/sdk` (`ANTHROPIC_MODEL`, default `claude-opus-5`) with structured JSON outputs, adaptive thinking, streaming, and server-side refusal fallbacks enabled. With `AI_ENABLED=false`, extraction and course structure still work (heuristic chapter/section detection). Lesson content and test generation need the model.

**Media** — `MEDIA_PROVIDER=none` by default: lessons show a gradient placeholder and learners can listen to the script via browser text-to-speech. Providers plug in under `apps/api/src/media/`.

## How Dropbox connects

OAuth 2 authorization-code flow with refresh tokens. An admin clicks **Connect** in `/admin/integrations`. The API builds a consent URL with `token_access_type=offline` (which makes Dropbox return a refresh token) and a CSRF `state`. Dropbox redirects to `DROPBOX_REDIRECT_URI` (default `http://localhost:4000/api/dropbox/oauth/callback`), which **must be registered character-for-character in the Dropbox App Console**.

- **Refresh token** — long-lived, encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and stored in the database. This is the connection.
- **Access token** — ephemeral, minted on demand and held in process memory only. It is never written to the database, returned by an API or logged. Concurrent refreshes collapse to one call (in-process single-flight plus a DB lock).

Team spaces: every request carries `Dropbox-API-Path-Root` with the `root` variant, so Dropbox verifies the namespace is still current.

## The sync pipeline

Triggered by the scheduler (every `SYNC_INTERVAL_MINUTES`, default 30), by an admin's **Run sync now**, or at startup (`SYNC_ON_STARTUP`). A DB lock ensures only one runs at a time across instances.

1. **Discovery** — recursive, paginated `list_folder` from the configured root, filtered to `.pdf` / `.docx`.
2. **Compare** — each file is matched to its Playbook by Dropbox file id + revision. Unchanged files are skipped but get their last-seen stamp refreshed, so an interrupted sync resumes cheaply.
3. **Process** — new or changed files go through a bounded concurrency pool (`SYNC_CONCURRENCY`). Each is downloaded into the object store (keyed by file id + revision) and auto-extracted (`AUTO_EXTRACT_ON_SYNC`). Files over `MAX_EXTRACT_MB` are indexed but flagged, not parsed.
4. **Archive** — Dropbox playbooks not seen this run are marked `archived`, never deleted. This only runs when discovery fully succeeded, so a transient failure can't wipe the library. Narrowing the sync folder archives everything outside it.
5. **Bookkeeping** — counts, duration and errors go to `sync_log`. Status is `success`, or `partial` if any file failed.

## How it reaches the browser

The web app calls its own origin: in dev through the Vite proxy (`/api` → `:4000`), in production behind one domain. That's deliberate: the session is a SameSite=Lax cookie, and embedded media or iframes on a different origin would load without it and come back 401.

The client (`apps/web/src/api/client.js`) is swappable behind one interface: the API server (default) or the bundled in-browser demo backend (`VITE_BACKEND=demo`). No page or hook knows which one is in play.

Playbook files are served by `GET /api/playbooks/:id/content` (content proxy) and generated media by `GET /api/media/:key`. Both come out of a local, content-addressed object store (`apps/api/data/objects`). The cache is disposable; Dropbox remains the source of truth.

## Running it

```bash
npm install
cp apps/api/.env.example apps/api/.env     # fill in what you need (all optional for a first run)
npm run dev                                 # API :4000 + web :5173
```

Open http://localhost:5173 and register — the first account is admin.

- **AI:** set `AI_ENABLED=true` and `ANTHROPIC_API_KEY`.
- **Dropbox:** create an app in the Dropbox App Console. Register the redirect URI, then set `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `TOKEN_ENCRYPTION_KEY`. Connect from `/admin/integrations`.
- **Production:** set `DATABASE_URL` (Postgres), `NODE_ENV=production`, `COOKIE_SECURE=true` and `APP_ORIGIN`. Serve `apps/web/dist` and the API behind one domain.
- **UI without a server:** `VITE_BACKEND=demo npm run dev:web`.
- **Tests:** `npm test -w @academy/api`.

Password resets: there is no email service, so reset links are written to the API log for an operator to hand over. Admin invites return a one-time temporary password.
