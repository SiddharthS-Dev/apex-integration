# Final production-readiness report

**Scope:** Base44 removal (Academia and SlidesVault), the independent AI Content & Video Studio
(Academia), and the Dropbox storage optimisation (Academia, SlidesVault, Showcase).
**Branch:** `feature-classification-personas` @ `ce2366e`, with all work uncommitted.
**Reviewed:** 2026-11-10 on the development machine. Nothing was committed, deployed or deleted. No paid
API was called.

## Verdict

**Ready for a staging deployment once credentials are configured. Not yet ready for production.** All
automated tests and builds pass, and no Base44 code or dependency remains. Before production, these
must be done:

1. Configure the real AI and voice providers, then run one approved smoke test of each.
2. Run the suite once against Postgres.
3. Upgrade `jspdf`, which has a critical advisory that predates this work.
4. Set the production configuration listed in §6.

## 1. Verified functionality

| # | Check | Result | How it was verified |
|---|---|---|---|
| 1 | No Base44 in code, packages, env or calls | **Pass** | Repository-wide search found Base44 only in 7 historical docs: `docs/ai-studio/BASE44_*.md`, `MIGRATION_GUIDE.md`, `TESTING_REPORT.md`, `GENERATION_COST_OPTIMIZATION.md`, `AI_STUDIO_ARCHITECTURE.md` and `docs/BUILD_SPEC.md`. No `package.json`, lockfile, `.env`/`.env.example`, source file or built bundle mentions it. `slide vault/node_modules/@base44` is an empty leftover folder; it disappears on the next clean `npm ci` |
| 2 | API test suites | **Pass** | See §2 |
| 3 | Frontend production builds | **Pass** | Academia web, SlidesVault web and Showcase web build. Showcase's build also runs its 75 web tests, all passing |
| 4 | Uncommitted changes | **Pass, one stray file** | Every change belongs to the three work items. No change is only line endings: the diff is the same with CR/EOL ignored. Stray untracked file at the repository root: `ync handling` — exclude it |
| 5 | Anthropic and Gemini configuration | **Pass, two notes** | Anthropic uses the official SDK, streaming with `finalMessage()`, adaptive thinking, `output_config.effort` and a JSON-schema format. Refusal fallback uses `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta, the documented scalar form. The code default model is `claude-opus-5-5`. Gemini uses the REST `generateContent` API with the key in the `x-goog-api-key` header; if the schema is rejected it retries with the schema in the prompt. Cross-provider fallback (`AI_FALLBACK_PROVIDER`) triggers only on availability errors (429/503/504 or retryable 5xx), never on a usage limit, and is logged (test: "Anthropic overloaded → Gemini answers"). **Notes:** the local `.env` pins `ANTHROPIC_MODEL=claude-opus-5`, which is valid but older and costs $5/$25 per MTok against $4/$20 for `claude-opus-5-5`. Claude Haiku 5.5 has no server-side fallback, so choosing it would need the `fallbacks` parameter removed |
| 6 | Google TTS and ElevenLabs selection | **Pass** | `MEDIA_PROVIDER` picks the default. A request can name another provider that is configured. `TTS_VOICE` applies only to the default provider, so an ElevenLabs request never inherits a Google voice. Google accepts an API key or a service account (signed-JWT exchange). Covered by `tts.test.js`, 9 tests |
| 7 | Audio caching and scene regeneration | **Pass** | Audio is cached by its exact inputs (text, provider, voice, language, rate, pitch); a cache hit is logged as `cached` at no cost. "Re-render one scene" re-renders only that scene and reuses its voice-over (`studio.test.js`). Scene frames are cached by content (`slides-v2`) |
| 8 | FFmpeg output, subtitles, thumbnails, temp cleanup | **Pass** | Real rendered MP4 on disk: 3:05.55, H.264 High 1280×720 25 fps, AAC 44.1 kHz stereo, **full decode with 0 errors**. Thumbnail is a valid PNG. Subtitles: SRT and VTT, 49 cues each, well formed. The temp folder `%TEMP%\apex-academia` is empty. Temp folders are owned per job, released on success or failure, and swept when abandoned (tested) |
| 9 | Sync triggers no unwanted AI and copies no originals | **Pass** | `SYNC_AI_EXTRACT` and `SYNC_AI_MEETINGS` default to false and are false locally, so sync-triggered extraction is heuristic only (test: "sync extraction uses no AI"). Sync with extraction off downloads nothing. Extraction keeps no copy under `DROPBOX_SOURCE_CACHE=temporary`. An unchanged revision is never re-extracted (`dropboxStorage.test.js`, which counts downloads and stored copies) |
| 10 | Budget enforcement and usage tracking | **Pass, with a gap** | The daily request limit, monthly dollar budget, monthly TTS characters and monthly render minutes are checked before each paid call. Cache hits still work when a limit is reached. Every request is logged with tokens, characters, seconds and estimated cost. **Gap:** requests with no known price are counted but not costed, so the dollar budget ignores them (see Risks) |
| 11 | Postgres | **Not executed** | No Postgres server is available: nothing listens on 5432, there is no `psql`, and Docker can't pull an image while C: is full. Static review: new SQL uses `?` placeholders (rewritten to `$n`), standard `CASE`/`coalesce`/`max`; the new tables use `DOUBLE PRECISION` on Postgres; the `PRAGMA` runs on SQLite only; `$in` is generic; the job claim is an atomic `UPDATE … WHERE status = 'queued'` |
| 12 | Credentials and configuration still required | Listed in §6 | |

## 2. Tests

| Suite | Expected in the request | Actual | Result |
|---|---:|---:|---|
| Academia API (`npm test`) | 178 | **187** | 187 pass, 0 fail |
| SlidesVault API (`npm test`) | 201 | **203** | 203 pass, 0 fail |
| Showcase API (`npm test`) | — | 49 | 49 pass, 0 fail |
| Showcase web (runs during the build) | — | 75 | 75 pass, 0 fail |
| Builds: Academia web, SlidesVault web, Showcase web | — | 3 | all succeed |

The counts are higher than expected because the Dropbox storage work added tests: 9 in Academia (`dropboxStorage.test.js`), 2 in SlidesVault (`tests/unit/storage.test.js`) and 1 in Showcase. **No test failed.**

## 3. Tests not executed

| Test | Why |
|---|---|
| Real Anthropic / Gemini / Ollama calls | No keys configured (`ANTHROPIC_API_KEY`, `GEMINI_API_KEY` empty); paid calls need approval |
| Real Google TTS / ElevenLabs / Piper | `MEDIA_PROVIDER=none`; paid calls need approval; Piper isn't installed |
| Postgres integration | No database available (see §1, item 11) |
| Real upload of a video to Dropbox | The Dropbox apps lack `files.content.write`; it would also write to the team's Dropbox |
| Real storage cleanup (1,620 MB of copies) | Destructive; awaiting approval. The dry run on real data is verified |
| Browser UI walkthrough of AI Studio and the Storage tab | Not exercised in a browser; builds and API tests only |
| Load and concurrency testing | Out of scope |

## 4. Security

| # | Issue | Severity | Introduced by this work? | Action |
|---|---|---|---|---|
| S1 | `jspdf` ≤ 4.2.0 (ReDoS) with transitive `dompurify` ≤ 3.4.16 (XSS); direct web dependency in all three apps | **Critical / High** | No — same versions at HEAD | Upgrade to `jspdf@4.2.1` (major); check PDF export afterwards |
| S2 | `body-parser` < 1.20.9: DoS via trailing bytes after a compressed body | High | No | `npm audit fix` (non-breaking) |
| S3 | `source-map-js` (Academia, build-time) and `zod` < 4.6.6 (Showcase) | High | No | `npm audit fix` |
| S4 | Assorted moderate/low advisories (`qs`, `react-router`) | Moderate/Low | No | `npm audit fix`; `react-router` needs a major upgrade |
| S5 | Showcase log redaction matches key names only | Low | No | Also redact `Bearer …` values |
| S6 | Showcase guest access is on by default | Info | No | Decide before production |

Clean results:
- No API key appears in any web bundle or source file.
- No real secret appears in pending changes or git history; this was checked for Anthropic, Google and ElevenLabs key patterns, private keys, Dropbox tokens, and the known Dropbox app key and secret.
- `.env`, databases and `dist/` are git-ignored.
- Refresh tokens are encrypted with AES-256-GCM.
- No endpoint returns a token (tested).
- Every AI Studio and storage endpoint is admin-only.
- Dropbox files are proxied, never linked.

## 5. Remaining risks

1. **Unpriced providers bypass the dollar budget.** Gemini, Ollama, ElevenLabs and Piper have no
   built-in price table. Unless `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK` and
   `TTS_PRICE_PER_MILLION_CHARS` are set, their requests cost $0 in the estimate. Only the request,
   character and render-minute limits apply to them.
2. **Budget is checked before a call, not during it.** One large request can overshoot the remaining
   budget by its own cost.
3. **Estimates aren't invoices.** Costs come from list prices. Long-context surcharges (for example
   Haiku 5.5 above 100K tokens) and prompt-cache pricing tiers are approximated.
4. **Model choice.** The local `.env` uses `claude-opus-5`; switch to `claude-opus-5-5` for lower cost.
   Setting a model without server-side fallback (Haiku 5.5) would fail until the `fallbacks` parameter is
   made conditional.
5. **Postgres is unverified at runtime.** It is statically compatible, but the first Postgres start runs
   migrations 006 and 007 and the entity column reconciliation untested.
6. **Rendering runs on the API process.** FFmpeg and SVG rasterising use the API server's CPU and RAM.
   Large renders compete with requests, and there is one worker per instance.
7. **Dropbox dependency.** With the temporary source policy, previews and new extractions need Dropbox to
   be reachable. Generated content does not.
8. **The development machine's C: drive is full (0–1 MB free).** This isn't caused by the project:
   APEX's temp use there is a few KB. But anything that writes to `%TEMP%` (tests, renders, Piper,
   npm) can fail on this machine until space is freed. Production should set `TEMP_PROCESSING_DIR` to a
   volume with room.
9. **Pending cleanup.** 1,620 MB of Dropbox copies stay on disk until the cleanup is approved and run.

## 6. Configuration required

**AI text** (one provider required to enable AI features):

| Variable | Value |
|---|---|
| `AI_ENABLED` | `true` |
| `AI_PROVIDER` | `anthropic`, `gemini` or `ollama` |
| `ANTHROPIC_API_KEY` | key; plus `ANTHROPIC_MODEL=claude-opus-5-5` (recommended; it is the code default when unset) |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | required together for Gemini, plus `AI_PRICE_*` for costing |
| `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | for a self-hosted model |
| `AI_FALLBACK_PROVIDER` | optional second provider |

**Voice-over:**

| Variable | Value |
|---|---|
| `MEDIA_PROVIDER` | `google`, `elevenlabs` or `piper` |
| Google | `GOOGLE_TTS_API_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` plus `GOOGLE_CLOUD_PROJECT_ID`; the Cloud Text-to-Speech API must be enabled on the project |
| ElevenLabs | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, optional `ELEVENLABS_MODEL`; plus `TTS_PRICE_PER_MILLION_CHARS` |
| Piper | `PIPER_EXECUTABLE_PATH`, `PIPER_MODEL_PATH` |
| `AUTO_GENERATE_AUDIO` | stays `false` unless automatic voice-over is wanted |

**Limits:** `AI_DAILY_LIMIT`, `AI_MONTHLY_BUDGET`, `TTS_MONTHLY_CHARACTER_LIMIT`, `VIDEO_MONTHLY_RENDER_LIMIT`.
These can also be set in AI Studio → Usage & budget. Set them before enabling paid providers.

**Production platform:**
- `DATABASE_URL` (Postgres).
- `TOKEN_ENCRYPTION_KEY`: a unique 32-byte key per environment. Changing it later requires reconnecting Dropbox.
- `COOKIE_SECURE=true` behind HTTPS.
- `NODE_ENV=production`.
- `TEMP_PROCESSING_DIR` on a volume with space.
- FFmpeg comes from `ffmpeg-static`; the platform must allow its binary to run.

**Dropbox:**
- App key and secret for each app in use (Playbooks, Meetings, Learning).
- Each redirect URI registered exactly for the production domain.
- Scopes: `account_info.read`, `files.metadata.read`, `files.content.read`.
- `files.content.write` only if videos should be uploaded to Dropbox; reconnect after changing scopes.

**Storage policy:** the defaults are safe (`DROPBOX_SOURCE_CACHE=temporary`, `STORAGE_AUTO_CLEANUP=false`).
See `Inspironics Academia/docs/dropbox/DROPBOX_API_CONFIGURATION.md`.

**SlidesVault web:** `VITE_API_BASE_URL` replaces the former `VITE_BASE44_APP_ID`.
**Showcase:** optional `OBJECT_CACHE_TTL_HOURS` (default 336).

## 7. Deployment readiness

| Area | Status |
|---|---|
| Code complete, tests green, builds green | ✅ |
| Base44 fully removed | ✅ |
| Secrets hygiene | ✅ |
| Provider credentials configured | ❌ — required (§6) |
| Real provider smoke tests | ❌ — needs credentials and approval (estimated cost: a few cents) |
| Postgres verified | ❌ — needs a test database |
| Dependency advisories | ⚠️ — pre-existing; fix `jspdf` before production |
| Production env (HTTPS cookie, keys, redirect URIs) | ❌ — to configure at deploy |
| Storage cleanup on existing data | ⏸ — awaiting approval |

## 8. Git changes summary (uncommitted)

| App | Modified | Deleted (staged) | New (untracked) | Lines vs HEAD |
|---|---:|---:|---:|---|
| Inspironics Academia | 44 | 29 | 64 | +1,517 / −3,628 (tracked files) |
| SlidesVault | 19 | 14 | 2 | +55 / −1,963 |
| Showcase | 6 | 0 | 0 | +87 / −6 |
| Repository root | — | — | 1 stray file (`ync handling`) — **exclude** | |

What changed:
- **Academia.**
  - Removed: the Base44 AI and media providers, their tests, and `legacy/base44/`.
  - Added: the AI router with Anthropic, Gemini and Ollama; the Google TTS, ElevenLabs and Piper providers; the FFmpeg video engine; the jobs queue; usage logging and limits; AI Studio (API and UI); the Dropbox storage optimisation; 20 docs (`docs/ai-studio`, `docs/dropbox`); and new tests.
- **SlidesVault.**
  - Removed: `@base44/sdk`, `base44Client.js` and `legacy/base44/`.
  - Added: `backendClient.js` on the SlidesVault API, start-script and docs updates, a retention sweep that runs even when sync is off, `.tmp` cleanup, and 2 tests.
- **Showcase.** A preview-cache TTL with a daily sweep, `.tmp` cleanup, and 1 test.

Excluded from any commit: `.env` files, databases, `dist/` (all git-ignored), and the stray root file.
Commits would go to `feature-classification-personas` as SiddharthS-Dev, one at a time, after approval.

**Nothing has been committed or deployed. Awaiting approval.**
