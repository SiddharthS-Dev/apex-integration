# Inspironics Engineering Academy — How It Works

## What it is

A learning platform built from engineering playbooks. Playbooks (PDF/DOCX) come from a Dropbox folder or a manual upload. The Academy indexes them, extracts their chapters, designs a course (modules → lessons) with traceability back to the source, generates teaching content, quizzes, flashcards and exams with an AI model (Google Gemini by default, or a self-hosted Ollama model), and serves everything through a review-then-publish workflow, a learner catalog, tests and verifiable certificates.

**The governing rule: the browser never talks to Dropbox (or any storage).** Every Dropbox operation goes through the API, and file bytes are proxied through it. No Dropbox URL, access token or share link ever reaches a user.

## Repository layout

npm-workspaces monorepo:

| Path | Package | Role |
|---|---|---|
| `apps/web` | `@academy/web` | React client |
| `apps/api` | `@academy/api` | API: auth, entities + RLS, content pipeline, Dropbox integration, sync |
| `packages/shared` | `@academy/shared` | Contracts both import — entity schemas + RLS rules, query matcher, roles, file types. Imports nothing, so bare Node and Vite both consume it. |

## Tech stack

**Backend** — Node ≥ 22.5, ESM, Express 4 on port 4000. Dependencies: `express`, `cookie-parser`, `jszip` (DOCX), `pdf-parse` (PDF), `@resvg/resvg-js` + `ffmpeg-static` (slide videos), `nodemailer` (SMTP email), optional `pg`. No ORM, no Passport, no Dropbox SDK, no AI SDK (Gemini and Ollama are called over plain HTTP) — auth, RBAC, rate limiting, security headers, validation, logging, metrics and the scheduler are hand-rolled on the standard library.

**Storage** is dual-driver behind one interface: SQLite via `node:sqlite` for development (no native module to compile; Node prints an experimental warning) and Postgres for production (`DATABASE_URL`). Raw SQL through a repository layer with its own migration runner. Each entity gets its own table, generated from the shared schema; new schema properties are added as columns automatically.

**Auth** is a session cookie (`iea_session`, HttpOnly, SameSite=Lax, 12 h). Passwords are hashed with scrypt. Roles `admin` / `user` are enforced server-side, as are the per-entity row-level security rules from `packages/shared`. The first registered account becomes admin in development; with `NODE_ENV=production` it does not (unless `ALLOW_FIRST_USER_ADMIN=true`) — create the admin with `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD` instead. Sign-in runs the same password-hash work for unknown emails, and an email with `LOGIN_MAX_FAILURES` (default 10) consecutive failures is locked for 15 minutes (in memory, per process).

**Frontend** — React 18 + Vite 5, React Router 7, TanStack Query 5, Tailwind 3 + shadcn/ui, Recharts, react-markdown, jsPDF, qrcode-generator (certificate QR codes are drawn in the browser; no third-party QR service).

## Content pipeline

```
Dropbox folder ──sync──┐
Manual upload ─────────┴─► Playbook
  processPlaybookExtract    PDF/DOCX text → chapters (TOC-guided / hybrid / regex, LLM fallback) → PlaybookVersion snapshot
  processPlaybookStructure  course design → Course + Modules + Lessons (pending); old courses archived, never deleted
Content Studio (/admin/studio/:playbookId)
  generateLessonContent     teaching script, summary, key points, examples, 6 MCQs, 5 flashcards
  generateLessonMedia       slide video rendered with FFmpeg from the playbook chapter; voice-over optional (MEDIA_PROVIDER, off by default)
  generateAssessment        module test (15) · course assessment (50) · certification (60)
  processMeeting            meeting transcript → notes, decisions, requirements, action items (see Meetings)
  Approve All → Publish     learners see it at /courses
Learners → lessons → chapter tests → final test → certificate (/verify/:id is public)
```

All AI-generated content starts as `pending_review` and is invisible to learners until an admin approves it.

**AI** — `AI_PROVIDER=gemini` (default; Google Gemini over its REST API, `GEMINI_API_KEY`, `GEMINI_MODEL` defaulting to `gemini-3.8-flash` from `apps/api/src/config.js`) or `ollama` (`OLLAMA_BASE_URL` + `OLLAMA_MODEL`), with an optional `AI_FALLBACK_PROVIDER`. Responses are requested as structured JSON and validated. There is no Anthropic/Claude adapter: `AI_PROVIDER=anthropic` is not implemented. A course batch stopped by Gemini's daily quota is resumed automatically after the quota resets (the batch resumer runs with the other background jobs; `JOBS_ENABLED=false` turns them off). With `AI_ENABLED=false`, extraction and course structure still work (heuristic chapter/section detection). Lesson content and test generation need the model.

**Lesson videos** follow a teaching order per lesson type (concept, deep dive, example, architecture, demonstration, revision). Each scene's slide is designed from the playbook chapter in the layout that suits it — points, steps, checklist, a quoted rule, definition, do/don't, decision, table, timeline or code — and names its playbook section. Rules and code shown as the playbook's own words are checked against the chapter text; anything not found there is shown as plain points instead (`apps/api/src/pipeline/videoPlan.js`). **Rebuild slides** in the review screen redesigns the slides of an existing video without recording new narration.

**Media** — `MEDIA_PROVIDER=none` by default: no recorded narration, and learners can listen to the script via browser text-to-speech. `gemini`, `google`, `elevenlabs` or `piper` record a voice-over; providers live under `apps/api/src/media/`.

## Retention: review, notifications, recertification

**Daily review (spaced repetition).** Flashcards of the lessons a learner has completed enter their review queue at `/review`: up to 20 new cards a day, plus every card whose SM-2 due date has arrived. Each rating reschedules the card (`ReviewSchedule`) and is logged (`ReviewLog`); retention, streak, maturity and the 7-day forecast are computed from those logs. Functions: `getReviewQueue`, `submitFlashcardReview`. Due dates follow the learner's own calendar day (sent as `today`, accepted within a day of UTC).

**Notifications.** Every notice is an in-app `Notification` (the bell in the header) and, when the learner's `NotificationPreference` allows that kind, an email. Emails are written to the `email_outbox` table first and sent by a worker with exponential-backoff retries, so a provider outage delays mail rather than losing it. Dedupe keys make every notice idempotent. Providers: `EMAIL_PROVIDER=log` (default — the email goes to the server log, which is where password-reset links appear without an email service), `resend`, or `smtp`. Password resets and invites (a 7-day set-password link) are account emails and ignore preferences. Admins see delivery status and can send a test email in `/admin/integrations`.

**Recertification.** Certificates record the playbook version they were earned on. When a re-extract changes the playbook materially (chapters added, removed, or rewritten below 85 % word similarity), every learner holding a valid certificate gets a `Recertification` and their certificate becomes `recert_required`. It waits until a course built from the new version is published, then starts a due date (`Playbook.recert_grace_days`, default 30) and lists the lessons drawn from changed chapters. Passing the new course's final test issues a new certificate, supersedes the old one and closes the recertification. `Playbook.cert_validity_months` adds time-based expiry, and `recert_on_change` can switch change-driven recertification off. The daily job (`JOBS_HOUR_UTC`) expires certificates, warns 30 days ahead, and sends due-soon and overdue reminders. Admins track all of it in `/admin/compliance` (KPIs, per-playbook policy, waivers, CSV export). The public `/verify/:id` page shows whether a certificate is still current.

The logic lives in `packages/shared` (`review.js`, `recert.js`, `notifications.js`), so the API and the demo backend behave identically.

## Meetings

Teams meeting transcripts become meeting notes. Admins choose a **Meetings folder** in Dropbox (`/admin/integrations`); every sync turns the transcripts in it — the Word (`.docx`) download Teams offers, `.vtt` or `.txt` — into Meetings, never playbooks, even when the folder sits inside the playbook folder. Admins can also upload a transcript on the Meetings page (`POST /api/meetings/upload`).

`processMeeting` parses the transcript into speakers and timestamps (`packages/shared/src/meetings.js` reads the Teams Word layout, WebVTT and plain "Name: text" notes) and analyses it. With AI on, the configured model writes the purpose, summary, key ideas, decisions, requirements, action items (owner, due date resolved against the meeting date, priority, the exact quote and its time), open questions and risks; a long meeting is analysed in parts and merged. With AI off, keyword rules find likely action items and decisions (`Meeting.analysis_method` says which). Participation (turns, words, talk time) is computed from the transcript.

Action items are `ActionItem` rows matched to accounts by the owner's name. Notes start in review; `publishMeeting` shows them to every signed-in user, notifies them, and tells each owner what is theirs. Owners can change only the status of their own items; admins edit everything, and reprocessing keeps items a person edited or added. The daily job reminds owners the day before an item is due and once it is overdue. Deleting a meeting deletes its transcript and action items. A transcript changed in Dropbox is reprocessed and goes back to review.

## How Dropbox connects

OAuth 2 authorization-code flow with refresh tokens. An admin clicks **Connect** in `/admin/integrations`. The API builds a consent URL with `token_access_type=offline` (which makes Dropbox return a refresh token) and a CSRF `state`. Dropbox redirects to `DROPBOX_REDIRECT_URI` (default `http://localhost:4000/api/dropbox/oauth/callback`), which **must be registered character-for-character in the Dropbox App Console**.

- **Refresh token** — long-lived, encrypted with AES-256-GCM (`TOKEN_ENCRYPTION_KEY`) and stored in the database. This is the connection.
- **Access token** — ephemeral, minted on demand and held in process memory only. It is never written to the database, returned by an API or logged. Concurrent refreshes collapse to one call (in-process single-flight plus a DB lock).

Team spaces: every request carries `Dropbox-API-Path-Root` with the `root` variant, so Dropbox verifies the namespace is still current.

## The sync pipeline

Triggered by the scheduler (every `SYNC_INTERVAL_MINUTES`, default 30), by an admin's **Run sync now**, or at startup (`SYNC_ON_STARTUP`). A DB lock ensures only one runs at a time across instances.

1. **Discovery** — recursive, paginated `list_folder` from the configured root, filtered to `.pdf` / `.docx`.
2. **Compare** — each file is matched to its Playbook by Dropbox file id + revision. Unchanged files are skipped but get their last-seen stamp refreshed, so an interrupted sync resumes cheaply.
3. **Process** — sync itself reads metadata only. With `AUTO_EXTRACT_ON_SYNC=true`, new or changed files go through a bounded concurrency pool (`SYNC_CONCURRENCY`): each is downloaded into memory, extracted, and released — no copy is kept (`DROPBOX_SOURCE_CACHE=temporary`). A revision already extracted is never extracted again unless forced. Files over `MAX_EXTRACT_MB` are indexed but flagged, not parsed.
4. **Archive** — Dropbox playbooks not seen this run are marked `archived`, never deleted. This only runs when discovery fully succeeded, so a transient failure can't wipe the library. Narrowing the sync folder archives everything outside it.
5. **Bookkeeping** — counts, duration and errors go to `sync_log`. Status is `success`, or `partial` if any file failed.

## How it reaches the browser

The web app calls its own origin: in dev through the Vite proxy (`/api` → `:4000`), in production behind one domain. That's deliberate: the session is a SameSite=Lax cookie, and embedded media or iframes on a different origin would load without it and come back 401.

The client (`apps/web/src/api/client.js`) is swappable behind one interface: the API server (default) or the bundled in-browser demo backend (`VITE_BACKEND=demo`). No page or hook knows which one is in play.

Playbook files are served by `GET /api/playbooks/:id/content` (content proxy): uploads from the local object store, Dropbox files streamed straight from Dropbox (Range supported) without a copy on disk. Generated media comes from `GET /api/media/:key` (local, content-addressed object store, `apps/api/data/objects`), or `GET /api/outputs/:type/:id/video` for videos kept in Dropbox. Dropbox remains the source of truth.

Storage, clean-up, retention and Dropbox output are documented in [docs/dropbox/](docs/dropbox/) — start with [DROPBOX_OPTIMIZED_ARCHITECTURE.md](docs/dropbox/DROPBOX_OPTIMIZED_ARCHITECTURE.md). Admins see measured usage and run the clean-up in AI Studio → Storage & Dropbox.

## APEX Core identity (API, R1)

The API is also the APEX Core (ADR 0001; binding spec `docs/implementation/R1_IDENTITY_CONTRACT.md` at the repository root). The module lives in `apps/api/src/core/`; other modules use only `src/core/index.js`.

- **Tables** (migration `008_core_identity`, real FK/UNIQUE/CHECK constraints and partial unique indexes): `organizations`, `organization_memberships`, `role_assignments`, `identity_links`, `external_identities`, `audit_events` (append-only). No existing table is altered.
- **Backfill** (data migration `core_identity_backfill`, ADR 0004): the internal organisation `inspironics`; employee/leadership → membership + `staff`; intern → membership (title Intern) + `intern`, no `staff`; role admin → `platform_admin`; role user → `learner`. New accounts (register, invite, bootstrap admin) get the same mapping.
- **Compatibility:** `users.role` stays authoritative for the existing routes. Granting or revoking `platform_admin` (Core API, break-glass CLI, or the user admin's role change) keeps `users.role` in step in the same transaction. Membership and `staff` give no administrative rights.
- **Endpoints** (`/api/core`): `GET /me`; `GET /users?q=`, `GET /users/:id`; `GET|POST /organizations`; `GET|POST /organizations/:id/members`; `POST /memberships/:id/end`; `POST /role-assignments`, `/role-assignments/:id/revoke`, `/role-assignments/:id/transition`; `GET|POST /identity-links`, `POST /identity-links/:id/confirm|reject`; `GET /audit-events`; `POST /auth/google`, `POST /auth/google/accept-invite`, `POST /external-identities/google` (404 unless `GOOGLE_CLIENT_ID`); `POST /identity/resolve` (gateway only, `X-Apex-Service` assertion). Every mutation writes an audit event in its own transaction.
- **Break-glass admin:** `npm run core:grant-admin -w @academy/api -- --email <email> --reason "<why>"` (the only way past "nobody grants themselves platform_admin").
- **Link proposals:** `node tools/identity/propose-links.mjs` (dry run; `--apply` inserts `proposed` links only; `--core-db <path>` selects the Core database). Never confirms.
- **Rollback:** back up the database, then `npm run core:rollback-identity -w @academy/api -- --yes` drops the R1 tables (`008_core_identity`'s six and `009`'s `user_session_epochs`) and removes their migration records; then deploy pre-R1 code (an R1 server re-applies the migration on start). Pre-R1 tables and rows are untouched.
- **Settings** (all optional, defaults = pre-R1 behaviour): `GOOGLE_CLIENT_ID`, `CORE_EXTERNAL_ORGS_ENABLED`, `APEX_IDENTITY_KEYS`, `APEX_IDENTITY_ISSUER`, `APEX_IDENTITY_TRUSTED_SOURCES` — see `apps/api/.env.example`.

## Running it

```bash
npm install
cp apps/api/.env.example apps/api/.env     # fill in what you need (all optional for a first run)
npm run dev                                 # API :4000 + web :5173
```

Open http://localhost:5173 and register — in development the first account is admin.

- **AI:** set `AI_ENABLED=true` and `GEMINI_API_KEY` (or `AI_PROVIDER=ollama` with `OLLAMA_BASE_URL` and `OLLAMA_MODEL`).
- **Dropbox:** create an app in the Dropbox App Console. Register the redirect URI, then set `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` and `TOKEN_ENCRYPTION_KEY`. Connect from `/admin/integrations`.
- **Production:** set `DATABASE_URL` (Postgres), `NODE_ENV=production`, `COOKIE_SECURE=true`, `APP_ORIGIN` and `BOOTSTRAP_ADMIN_EMAIL`/`BOOTSTRAP_ADMIN_PASSWORD`. Serve `apps/web/dist` and the API behind one domain.
- **UI without a server:** `VITE_BACKEND=demo npm run dev:web`.
- **Tests:** `npm test -w @academy/api` (281 tests; nothing calls a paid API, Google or sends mail).

Email: with the default `EMAIL_PROVIDER=log` nothing leaves the server — reset links appear in the API log for an operator to hand over, and admin invites return a one-time temporary password. Set `EMAIL_PROVIDER=resend` or `smtp` to deliver them (and notifications) by email.
