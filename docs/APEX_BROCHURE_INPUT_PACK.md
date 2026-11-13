# Inspironics Apex — Brochure Input Pack

Prepared from the `Feature-base-removal` branch of the Apex repository (latest commit `403c989`), 13 November 2026.
Every capability below points at source code, configuration, tests or documentation in that repository. Paths are relative to the repository root.
Maturity levels:
- **LIVE**: implemented, wired into the UI or API, and covered by automated tests.
- **IN PROGRESS**: partly built, stubbed, tested only against mocks, or not yet usable in production.
- **ROADMAP**: named in docs, data or UI, but with no working code.

Important context for every LIVE label:
- Apex has been built and tested on a single development machine.
- Every Dropbox integration, plus Google sign-in, Anthropic (Claude), most voice providers and email delivery, has been exercised only against fakes and mocks (`docs/architecture/APEX_FULL_AUDIT_REPORT.md`, section G).
- The only real third-party service verified is Google Gemini (text and text-to-speech), in Academia.
- Postgres mode, a real Docker build, load testing and a browser click-through of every page have not been run (audit, section J).
- No paying customer or production deployment is evidenced in the repository.

LIVE therefore means "built and tested", not "proven in a customer's production environment".

---

## 1. Product identity

**Official product name:** Inspironics Apex. "Apex" is the platform; it fronts three products.

**Other names found in the repository**

| Name | Where |
|---|---|
| Apex | `README.md` title; dashboard `<title>Apex · Inspironics</title>` (`apex/public/index.html`) |
| Inspironics Apex | sign-in page label (`apex/public/login.html`); explainer video narration (`demo video/Apex_Explainer.srt`) |
| Innovation Showcase / Inspironics Innovation Showcase | `inspironics-innovation-showcase/` (npm `inspironics-innovation-showcase`, `@inspironics/web`, `@inspironics/api`); browser title |
| SlidesVault / Inspironics SlidesVault / "Presentation Knowledge Hub" | `slide vault/` (npm `inspironics-slidesvault`, `@slidesvault/*`); web manifest. The README sometimes spells it "Slide Vault" |
| Inspironics Academia | the gateway's name for the Academia app (`apex/projects.mjs`), email sender, video slides |
| Inspironics Engineering Academy / Inspironics Learn / Inspironics Academy | Academia's browser title and certificate (`Inspironics Academia/apps/web/index.html`), in-app logo (`AppShell.jsx`), demo author. **Four names for one product — pick one.** |
| Showcase Copilot / SlidesVault Copilot | assistant panels in the Showcase and SlidesVault |
| Plates | the unit of the Showcase library (`/api/entities/plates`) |
| AI Studio | Academia's content, voice and video generation workspace |

**Product category:** a single sign-in hub for an organisation's innovation portfolio, presentation library and engineering learning, all held in Dropbox. It is self-hosted.

**Description (75 words)**
Inspironics Apex gives an organisation one front door to three products: an Innovation Showcase of solution blueprints, SlidesVault for presentations, and Academia, which turns engineering playbooks into courses, tests and verifiable certificates. People sign in once, see which products are ready, and move between them at one address. Files stay in the organisation's Dropbox, and every byte passes through Apex's own servers. AI is optional: it drafts titles, classifications and lesson content for people to review.

---

## 2. The problem it solves

**1. Knowledge scattered across folders**
Our blueprints, decks and playbooks sit in shared folders. They are hard to search and hard to present, and nobody can tell what is being used. We need one place where all of it is organised, searchable and ready to view.

**2. Playbooks that nobody learns from**
Engineering playbooks are written once and rarely read. We need to turn them into structured courses with tests. We also need to know who has completed them, and when a changed playbook means people must re-certify.

**3. Too many tools, too many logins**
Each product has its own address and password. We need one sign-in that opens everything, one sign-out that closes everything, and files that stay in the storage we already own.

---

## 3. Target buyers

**Industries and sectors**

| Sector | Why the product fits |
|---|---|
| Engineering and technology services firms | Playbook-to-course pipeline, recertification when playbooks change, meeting action items (`Inspironics Academia/apps/api/src/pipeline/`). |
| Solution and system integrators (smart buildings, energy, IoT) | Showcase taxonomy of 11 technologies and 8 industry zones, built for presenting solution blueprints (`inspironics-innovation-showcase/packages/shared/src/taxonomy.js`). |
| Pre-sales and sales teams in B2B technology | SlidesVault deck library with search, viewer, offline reading and usage analytics (`slide vault/`). |
| Organisations standardised on Dropbox | All three products sync from Dropbox; files are proxied, never linked (`README.md`, "Both projects run on Dropbox"). |
| Organisations that need self-hosting | The gateway has no dependencies; the whole stack runs from one command on the organisation's own machine (`start.bat`, `apex/server.mjs`). |

**Stakeholders**

| Stakeholder | Their core question | What the product provides |
|---|---|---|
| CTO / Head of Engineering | "Do our engineers know our playbooks, and are they current?" | AI-drafted, human-approved courses from playbooks; server-graded tests; certificates; recertification triggered when a playbook changes. |
| Head of Sales / Pre-sales | "Can my team find and present the right deck and blueprint?" | SlidesVault search, viewer and offline reading; Showcase gallery, 3D ecosystem explorer and monthly PDF report. |
| Head of Learning & Development | "Who has completed what, and who needs to re-certify?" | Admin dashboard, compliance view with CSV export, spaced-repetition review, reminders. |
| CIO / IT | "Is it secure, self-hosted and simple to run?" | One sign-in at one address. Server-side access checks. Encrypted Dropbox tokens, with Dropbox never contacted from the browser. Loopback-only by default. |
| Marketing / Innovation office | "Can we show our portfolio well and see what interests people?" | Immersive gallery, Daily Spotlight, view/download analytics, monthly report. |

---

## 4. Feature inventory (all features)

### Apex front door (gateway and dashboard, `apex/`)

| # | Feature | Business benefit (one line) | Evidence | Maturity |
|---|---|---|---|---|
| 1 | One sign-in for all products | One form signs a user into every product that accepts the account; no product asks again. | `apex/auth.mjs` (`signIn`); `apex/public/login.html` | LIVE (10 unit tests in `apex/auth.test.mjs`, which no npm script or CI runs) |
| 2 | One sign-out | Signing out of Apex signs out of every product. | `apex/auth.mjs` (`signOut`); dashboard account menu | LIVE (same note) |
| 3 | Session scoping | Each product's session cookie reaches only that product. | `forwardCookies`, `scopeSetCookie` in `apex/auth.mjs` | LIVE |
| 4 | Configurable session length | One session lasts 12 h by default; products expire with it. | `SESSION_HOURS` in `apex/projects.mjs` | LIVE |
| 5 | Sign-in attempt limiter | Slows password guessing at the front door. | `isLimited` / `noteFailure` in `apex/auth.mjs` | LIVE (in memory, per process) |
| 6 | Live status dashboard | Each product card shows Ready, Starting, Offline or Sign-in required, with a "platforms ready" roll-up. | `apex/public/index.html` (status panel, `/auth/config` health probes) | LIVE (checked by `apex/smoke.mjs` browser script) |
| 7 | Live counts per product | Cards show library, deck, course and learner totals. | `apex/public/index.html` (calls to `/showcase/api/entities/plates/count`, `/vault/api/presentations`, `/academia/api/entities/*`) | LIVE |
| 8 | Recent activity | Latest sync results from all three products in one panel. | `apex/public/index.html` (sync-log calls) | LIVE |
| 9 | Cross-product search palette | One search box for platforms, pages, presentations and courses. | `apex/public/index.html` (`#palette-input`) | LIVE |
| 10 | Public certificate check | Anyone with a certificate link can verify it without signing in. | `apex/public/verify.html`; `publicVerify` in `apex/projects.mjs` | LIVE |
| 11 | Reverse-proxy and HTTPS readiness | Public URL, trusted-proxy and Secure-cookie settings for a hosted deployment. | `APEX_PUBLIC_URL`, `APEX_TRUST_PROXY`, `APEX_HOST` (`README.md`, Settings) | IN PROGRESS (designed; not deployed behind HTTPS; gateway cookie not yet `Secure`, audit F-015) |
| 12 | One-command start and stop | Installs, starts and supervises every product; cleans up orphans. | `start.bat`, `stop.bat`, `apex/run.mjs`, `apex/stop.mjs` | LIVE (Windows only) |
| 13 | Dependency-free gateway | Nothing to install or patch for the front door itself. | `apex/server.mjs` (Node built-ins only) | LIVE |

### Innovation Showcase (`inspironics-innovation-showcase/`)

| # | Feature | Business benefit (one line) | Evidence | Maturity |
|---|---|---|---|---|
| 14 | Curated blueprint library (235 plates) | A ready portfolio with hand-written metadata at no AI cost. | `apps/web/public/data/showcase.json`; `apps/api/src/sync/seeds.js` | LIVE |
| 15 | Dropbox-synced gallery | Files in a Dropbox folder become a gallery automatically, every 30 min. | `apps/api/src/sync/pipeline.js`, `sync/scheduler.js`, `routes/dropbox.js`; `test/sync.test.mjs`, `dropbox.test.mjs` | IN PROGRESS (fake Dropbox only) |
| 16 | Images, PDF, PowerPoint and HTML | Mixed material in one library. | `packages/shared/src/fileTypes.js`; `sync/extract.js` | LIVE (fake Dropbox) |
| 17 | Thumbnails, previews and content proxy | Fast browsing; Dropbox links never reach the browser. | `/files/:id/thumbnail`, `/preview`, `/content`; `test/http.test.mjs` | LIVE (fake Dropbox) |
| 18 | Sandboxed HTML | Synced HTML cannot run with the site's privileges. | CSP sandbox in `routes/dropbox.js`; `http.test.mjs` | LIVE |
| 19 | Search, filters and lightbox | Find plates by title, category or product; zoom, download, related plates. | `GalleryFilters.jsx`, `Lightbox.jsx` | LIVE |
| 20 | 3D Ecosystem Explorer | An explorable 3D model (8 industry zones, 4 stack layers, products) that filters the gallery. | `features/ecosystem/render/ecosystemCity.js`; `tests/ecosystemRoutes.test.mjs` | LIVE (quality tiers and reduced-motion fallback) |
| 21 | Daily Spotlight | A featured plate each day. | `DailySpotlight.jsx` | LIVE (no test) |
| 22 | Monthly PDF report | A shareable library and usage summary, generated in the browser. | `features/report/lib/reportPdf.js`, `/report`; `tests/reportModel.test.mjs` | LIVE |
| 23 | Usage analytics | Views and downloads per day, top plates, library mix, sync history, logins. | `GET /api/entities/analytics`; `POST /plates/:id/events` | LIVE (API); no UI test |
| 24 | Admin console | Dropbox connection, sync, users and logins in one place; Prometheus metrics. | `features/admin/pages/AdminConsole.jsx`; `/api/admin/*` | LIVE |
| 25 | Saved-for-offline plates | Users save plates to the browser and read them later. | `features/offline/model/offlineStore.js` (IndexedDB), `/offline` | IN PROGRESS (no service worker, so the app itself does not load offline; no tests) |
| 26 | AI titles and categories | New files get a title and classification automatically. | `apps/api/src/ai/enricher.js` (Anthropic Claude) | IN PROGRESS (off by default; mock-tested only) |
| 27 | "Describe" on card flip | Fills a plate's empty description on request. | `POST /plates/:id/describe`; `FlipCard.jsx` | IN PROGRESS (needs AI on; mock-tested) |
| 28 | Showcase Copilot | Plain-language answers about the library. | `features/copilot/model/copilotKnowledge.js` | LIVE (**keyword-based, not AI**) |
| 29 | Accounts: password, guest, Google | Password sign-in; a guest mode for viewing; Google sign-in. | `apps/api/src/routes/auth.js` | Password and guest LIVE; Google IN PROGRESS (mock only) |
| 30 | Email verification and reset codes | Account security. | `issueCode` in `routes/auth.js` | IN PROGRESS (no mail transport; codes go to the log or an admin) |
| 31 | Quality gates | Architecture, type, route, environment and bundle-size (90 KB budget) checks on every build. | `scripts/checkBundle.mjs`, `npm run build` | LIVE (locally; CI file never runs, audit F-002) |

### SlidesVault (`slide vault/`)

| # | Feature | Business benefit (one line) | Evidence | Maturity |
|---|---|---|---|---|
| 32 | Dropbox connect and incremental sync | One admin connects Dropbox once; decks stay current, removed files are archived, unchanged ones skipped. | `apps/api/src/integrations/dropbox/DropboxSyncService.js`; `tests/integration/sync.test.js`, `teamspace.test.js` | IN PROGRESS (fake Dropbox only; PowerPoint files by default) |
| 33 | Dropbox Business team spaces | Works with team folders. | migration `002_team_namespace` | IN PROGRESS (mock only) |
| 34 | Scheduled sync | Hands-off freshness every 30 min, one instance at a time. | `services/scheduler/SyncScheduler.js` | LIVE (single instance) |
| 35 | Search and filters | Ctrl/Cmd+K search with weighted ranking; domain, type, tag and offline filters kept in the URL. | `apps/web/src/components/SearchBar.jsx`, `pages/Library.jsx` | LIVE (searches titles and metadata, not slide text; no web tests) |
| 36 | Thumbnails and preview cache | Visual browsing; PowerPoint rendered once and reused. | `DropboxThumbnailService.js`, `DropboxContentService.js`; `rename.test.js` | IN PROGRESS (mock Dropbox) |
| 37 | Presentation viewer | Read decks in the app: page navigation, zoom, fullscreen, page bookmarks, related decks. | `pages/PresentationViewer.jsx` | LIVE (no web tests) |
| 38 | Copy deterrents | Toolbar, right-click and printing discouraged; HTML sandboxed. | `PresentationViewer.jsx`; `tests/e2e/security.test.js` | LIVE (**deterrents, not DRM**) |
| 39 | Offline reading (installable web app) | Install the app; read saved decks without a connection; copies wiped at sign-out. | `apps/web/public/sw.js`, `lib/offline-db.js`, `pages/OfflineLibrary.jsx` | LIVE (no automated tests) |
| 40 | Favourites, reading progress, page bookmarks | Personal shortlists. | `lib/offline-db.js`, `pages/Dashboard.jsx` | LIVE (stored per browser, not synced across devices) |
| 41 | Usage analytics | De-duplicated views, reading time, completion, online vs offline. | `/analytics/view`, migration `003`; `hardening.test.js`; `pages/Admin.jsx` | LIVE |
| 42 | Keyword classification | Decks sorted into 5 domains and 26 sub-domains without AI. | `keywordClassifier.js`; `packages/shared/src/domains.js` | LIVE |
| 43 | AI classification and titles | AI summary, tags, learning objectives; real titles for "Presentation1.pptx". Renaming in Dropbox is optional and dry-run by default. | `DocumentAnalysisService.js`, `TitleResolver.js` (Anthropic Claude); `titles.test.js`, `rename.test.js` | IN PROGRESS (mock-tested; off without a key) |
| 44 | SlidesVault Copilot | "Which decks answer this?" — up to 5 picks, rate-limited. | `apps/api/src/routes/ai.js`, `components/AiCopilot.jsx` | IN PROGRESS (Anthropic mocked; hidden unless enabled) |
| 45 | Audit log | 14 action types for Dropbox, sync, file and sign-in events. | `services/audit/AuditService.js`; `GET /api/dropbox/audit` | LIVE (API only; no screen) |
| 46 | Retention sweep | Old logs, sessions and cached previews are purged daily. | `container.js`, `SyncScheduler.js` | IN PROGRESS (only the scheduling is tested) |
| 47 | Google sign-in with domain allow-list | Staff sign in with company Google accounts. | `services/auth/GoogleAuthService.js`; `googleAuth.test.js` | IN PROGRESS (mock only) |
| 48 | Promote user to admin; forgot password | — | `pages/Admin.jsx`, `pages/ForgotPassword.jsx` | IN PROGRESS (works in demo mode only; no API behind them) |
| 49 | Docker and Postgres deployment | Container-based self-hosting. | `apps/api/Dockerfile`, `docker-compose.yml`, `db/postgresDriver.js` | IN PROGRESS (no real `docker build` run; Postgres untested) |

### Inspironics Academia (`Inspironics Academia/`)

| # | Feature | Business benefit (one line) | Evidence | Maturity |
|---|---|---|---|---|
| 50 | Playbook import and chapter extraction | PDF/DOCX playbooks (uploaded or from Dropbox) become course source material. | `apps/api/src/pipeline/processPlaybookExtract.js`, `pages/admin/PlaybookImport.jsx`; pipeline tests | LIVE (works without AI) |
| 51 | Course design with coverage map | Modules and lessons each trace back to a playbook chapter. | `processPlaybookStructure.js`, `CoverageMap.jsx`; `coverage.test.js` | LIVE |
| 52 | AI lesson generation | Script, summary, key points, 6 quiz questions and 5 flashcards per lesson, in a server batch. | `generateLessonContent.js`, `courseContent.js`, `ContentStudio.jsx` | LIVE (needs a Gemini or Ollama key; verified once against real Gemini) |
| 53 | Automatic quality check and human approval | Reviewers spend time only on flagged lessons; nothing reaches learners unapproved. | `pipeline/lessonQuality.js`; `admin/review/*`; row rules in `packages/shared/src/entities.js` | LIVE |
| 54 | Quizzes, chapter tests, final test | Lesson quizzes, chapter tests and a 30-question final with a 70 % pass mark. | `submitQuiz.js`, `submitFinalTest.js`, `shared/finalTest.js`; `finalTest.test.js` | LIVE |
| 55 | Server-side grading | Answers never reach the browser; learners cannot read or fake results. | `withoutAnswers` in `shared/finalTest.js`; `securityBoundaries.test.js` (commit `3c4500d`) | LIVE |
| 56 | Generated question banks | Module tests (15), course assessments (50), certification exams (60). | `generateAssessment.js`, `AdminQuestions.jsx` | LIVE (needs AI) |
| 57 | Certificates with QR code and public verification | PDF certificate; anyone can check it as valid, re-certification required, expired or superseded. | `components/certificates/*`, `verifyCertificate.js`, `CertificateVerify.jsx`; `retention.api.test.js` | LIVE (QR image fetched from a third-party service) |
| 58 | Spaced repetition | SM-2 flashcard review, 20 new cards a day, 7-day forecast, streaks. | `shared/review.js`, `DailyReview.jsx`; `retention.test.js` | LIVE |
| 59 | Recertification | Triggered when playbook chapters change materially, or on expiry; waivers and grace days. | `shared/recert.js`, `AdminCompliance.jsx` (CSV export) | LIVE |
| 60 | Meetings to action items | Teams/VTT/text transcripts become notes, decisions, owned action items and participation stats. | `processMeeting.js`, `Meetings.jsx`, `MyActionItems.jsx`; `meetings.test.js` | LIVE (AI when on, keyword rules otherwise) |
| 61 | Narrated slide videos | Lessons and meetings rendered as narrated slide videos with subtitles and thumbnail. | `media/video/renderer.js`, `subtitleGenerator.js`; `videoEngine.test.js`, `meetingVideo.test.js` | LIVE as code (one real render verified, 3:05, 720p); voice-over off by default |
| 62 | AI Studio | 9 content types, voice studio, video projects, job queue with cancel/retry. | `studio/routes.js`, `pages/admin/AIStudio.jsx`; `studio.test.js` | LIVE (admin only) |
| 63 | Spend controls | Daily request limit, monthly dollar budget, monthly voice characters and render minutes; estimated cost log. | `usage/limits.js`, `pricing.js`, `UsageBudget.jsx` | LIVE (providers without a price table count $0 unless prices are set) |
| 64 | AI provider fallback | A second provider answers when the first is unavailable. | `ai/index.js`; `aiRouter.test.js` | LIVE (mock-tested) |
| 65 | Audience-based visibility | Content shown by audience: intern, employee, leadership. | `shared/audience.js`; `categories.test.js` | LIVE |
| 66 | Playbook version history | Word-level diff between versions. | `PlaybookVersionHistory.jsx`, `lib/diff.js` | LIVE (no test) |
| 67 | Admin and learner dashboards | Enrolment, completion and quiz charts; bookmarks, feedback, achievements. | `AdminDashboard.jsx`, `components/admin/dashboard/*` | LIVE (no UI tests) |
| 68 | Drag-and-drop course editor | Admins restructure courses. | `AdminCourseEditor.jsx` | LIVE (no test) |
| 69 | In-app notifications and reminders | 13 notification kinds; review, compliance and action-item reminders. | `notify/*`, `notify/jobs.js` | LIVE (in-app) |
| 70 | Email delivery | Reminders and invites by email. | `notify/*` (Resend, SMTP) | IN PROGRESS (default sends nothing; Resend untested; SMTP package missing) |
| 71 | Dropbox sync and storage policy | Playbooks and meetings sync from Dropbox; temporary source cache; outputs published back. | `dropbox/*`, `storage/storage.js`; `dropboxStorage.test.js`, `dropboxFlow.test.js` | IN PROGRESS (mock only) |
| 72 | Google sign-in | — | `GoogleButton.jsx` (hidden; `google_enabled: false`) | ROADMAP |
| 73 | Premium course tier | — | `entities.js` access level; crown badge only | ROADMAP (no payments) |
| 74 | Personal data export / account deletion | — | not found in any product | Not present |

### Shared by all three products

| # | Feature | Business benefit (one line) | Evidence | Maturity |
|---|---|---|---|---|
| 75 | Demo modes | Each product runs entirely in the browser with sample data for sales demos. | Showcase `VITE_BACKEND=local`; SlidesVault `VITE_DEMO_MODE`; Academia `VITE_BACKEND=demo` | LIVE (sample data only — see section 13) |
| 76 | SQLite by default, Postgres option | Zero-setup database; a production database option. | each `apps/api/src/db/` | SQLite LIVE; Postgres IN PROGRESS (untested) |
| 77 | Light/dark themes | Comfort and polish. | SlidesVault `lib/useTheme.js`; Academia `ThemePreference.jsx`; dashboard toggle | LIVE |

---

## 5. Headline capabilities for the brochure

All items below map to LIVE rows in section 4, unless a caveat says otherwise.

### Theme A — One front door

**Sign in once, open everything** (#1, #2, #3)
One sign-in opens the Innovation Showcase, SlidesVault and Academia at a single address, and one sign-out closes them all. Each product keeps its own session, scoped so it never reaches another product.

**See what is ready at a glance** (#6, #7, #8)
The dashboard shows every product's live status, its library and learner totals, and the latest sync results, so people know what is available before they click.

**Search across products** (#9)
One search box finds platforms, pages, presentations and courses across all three products.

**Your storage, your servers** (#13, #17, #12)
Files stay in the organisation's Dropbox, and every byte passes through Apex's own servers, never from the browser to Dropbox. The front door has no third-party dependencies and starts with one command.
*Caveat: Dropbox sync is tested against a simulated Dropbox only (rows #15, #32, #71 are IN PROGRESS). Use this as a design statement until a real account has been synced.*

### Theme B — Show and share knowledge

**An immersive innovation gallery** (#14, #19, #20)
A curated library of 235 solution blueprints, with search and filters, and a 3D ecosystem explorer that leads from industry zones to the material behind them.

**Every deck, findable and readable** (#35, #37, #39)
SlidesVault ranks results as people type, opens decks in a built-in viewer with page bookmarks, and installs as a web app that reads saved decks offline.

**Know what gets used** (#23, #41, #22)
View, download and reading-time analytics show which material people actually use. A monthly PDF report summarises the library for stakeholders.

### Theme C — Turn playbooks into capability

**From playbook to course** (#50, #51, #52, #53)
Playbooks are split into chapters and structured into modules and lessons, each traced back to its source. AI drafts the content; an automatic quality check flags weak lessons; a person approves before anything is published.

**Tests learners cannot game** (#54, #55, #57)
Quizzes, chapter tests and final tests are graded on the server, and answers never reach the browser. Passing learners receive a certificate that anyone can verify from its link, without signing in.

**Knowledge that stays current** (#58, #59)
Spaced-repetition review strengthens recall. When a playbook changes materially, the people certified on it are asked to re-certify.

**Meetings that produce actions** (#60, #61)
Meeting transcripts become decisions and owned action items with reminders. They can also become a short narrated slide briefing.

**AI with a budget** (#62, #63, #64)
AI Studio enforces daily request limits, a monthly spend budget, and voice and render caps before every paid call. A second provider can take over when the first is unavailable.

---

## 6. How it works

**Data sources and inputs**
- Dropbox folders: blueprints and images (Showcase), PowerPoint decks (SlidesVault), playbooks and meeting transcripts (Academia).
- Direct uploads: playbooks (PDF, DOCX) and meeting transcripts (Teams .docx, .vtt, .txt) in Academia.
- The curated Showcase catalogue (235 plates).
- Optional AI services: Google Gemini or a self-hosted Ollama model (Academia); Anthropic Claude (Showcase and SlidesVault).
- Optional voice services: Gemini TTS, Google Cloud TTS, ElevenLabs, Piper.
- People: admins approve lessons, set budgets, manage users and categories.

**Core engines and services**
- Apex gateway: sign-in, sign-out, session scoping, reverse proxy, health probes, public certificate check.
- Per-product APIs (Node.js/Express), each with its own database, sessions and access rules.
- Dropbox integration layer: OAuth with encrypted tokens, incremental sync, thumbnails, preview cache, content proxy.
- Content pipeline (Academia): extraction → structure → lesson generation → quality check → review → publish.
- Assessment engine: server-side grading, certificates, spaced repetition, recertification.
- Media engine: slide rendering, voice-over, FFmpeg video, subtitles, thumbnails.
- Usage and budget service; job queue and schedulers.
- Analytics and reporting.

**Outputs and deliverables**
- A searchable gallery, deck library and course catalogue behind one sign-in.
- Certificates with a public verification link.
- Compliance and action-item CSV exports; monthly Showcase PDF report.
- Narrated slide videos with SRT/VTT subtitles.
- Usage analytics, sync history, audit log (SlidesVault), Prometheus metrics.

**From setup to value**
1. **Install:** run `start.bat` on the organisation's machine. Apex installs and starts every product.
2. **Connect:** an admin connects Dropbox in each product and picks the folders. Sync runs every 30 minutes.
3. **Organise:** files are titled and classified, by keyword rules or, if enabled, by AI. Playbooks become draft courses.
4. **Review:** admins check flagged lessons, approve and publish.
5. **Use:** staff sign in once to browse, present, learn, test and certify. Managers follow usage and completion on the dashboards.

**Design principles**
1. **One door, separate rooms.** Each product keeps its own bundle, database and session. The gateway joins them without merging them.
2. **The browser never talks to the storage.** Every file is fetched and checked by Apex's own servers.
3. **AI drafts, people decide.** AI is optional and off by default. Generated content is reviewed before learners see it, and spending is capped.

---

## 7. Verified facts for the cover

| Number | Label | Evidence |
|---|---|---|
| 3 | Products behind one sign-in | `apex/projects.mjs` (`PROJECTS`: showcase, vault, academia) |
| 567 | Automated tests, all passing at the last full run | `docs/architecture/APEX_FULL_AUDIT_REPORT.md` section K: Academia API 234, Showcase API 52 + web 75 + shared 3, SlidesVault API 203. Excludes 10 gateway unit tests that no script runs. |
| 235 | Curated solution blueprints in the Showcase | `inspironics-innovation-showcase/apps/web/public/data/showcase.json` |
| 0 | Third-party dependencies in the Apex gateway | `apex/server.mjs` (Node built-ins only); `README.md` |
| 4 | Voice-over providers supported in Academia | `Inspironics Academia/apps/api/src/media/index.js` (Gemini TTS, Google Cloud TTS, ElevenLabs, Piper) |

Avoid as cover facts until there is real deployment data:
- the Academia development database totals (11 courses, 714 lessons, 2,523 questions; audit section F). These come from internal use on one machine.

---

## 8. Ideas for professional visuals

**1. One front door diagram**
- Shows: browser → Apex gateway (sign-in, health, proxy) → three products, each with its own API and database → Dropbox.
- Data: real (`README.md`, "How it fits together"; `apex/projects.mjs`).

**2. Playbook-to-certificate flow**
- Shows: Playbook → chapters → modules/lessons → AI draft → quality check → human approval → learner → server-graded test → certificate → public verification → recertification loop.
- Data: real (Academia pipeline modules listed in #50–#59).

**3. Dashboard screenshot with live status**
- Shows: three product cards with Ready badges, live counts and recent activity.
- Data: capture from a clean environment. Rename demo people first (section 13), and label it **Illustrative (sample data)** until it shows real usage.

**4. Product coverage table**
- Columns: Product | What it holds | Who uses it | Key outputs | AI (optional / none).
- Data: real (section 4).

**5. Showcase 3D Ecosystem Explorer still**
- Shows: the 3D model with industry zones and stack layers (sense, connect, model, decide).
- Data: real UI; the content is the curated catalogue.

---

## 9. Integrations

| Integration | Type | Maturity |
|---|---|---|
| Dropbox (OAuth 2, sync, thumbnails, previews, content proxy, team spaces) — all three products | API | IN PROGRESS: tested against fake Dropbox servers; real account not exercised (audit G) |
| Google Gemini (text) — Academia | API | LIVE: verified against the real service (one lesson generated) |
| Google Gemini TTS — Academia | API | LIVE: verified against the real service (one MP4 briefing rendered) |
| Ollama (self-hosted model) — Academia | API | IN PROGRESS: mock-tested only |
| Anthropic Claude — Showcase and SlidesVault | API | IN PROGRESS: mock-tested only; off by default |
| Google Cloud TTS, ElevenLabs, Piper — Academia | API / local binary | IN PROGRESS: mock-tested only |
| FFmpeg video rendering — Academia | Local binary (`ffmpeg-static`) | LIVE: integration-tested with real FFmpeg |
| Google sign-in — Showcase, SlidesVault | Identity | IN PROGRESS: mock only. Academia: ROADMAP |
| Email (Resend, SMTP) — Academia | Messaging | IN PROGRESS: log transport only; no real delivery |
| Email — Showcase, SlidesVault | Messaging | Not present (codes go to the log; reset not implemented in SlidesVault) |
| Microsoft Teams transcripts (.docx export) | File | LIVE (file import, not an API connection) |
| PDF / DOCX / PPTX / VTT / images | File | LIVE |
| CSV exports (compliance, action items) | File | LIVE |
| Prometheus metrics | API | LIVE (Showcase, SlidesVault, Academia admin metrics) |
| Postgres | Database | IN PROGRESS: code present, never run |
| Single sign-on (SAML / OIDC), Microsoft 365, CRM | Identity / API | Not present |

---

## 10. Security, governance and deployment

**Controls in place**

| Control area | What is in place |
|---|---|
| Identity | Email and password in every product, hashed with scrypt and per-user salts, compared in constant time. Sessions are random tokens stored as SHA-256 hashes in httpOnly, SameSite=Lax cookies (Secure in production), 12 h lifetime, revoked on password change (audit E). One Apex sign-in across products. There is no SSO, no MFA, and no account lockout in Academia or the Showcase. |
| Access control | Server-side checks on every mutating endpoint; the frontend only hides UI. Roles: Showcase `admin`/`viewer`/`guest`; SlidesVault `admin`/`user`; Academia `admin`/`user`, plus audience visibility (intern, employee, leadership). Academia applies per-record row rules and field rules, so a learner cannot alter results. |
| Assessment integrity | Answers removed before questions reach learners; all grading on the server; certificates issued only by the server (commit `3c4500d`). |
| Storage access | Dropbox refresh tokens encrypted with AES-256-GCM; no endpoint returns a token. Files are proxied, never linked. Synced HTML is served in a sandbox CSP. Dropbox paths reject `..`. |
| Network | The gateway and every product listen on 127.0.0.1 by default. The gateway strips client `X-Forwarded-*` headers and blocks open redirects. CORS is a single origin or an exact allow-list. Writes check the request origin. |
| Audit and logging | SlidesVault audit log (14 action types) with retention. Login history (Academia, Showcase). Secrets redacted from logs. Prometheus metrics. |
| Secrets | `.env` files are git-ignored; a history scan found no secret values (audit E). |
| Dependencies | `npm audit --omit=dev` reports 0 advisories in all three products after commit `da776b6` (audit D, F-010). |
| AI spend | Daily, monthly, voice and render limits checked before each paid call (Academia). |

**Deployment model**
- Supported in code: **self-hosted** on one machine, started with `start.bat` (Windows). Development serves on port 5173; production builds serve on 4173 or a chosen port.
- Hosting behind an HTTPS reverse proxy is designed (`APEX_PUBLIC_URL`, `APEX_TRUST_PROXY`) but not yet exercised.
- SlidesVault also has a Dockerfile and Docker Compose file, though a real build has not been run. The other products and the gateway have no container files.
- There is no SaaS hosting, cloud infrastructure-as-code, Kubernetes, high availability or multi-tenancy. Each install serves one organisation.

**Technology stack**
- Gateway: Node.js 22, built-in modules only; static HTML/CSS/JS dashboard.
- Backends: Node.js 22, Express 4; SQLite via `node:sqlite` by default, Postgres driver available; `ffmpeg-static`, JSZip, pdf-parse.
- Frontends: React 18, Vite, React Router 7, Tailwind CSS, three.js (Showcase 3D), jsPDF 4.2.1, Radix UI (Academia), service worker (SlidesVault).
- AI: Google Gemini or Ollama (Academia); Anthropic SDK (Showcase, SlidesVault).
- Testing: Node test runner (API, unit, integration, end-to-end with fake Dropbox servers), Showcase web component tests, Playwright-style browser smoke script (`apex/smoke.mjs`).

**Deployment architecture**
1. The Apex gateway (one port) serves the sign-in page and dashboard, and checks the Apex session.
2. Requests under `/showcase`, `/vault` and `/academia` go to each product's web build; `/…/api` goes to that product's API with its own session cookie.
3. Each API holds its own database (SQLite file or Postgres) and runs its own schedulers.
4. Each API calls Dropbox and, if enabled, its AI and voice providers.
5. Academia renders videos with FFmpeg on the API host.

---

## 11. Global readiness

| Area | What exists | What is missing |
|---|---|---|
| Languages and localisation | English only. Academia voice-over language is configurable (`TTS_LANGUAGE`, default `en-US`). | No translation framework or translated strings in any product. |
| Currencies | Academia shows estimated AI costs in US dollars to admins only. Learners and viewers never see prices. | No pricing or payments anywhere (Stripe packages installed but unused). |
| Time zones | Data stored in UTC. Academia accepts the learner's local day for flashcard review. | Reports and daily charts use UTC or browser time inconsistently, so day boundaries can disagree near midnight. |
| Right-to-left support | None. | No RTL layout. |
| Accessibility | ARIA labelling, focus handling, dark/light themes. Reduced-motion support (Showcase, Academia). 3D fallback tiers. | No WCAG audit or accessibility tests. SlidesVault has no reduced-motion handling. |
| Mobile | Responsive layouts. SlidesVault installs as a web app. The Showcase lowers 3D quality on touch devices. | No native apps. Not tested on devices. PWA icon is SVG only (poor on iOS). |
| Country and regulatory coverage | None specific. | No GDPR, DPDP or other privacy mapping; no data export or erasure. |
| Data residency | Self-hosted, so data stays where the organisation installs it. Files stay in its own Dropbox. | No region selection. |

---

## 12. Roadmap

Items worth showing as "coming next". No dates have been provided.

- **Live Dropbox connection**: complete a real sync in all three products (built and tested against simulated Dropbox).
- **Email delivery**: send invites, codes, reminders and password resets by email in every product.
- **Google and enterprise single sign-on**: complete Google sign-in; add SAML/OIDC.
- **Hosted deployment**: HTTPS behind a reverse proxy, Secure gateway cookie, containers for every product, Postgres in production.
- **AI enrichment on by default**: switch on AI titles, classification and the SlidesVault Copilot once keys and budgets are agreed.
- **Shared favourites and collections**: sync SlidesVault favourites across devices; add collections and share links.
- **Full offline Showcase**: make the Showcase installable like SlidesVault.
- **Privacy self-service**: personal data export and account deletion.
- **Continuous integration**: a root CI pipeline running every product's tests and builds.

---

## 13. Risks and gaps (internal only, never for the brochure)

> **Update, 13 November 2026 (uncommitted remediation; 621 tests and 3 builds pass, `npm audit --omit=dev` = 0 in all three apps).**
>
> **Fixed since this pack was written**
>
> *Product fixes*
> - SlidesVault: "Promote to admin" works, password resets are done by an admin, and the audit log has a screen.
> - The SlidesVault user manual's encryption and printing claims are corrected.
> - The Showcase is installable and works offline.
> - Academia: batch auto-resume is switched on, and the QR code is generated locally.
> - Academia's "Premium" badge reads "Featured", so it no longer implies payment.
>
> *Security defaults*
> - Showcase guest access is off by default.
> - First-user-admin is off in production (Academia).
> - Every app has per-account login lockout and equal-time checks for unknown emails.
> - The gateway cookie is `Secure` behind HTTPS, and signed-out sessions are revoked.
> - The Showcase extraction has a zip-bomb limit.
>
> *Engineering*
> - IPv6 loopback is served, so `localhost` is fast.
> - CI runs at the repository root.
> - The gateway tests are wired into a script.
>
> *Documentation*
> - Academia docs now say Gemini/Ollama.
> - The Copilot is described as keyword search, and the Showcase "proven across…" wording is fixed.
> - The "AI video lessons" wording is replaced.
>
> **Still open**
> - Real Dropbox, email and Google runs.
> - Postgres and Docker until CI runs them.
> - SSO and MFA.
> - Data export or erasure.
> - Native mobile apps.
> - The Academia name decision.
> - The items in the commercial list below.

**Claims to avoid and why**
- **"AI-powered" without qualification.**
  - AI is optional and off by default in the Showcase and SlidesVault.
  - The Showcase Copilot is keyword-based and calls no AI model (`copilotKnowledge.js`: "composed locally … rather than by a language model"), yet its README calls it an "AI copilot".
  - The SlidesVault demo-mode Copilot is also keyword-based.
  - Say "AI-assisted, optional" and name only the features in section 4 that call a model.
- **"Powered by Claude" for Academia.**
  - Academia's code supports Gemini and Ollama only; there is no Anthropic adapter (`apps/api/src/ai/index.js`: `PROVIDERS = { gemini, ollama }`).
  - Its README and `docs/ai-studio/*` wrongly say Claude is the default. So does `FINAL_PRODUCTION_READINESS_REPORT.md`.
- **"AI video lessons" / "AI-generated video".** These are narrated slide videos rendered with FFmpeg; voice-over is off by default (`media/index.js`: "Generated video clips are not offered").
- **"Accredited", "certified training" or regulatory "compliance".** Certificates are internal completion records with no accreditation; the "compliance" screen tracks recertification only.
- **"Secure viewer", "DRM", "cannot be copied" or "encrypted offline copies".** SlidesVault uses deterrents only, and offline copies sit in plain browser storage. The in-app manual (`UserManual.jsx`) says "encrypted browser blobs" and "printing disabled entirely" — correct it.
- **"Real-time".** Sync runs every 30 minutes.
- **"Enterprise-grade", SOC 2, ISO 27001, GDPR- or DPDP-compliant.** None of these is evidenced: no SSO, no MFA, no certification, no data export or erasure.
- **"SaaS", "cloud", "multi-tenant".** Only single-organisation, self-hosted, Windows-started installs exist.
- **"Proven", "trusted by", customer counts, usage figures.** No production customer data exists. Use [CUSTOMER COUNT] and [ADOPTION %] placeholders only once real figures exist.
- **"Works with any file".**
  - SlidesVault syncs PowerPoint (.pptx/.ppt) only by default, although its README says PDF and HTML too.
  - The Showcase syncs images, PDF, PPTX and HTML.

**Overclaims currently in the UI, docs or landing pages**
- **Showcase About section:** says "proven across energy, agriculture, hospitality, healthcare, manufacturing and data centres", with no evidence. It also mentions zero-trust identity and attested devices, which describe Inspironics solutions, not Apex.
- **Showcase seed catalogue:** template-generated. Numbered titles (e.g. "Operations Command Deck 01"), "Real-time monitoring" 231 times, "ROI is demonstrable within a quarter". Review before using screenshots.
- **SlidesVault:**
  - "Forgot password" says "a reset link is on its way", but no email is sent and no API exists (`apiClient.js` throws).
  - "Promote to admin" fails outside demo mode.
- **SlidesVault demo seed:** fabricated view, bookmark and favourite counts. Content claims such as "Telemetry Ingestion at Two Million Events a Minute" and "one-click regulator exports".
- **Academia home page:** "AI-narrated video lessons" (`HomeHero.jsx`, `FeatureTiles.jsx`).
- **Explainer video narration** (`demo video/Apex_Explainer.srt`):
  - Describes two products, not three.
  - Says Apex opens "only when both platforms accept the user". The code skips a product that is down or does not know the account (`README.md`).
- **Competitor landscape** (`competitor analysis/Apex_Competitor_Landscape.html`, September 2026): pre-dates Academia. Its fit scores are an internal assessment, not independent tests.
- **Academia:** the batch auto-resume is imported but never started (`server.js` imports `startBatchResumer`, never calls it). The audit's "auto-resume" (F-022) is therefore not active after a restart.
- **READMEs:** state outdated test counts and React Router 6; the code uses 7.

**Real brand or company names in demo data and UI**
- **Inspironics product names** in the Showcase taxonomy: Caleido Xenia, Caleido Domi, Caleido Kombos, Caleido Mints, Cielo Epic.
  - Fine as own brands.
  - But Caleido Mints is not production-proven (see its own brochure pack). Do not imply these products are deployed.
- **SlidesVault taxonomy and seed:** FleetExplorer, Discipline Engine, Insight Flow. Confirm these are approved for external use.
- **Demo people:**
  - Academia: Priya Raman, Arjun Mehta, Sofia Alvarez, Ada Admin, Lee Learner.
  - SlidesVault: avery.raman, sana.kapoor on the real `@inspironics.net` domain.
  - Confirm all are fictional, and rename before external screenshots.
- **Third-party names:**
  - In the UI: Dropbox, Google, Microsoft Teams, Gemini, ElevenLabs, Resend.
  - In the Showcase: Claude, as a category name ("Claude Skill Up Tools").
  - Protocol names in Showcase plates: Zigbee, Modbus, LoRaWAN, BACnet, Matter.
  - Technology names in SlidesVault seed: Kafka, Kubernetes.
  - Use as factual references only, never as endorsements or partnerships.
- **Third-party QR service:** Academia certificates fetch their QR image from `api.qrserver.com`, which sends each verification URL to a third party. Replace it with local QR generation before marketing certificate privacy.

**Gaps a corporate buyer or auditor will ask about**
- No SSO (SAML/OIDC) and no MFA in any product; Google sign-in unverified.
- **Rate limits:**
  - In memory, per process.
  - No per-account lockout in Academia or the Showcase.
  - Response timing reveals which emails have accounts (audit F-014).
- **Default exposure:**
  - The first account on an empty Academia or Showcase-dev database becomes admin (F-011).
  - Showcase guest access is on by default.
- The gateway session cookie is not `Secure` and cannot be revoked before expiry (F-015).
- No CI: the only workflow sits in a subfolder and never runs (F-002). Academia and SlidesVault have no web tests.
- Postgres, Docker images, real Dropbox, real email and load were never run (audit J).
- No backup, disaster-recovery, high-availability or scaling design; AI rendering runs on the API host.
- No SLA, support model or incident process.
- Windows-only start scripts.
- No data export or erasure, retention schedule (beyond the SlidesVault sweep), DPA or privacy mapping.
- No zip-bomb limit in Showcase extraction (F-016); no database foreign keys in Academia (F-023).
- The development machine's C: drive is full (F-013), which blocked some verification.

---

## 14. Open questions for marketing

1. Is the brochure for **Apex as one platform**, or for each product separately?
2. Which name does Academia carry externally: Inspironics Academia, Engineering Academy or Inspironics Learn?
3. Is Apex sold externally, or is it an internal Inspironics tool shown to clients? This decides whether pricing, hosting and support appear at all.
4. **Commercial model:** what is the pricing model (per user, per organisation, licence, bundled with Inspironics solutions)?
5. **Hosting:** will Apex be offered self-hosted only, hosted by Inspironics, or both? Who operates it?
6. **Proof points:** can we name any internal or client deployment? What usage figures (learners certified, decks viewed) can we publish?
7. **AI:** which AI provider will be standard (Gemini for Academia; Claude for the Showcase and SlidesVault)? Will AI be on by default, and who pays for usage?
8. Should the brochure mention Dropbox by name, and is a Dropbox-only storage story acceptable to target buyers (versus SharePoint/Google Drive)?
9. Should demo-mode screenshots be used, and if so, who approves renaming the demo people and seed content?
10. **Certifications and accessibility:** are any certifications (ISO 27001, SOC 2) or an accessibility audit planned?
11. **Target markets:** which come first? This affects language, privacy-law and currency messaging.
12. Should the explainer video and competitor landscape be updated to include Academia before they ship alongside the brochure?
13. Is there an approved Apex palette, logo and typography? (The dashboard and competitor landscape use a dark navy background with cyan-to-violet accents, and Inter and JetBrains Mono fonts.)
14. What contact details, website and call to action should appear? The Showcase uses `hello@inspironics.net`.
