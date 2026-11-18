# APEX — Full Audit and Remediation Report

Date: 2026-11-12 · Branch: `Feature-base-removal` · Repository: `github.com/SiddharthS-Dev/apex-integration`

This report records what was inspected, what was measured, what was found, and what was changed. Every
"pass" below comes from a command that was run; anything not verified is labelled as such.

---

## A. Executive summary

| | |
|---|---|
| Applications discovered | 4: Inspironics Academia, Innovation Showcase, SlidesVault, Apex gateway (plus a retired `legacy/nextjs-app` inside Showcase) |
| Modules audited | 4 of 4 applications; all API routers, auth layers, data layers, job runners and integrations were inventoried |
| Baseline (before changes) | 15 of 15 test/build steps passed: 553 automated tests (Academia API 223, Showcase API 49 + web 75 + shared 3, SlidesVault API 203), 3 production builds, Showcase architecture/type/route/env checks |
| Issues recorded | 26 (P0 1 · P1 4 · P2 9 · P3 8 · P4 4) |
| Fixed and regression-tested | 14 (8 in the audit pass, 6 in the follow-up "fix it" pass) |
| Open | hardening items only (listed in J); no P0/P1 remains |
| Production readiness | **No P0 or P1 issue remains.** Remaining items are P2–P4 hardening (J). Not verified: a real Docker build, browser click-through of every page, Postgres mode, real Dropbox/email delivery, load. |

What "all tests pass" does and does not mean here: the suites are good at the server rules they cover,
but there are no frontend tests in Academia or SlidesVault, no browser end-to-end runs in CI, and no CI
runs at all for this repository (F-002).

---

## B. Architecture inventory

| Module | Purpose | Frontend | Backend | Database | Integrations | Tests | Status |
|---|---|---|---|---|---|---|---|
| **Apex gateway** (`apex/`) | Single sign-in and reverse proxy for the three apps (dev :5173, prod :4173) | Static login + dashboard pages | Dependency-free Node HTTP server (`server.mjs`, `auth.mjs`) | None (stateless HMAC session cookie) | The three app APIs | None | Operational |
| **Inspironics Academia** | Engineering academy: playbooks → AI-generated courses, lessons, quizzes, tests, certificates, spaced repetition, recertification, meetings → action items and briefing videos, AI Studio | React + Vite (`apps/web`, :5176) | Express on Node 22 (`apps/api/src/server.js`, :4177) | SQLite (`node:sqlite`, `data/academy.db`) or Postgres via `DATABASE_URL`; 36 tables, 125 indexes | Gemini (text + TTS), Ollama, Google TTS, ElevenLabs, Piper, FFmpeg, Dropbox (OAuth, sync, video output), email (log/Resend/SMTP) | API 231 tests | Operational |
| **Innovation Showcase** | Gallery of innovation material synced from Dropbox, AI titles/categories, admin console, analytics, PDF report, offline library, 3D ecosystem | React 18 + Vite (`apps/web`, :5174), three.js, jsPDF | Express 4 (`apps/api/src/server.js`, :4176) | SQLite or Postgres; one migration | Dropbox OAuth, Google sign-in, Anthropic | API 52, web 75, shared 3; architecture, types, routes, env and bundle checks | Operational |
| **SlidesVault** | Presentation library backed by Dropbox, preview/thumbnail cache, AI classification and Copilot | React + Vite PWA (`apps/web`, :5175, base `/vault/`) | Express 4 (`apps/api/src/index.js`, :4175) | SQLite or Postgres | Dropbox, Google sign-in, Anthropic | API 203 (unit, integration, e2e) | Operational locally; **Docker image does not build** (F-012) |
| `legacy/nextjs-app` (in Showcase) | Retired predecessor | Next.js | Express with open CORS | Postgres | OpenAI | None | Dead code, still committed |

Background work: Academia — job worker (2 s), sync scheduler (30 min), email outbox (1 min), daily jobs, storage maintenance, course-batch resumer (15 min), session purge, interrupted-lesson release. Showcase — Dropbox sync scheduler with a DB lock, daily cache purge, hourly session purge. SlidesVault — sync scheduler with advisory locks, cache purge.

Multi-tenancy: none of the apps is multi-tenant. Each is a single organisation; "tenant isolation" tests therefore became per-user and per-role isolation tests (learner vs admin, viewer vs admin).

---

## C. Module test report

| Module | Automated tests (before → after) | Failed | Builds / checks | Status |
|---|---:|---:|---|---|
| Academia API | 223 → 234 | 0 | — | Pass |
| Academia web | none | — | `vite build` pass | Build only |
| Showcase API | 49 → 52 | 0 | — | Pass |
| Showcase web | 75 | 0 | `lint:arch`, `typecheck`, `check:routes`, `check:env`, `vite build` pass | Pass |
| Showcase shared | 3 | 0 | — | Pass |
| SlidesVault API | 203 | 0 | — | Pass |
| SlidesVault web | none | — | `vite build` pass | Build only |
| Apex gateway | none | — | — | Not tested automatically |

After the fixes all 15 steps pass again (531 API/unit tests + 75 web tests, 3 production builds,
Showcase checks). One incident during the audit: `npm audit fix --omit=dev` also removed the dev
dependencies (vite, esbuild) from `node_modules`, which broke the web builds; they were restored with
`npm install` from the unchanged lockfiles and every step was re-run green.

Commands were run with `TMP`/`TEMP` and npm's cache on drive E: because drive C: is full (see F-013). Logs:
`E:\apex-review-tmp\baseline\*.log` (before) and `E:\apex-review-tmp\after\*.log` (after).

---

## D. Bug register

| ID | Module | Issue | Sev. | Root cause | Status |
|---|---|---|---|---|---|
| F-001 | Academia | The pushed branch `origin/Feature-base-removal` (c01a30a) imports `pipeline/lessonQuality.js` and `lib/tempEnv.js`, which are not in Git: a fresh clone's API stops at start-up with "module not found" | **P0** | Commits 187376b/c01a30a were made without the two new files | **Fixed** — `44694b4` (verified on a clean checkout: 223/223) |
| F-005 | Academia | Any signed-in learner can read approved `Question` records including `correct_answer`; the certificate test is graded against those same records, so the answer key can be fetched before sitting the test | **P1** | Question read rule exposes every field; lesson quizzes and chapter tests are scored in the browser, so they need the answers there | **Fixed** — `3c4500d`: answers stripped for learners, `submitQuiz` grades lesson quizzes and chapter tests on the server, attempts are server-written |
| F-004 | Showcase | Account pre-hijack: an attacker registers a victim's email with a password; when the victim later signs in with Google the account is marked verified and keeps the attacker's password | **P1** | Google sign-in set `verified` without discarding the unverified password | **Fixed** — `2ccbb9b` |
| F-006 | Academia | Two concurrent `bulkCreate` calls: the second fails with "cannot start a transaction within a transaction" and its rows are lost (reproduced: 50 of 100 flashcards saved); other requests' writes could also be rolled back with someone else's transaction | **P1** | One shared SQLite connection; `transaction()` ran `BEGIN` and then awaited, with no serialisation | **Fixed** — `2ccbb9b` |
| F-012 | SlidesVault | Docker image cannot build: build context `./apps/api` lacks the workspace package `@slidesvault/shared`; the `\|\| npm install` fallback would fetch that name from the public registry (dependency-confusion risk — the name is currently unregistered) | **P1** (deploy) | Dockerfile/compose written for a single package, not the workspace | **Fixed** — `58e01c8`: built from the workspace root with `npm ci -w`, no registry fallback. Verified by replaying both stages on E: (108 packages, shared linked locally, API healthy in production mode); a real `docker build` was not run (Docker Desktop's data is on the full C: drive) |
| F-007 | Academia | A learner can set `final_passed`/`final_score` on their own CourseProgress and create a `type: 'final'` QuizAttempt; admin dashboards count these as completed courses (certificates are not affected — only the server issues them) | P2 | Row rule only checks `user_id`; no field-level rule | **Fixed** |
| F-002 | Repository | No CI runs: the only workflow is `inspironics-innovation-showcase/.github/workflows/ci.yml`; GitHub runs workflows only from the repository root | P2 | Workflow kept from when Showcase was its own repository | Documented (adding root CI is a release decision) |
| F-008 | Academia | `GET /api/outputs/lesson/:id/video` served the video of an unapproved lesson, or one outside the learner's categories | P2 | Route checked meetings and projects but not lessons | **Fixed** |
| F-009 | All three apps | Dependency advisories fixable within the current major: body-parser (high, DoS), qs, postcss-selector-parser, source-map-js, zod | P2 | Outdated lockfiles | **Fixed** (patch updates) |
| F-010 | All three apps | jsPDF ≤ 4.2.0 (critical ReDoS/DoS) with DOMPurify (high, XSS) and react-router ≤ 7.17 (moderate, open redirect) | P2 | Fix requires a major upgrade | **Fixed** — `da776b6`: jsPDF 4.2.1, react-router 7.18.5, unused react-quill-new removed; `npm audit --omit=dev` = 0 in all three apps; PDF smoke test valid for all three apps' patterns |
| F-011 | Academia, SlidesVault | First account on an empty database becomes admin, and open registration is on by default; Showcase does the same outside production | P2 | Bootstrap convenience | Documented — set the bootstrap admin before exposing a fresh deployment |
| F-014 | Academia, Showcase, SlidesVault | Login brute-force limits are in memory per process (reset on restart, not shared), no per-account lockout in Academia/Showcase; unknown emails skip the password hash (timing reveals accounts) | P2 | Simple limiter | Documented |
| F-015 | Apex gateway | `apex_session` cookie never `Secure` and cannot be revoked before expiry (stateless HMAC) | P2 | Gateway built for local use | Documented (matters only behind HTTPS) |
| F-016 | Showcase | PPTX/PDF extraction has no cap on decompressed size (zip bomb in the synced folder can exhaust memory) | P2 | JSZip used without size accounting | Documented |
| F-017 | Showcase | `/plates/:id/describe` (AI call, downloads the document) is open to guests | P3 | Guest access on by default | Documented |
| F-018 | Showcase | `GET /api/auth/pending` told anyone whether a code was pending for any email (unused by the web app) | P3 | Leftover endpoint | **Fixed** (removed) |
| F-019 | Academia | CORS preflight omitted PUT, breaking `PUT /studio/limits` and `/studio/storage/output` when the web app is on another origin | P3 | Method list | **Fixed** |
| F-020 | Academia | Learners can force full-table loads with filters on JSON/unknown keys (falls back to `SELECT *` without LIMIT, filtered in JS) | P3 | Generic query fallback | Documented |
| F-021 | SlidesVault | `docker-compose` `api-pg` sets `replicas: 2` with a fixed host port (replicas collide); Postgres password defaults to `slidesvault` | P3 | Compose config | **Fixed** (replica port) — `58e01c8`; the default Postgres password remains (set `POSTGRES_PASSWORD`) |
| F-003 | All | Requests to `localhost` take ~210 ms instead of ~3 ms: servers listen on IPv4 only, clients try IPv6 (`::1`) first | P3 | Bind address | Documented (use `127.0.0.1` or also bind `::1`) |
| F-022 | Academia | Course content: lessons left blank because generation ran in the browser and stopped when the page closed or quota ran out | P3 | Client-side loop | **Fixed earlier today** (server batch, completeness gate, auto-resume) |
| F-023 | Academia | No database-level foreign keys/unique constraints on entity tables (integrity relies on application checks) | P3 | Generic entity schema | Documented; live data checked clean (G) |
| F-013 | Environment | Drive C: is full (0 MB free); render tests fail there and the system temp folder is unusable | P3 | Machine | Needs you — free space on C: |
| F-024 | Showcase | `legacy/nextjs-app` is dead code with open CORS and old dependencies, still committed | P4 | Retired code kept | Documented |
| F-025 | SlidesVault | Standalone `start.bat` is out of date (root `.env`, port 5173 vs base `/vault/`, binds all interfaces) | P4 | Superseded by the root launcher | Documented |
| F-026 | Repository | Stray untracked file at the root named `ync handling"` (713 bytes) | P4 | Accidental file | Left untouched (your file) |

---

## E. Security report

**Authentication.** All three apps hash passwords with scrypt and per-user salts and compare in constant
time; sessions are random tokens stored as SHA-256 hashes in httpOnly, SameSite=Lax cookies (Secure in
production), 12 h lifetime, revoked on password change. Weaknesses: in-memory per-process rate limits,
no account lockout (Academia, Showcase), timing difference for unknown emails (F-014), first-user-admin on
an empty database (F-011), and the Showcase pre-hijack (F-004, fixed).

**Authorization.** Server-side checks exist for every mutating endpoint; frontend admin guards only hide UI
and the server enforces the real rule. Academia's generic entity layer applies declarative row rules on
list/get/create/update/delete and re-checks the merged record on update, so a learner cannot move a
record out of their reach. Gaps found: answers readable by learners (F-005, open), learner-written final
results (F-007, fixed), lesson video route (F-008, fixed).

**Injection, paths, uploads.** No SQL built from user input in any app: filter keys and sort fields are
allow-listed and values bound. Object-store keys are validated (hex) and Dropbox paths reject `..`; no
local path traversal found. Academia uploads are size-capped and type-checked by extension (scene images
by magic bytes). Synced HTML is served in a sandbox CSP (Showcase, SlidesVault).

**CSRF / CORS.** SameSite=Lax plus Origin checks on writes; CORS is a single-origin or exact allow-list
with credentials. The gateway strips client `X-Forwarded-*` headers and blocks open redirects.

**Secrets.** No secret values in tracked files or anywhere in Git history (pattern scan for Google,
Anthropic, OpenAI, GitHub, Slack, Dropbox tokens and private keys — only placeholders and test strings
matched). No `.env`, database or key file is tracked. `.env` files exist locally and are git-ignored;
their values were not read for this report.

**Dependencies.** See F-009 (fixed) and F-010 (needs major upgrades). Remaining after the fix:
Academia 6 (jsPDF, DOMPurify, react-router ×2, quill, react-quill-new), Showcase 4, SlidesVault 4.

---

## F. Database report (Academia live database, read-only)

Opened read-only (`node:sqlite`, `readOnly: true`); nothing was modified.

| Check | Result |
|---|---|
| `PRAGMA integrity_check` | ok |
| Orphans across every `*_id` reference (course, module, lesson, playbook, chapter, assessment, meeting, team, user, category) | none |
| Duplicate module tests per module / final assessments per course | none |
| Duplicate user emails (case-insensitive) | none |
| More than one active course per playbook | none |
| Quiz questions whose answer is not one of their options | none |
| Lessons stuck in "generating" | none |
| Jobs | 6, all completed |
| Size | 714 lessons, 2,523 questions, 1,340 flashcards, 1,074 chapters, 200 modules, 11 courses |

Migrations: 8 applied, idempotent; every test run applies them to a fresh database (passes). Schema risk:
no foreign keys or unique constraints on entity tables (F-023); concurrent transactions (F-006, fixed).
Showcase and SlidesVault: migrations applied to fresh in-memory/temporary databases by their test suites
(pass); production databases were not opened.

---

## G. Integration report

| Integration | App | Verification level |
|---|---|---|
| Gemini text (generateContent) | Academia | Real service verified (earlier today: lesson generated, 1,267-word script, quality 100); unit-tested with mocks |
| Gemini TTS | Academia | Real service verified earlier (MP4 briefing rendered); mock-tested |
| Ollama | Academia | Mock-tested only |
| Google TTS, ElevenLabs, Piper | Academia | Mock-tested only |
| FFmpeg rendering | Academia | Locally integration-tested (real FFmpeg in tests) |
| Dropbox (OAuth, sync, output) | All three | Mock-tested with fake Dropbox servers; real account not exercised in this audit (read-only policy) |
| Google sign-in | Showcase, SlidesVault | Mock/demo path tested |
| Anthropic | Showcase, SlidesVault | Mock-tested only (no paid calls made) |
| Email (Resend/SMTP) | Academia | Log transport tested; real delivery not verified |
| Postgres driver | All three | Not tested (no Postgres service running) |
| Docker images | SlidesVault | Not tested — Docker daemon not running; build context defect found by reading (F-012) |

---

## H. Performance report

Method: 20 sequential HTTP requests per endpoint with `curl` from the same machine (Windows 11, Node 22,
dev servers running, Academia database as in F).

| Endpoint | via `localhost` | via `127.0.0.1` |
|---|---|---|
| Academia `/api/health` | avg 211 ms, max 221 ms | avg 3.1 ms, max 3.8 ms |
| Showcase `/api/health` | avg 211 ms | avg 3.0 ms |
| SlidesVault `/api/health` | avg 215 ms | avg 3.5 ms |
| Gateway `/` | avg 214 ms | avg 2.8 ms |

The 200 ms difference is IPv6-then-IPv4 fallback, not server time (F-003). Test-suite durations: Academia
API 31–34 s, Showcase API 44 s, SlidesVault API 15 s. Production builds: 13–26 s. Bundle size budgets are
enforced only in Showcase (`check:bundle`). No load test was run; query plans were not profiled.

---

## I. Remediation report

| Fix | Problem | Change | Files | Regression tests | Result |
|---|---|---|---|---|---|
| F-006 | Concurrent transactions failed / mixed | Transactions run one at a time; statements from outside an open transaction wait for it (AsyncLocalStorage); nested transactions join | `Inspironics Academia/apps/api/src/db/sqlite.js` | `test/sqliteTransactions.test.js` (3) | Repro now 100/100 rows; pass |
| F-007 | Learner-written final results | Field rule: non-admins cannot change `CourseProgress.final_passed/final_score` or create/convert a `final` QuizAttempt; unchanged values may be saved back; admins unaffected; `submitFinalTest` unaffected | `apps/api/src/entities/routes.js` | `test/securityBoundaries.test.js` (3) | pass |
| F-008 | Lesson video ignored the lesson read rule | Same rule and category scope as `GET /entities/Lesson/:id` | `apps/api/src/files/routes.js` | `securityBoundaries.test.js` | pass |
| F-019 | CORS without PUT | Added PUT | `apps/api/src/http/middleware.js` | `securityBoundaries.test.js` | pass |
| F-004 | Google pre-hijack | Google sign-in on an unverified account drops the stored password | `inspironics-innovation-showcase/apps/api/src/routes/auth.js` | `test/http.test.mjs` (2) | pass |
| F-018 | Email enumeration endpoint | Removed unused `GET /api/auth/pending` | same file | `test/http.test.mjs` (1) | pass |
| F-009 | Dependency advisories | `npm audit fix` without `--force` (patch versions only) | three `package-lock.json` files | full suites + builds | see C |
| F-022 | Blank lesson content | (earlier today) server-side batch, completeness gate, auto-resume, editor notice | Academia api/web | `maintenance.test.js`, `gemini.test.js`, `contentPipeline.test.js` | pass |

---

## J. Remaining work (and why)

All P0 and P1 issues are fixed. What remains:

1. **F-002 — CI.** Add a root `.github/workflows` that runs the three apps' tests and builds (a repository/release decision).
2. **Hardening (P2–P3):** F-011 first-user-admin and open registration (set the bootstrap admin before exposing a fresh deployment), F-014 in-memory rate limits and login timing, F-015 gateway cookie `Secure`/revocation behind HTTPS, F-016 zip-bomb limits in Showcase extraction, F-017 guest AI calls, F-020 unbounded JSON-key filters, F-023 database constraints, F-003 IPv6 bind.
3. **Environment:** F-013 — drive C: is nearly full; free space there (Docker Desktop, npm's cache and system temp live on it).
4. **Not verified:** a real `docker build` (daemon not runnable with C: full), browser click-through of every page and mobile layouts, Postgres mode, real Dropbox/email delivery, load testing.

## K. Git report

| | |
|---|---|
| Branch | `Feature-base-removal`, tracking `origin/Feature-base-removal` |
| Starting HEAD | `c01a30a` |
| Commits pushed (one at a time, each tested) | `44694b4` missing modules + complete lesson content · `2ccbb9b` transactions and access gaps · `dd204d2` in-range dependency fixes · `3c4500d` server-side quiz grading · `58e01c8` SlidesVault image · `da776b6` jsPDF 4 / react-router 7 · this report |
| Final validation | Academia API 234/234, Showcase API 52/52 + web 75/75 + shared 3/3, SlidesVault API 203/203; three production builds; Showcase architecture, types, routes, env and bundle budget (67.1 KB of 90 KB) |
| Untracked, left alone | the stray `ync handling"` file |
| Pre-existing user changes | none overwritten; no `reset`, `clean`, `checkout --`, `restore`, force-push or branch switch |
