# Base44 Dependency Audit

> **Historical note (2026-11-13):** this document describes the state at the time it was written. Academia's AI providers in the current code are **Google Gemini (default) and Ollama only**; there is no Anthropic/Claude adapter. See `AI_PROVIDER_SETUP.md` for the current setup.

Phase A of the Base44 removal: audit of the whole `E:\apex` monorepo (Inspironics Academia, SlidesVault, Innovation Showcase, the Apex gateway). Audit run 2026-11-10, before any Base44 code was changed.

## 1. Summary

| | Count |
|---|---|
| Files that mention Base44 (excluding `node_modules`, build output, data) | 49 source/config/doc files, plus 5 Academia test files |
| Lines that mention Base44 outside `legacy/` folders | 184 (test files included) |
| **Active integrations** (spend Base44 credits today) | **2**, both in the Academia API: AI text (`InvokeLLM`) and media (`GenerateSpeech` / `GenerateVideo`) |
| Dormant integrations (code present, switched off) | 1: SlidesVault web's optional Base44 backend mode (`@base44/sdk`) |
| Legacy (reference only, never imported) | 2 folders: `Inspironics Academia/legacy/base44/`, `slide vault/legacy/base44/` |
| Base44 npm dependencies | 1: `@base44/sdk ^0.8.48` in `slide vault/apps/web/package.json` (loaded lazily, only in Base44 mode) |
| Base44 environment variables | Academia API: `AI_PROVIDER=base44`, `MEDIA_PROVIDER=base44`, `BASE44_APP_ID`, `BASE44_EMAIL`, `BASE44_PASSWORD`, `BASE44_MODEL`, `BASE44_SERVER_URL`. SlidesVault web: `VITE_BASE44_APP_ID`, `VITE_BASE44_SERVER_URL` (empty) |

The Innovation Showcase and the Apex gateway have **no** Base44 references. Dropbox, email, uploads, authentication and the database never go through Base44 in any app.

## 2. Active dependencies (Academia API)

### 2.1 AI text: Base44 `Core.InvokeLLM`

Selected by `AI_PROVIDER=base44` in `Inspironics Academia/apps/api/.env` (line 47).

| File | Lines | Role |
|---|---|---|
| `apps/api/src/ai/base44.js` | 1–91 | HTTP client for the Base44 app: sign-in (`/auth/login`), `base44Integration()` for any Core integration, `invokeBase44()` for InvokeLLM |
| `apps/api/src/ai/claude.js` | 5, 26, 31–32, 56–57 | `invokeLLM()` routes to `invokeBase44()` when the provider is `base44` |
| `apps/api/src/config.js` | 48–61 | `aiEnabled` switches on `BASE44_APP_ID`; `config.base44` block |
| `apps/api/src/server.js` | 66 | Startup log shows the provider name |

**Functionality depending on it** (every caller of `invokeLLM()`):

| Function | File | Trigger |
|---|---|---|
| `processPlaybookExtract` (contents, summaries, fallback chapters) | `pipeline/processPlaybookExtract.js:89, 139, 190` | Admin action, **and automatically for every new/changed Dropbox playbook** (`AUTO_EXTRACT_ON_SYNC=true`) |
| `processPlaybookStructure` (course design) | `pipeline/processPlaybookStructure.js:68` | Admin action |
| `generateLessonContent` | `pipeline/generateLessonContent.js:149` | Admin action (single or bulk "Generate Learning Package") |
| `generateLessonMedia` storyboard | `pipeline/generateLessonMedia.js:178` | Runs **automatically after every lesson content generation** while media is enabled |
| `generateAssessment` | `pipeline/generateAssessment.js:165` | Admin action (single or bulk "Generate Tests") |
| `processMeeting` | `pipeline/processMeeting.js:113, 123` | Admin action, **and automatically for new transcripts on sync** |
| `generateMeetingVideo` script | `pipeline/generateMeetingVideo.js:367` | Admin action |

**Replacement:** a provider router (`ai/index.js`) with adapters for Anthropic (already implemented in `claude.js`, kept), Google Gemini and optionally Ollama. All callers keep calling `invokeLLM()`. **Risk: medium.** Every content feature depends on it; the adapters must return the same parsed-JSON shape. Mitigated by the existing end-to-end pipeline tests, which will run against each adapter with mocked HTTP.

### 2.2 Media: Base44 `Core.GenerateSpeech` / `Core.GenerateVideo`

Selected by `MEDIA_PROVIDER=base44` (`.env` line 57).

| File | Lines | Role |
|---|---|---|
| `apps/api/src/media/providers/base44.js` | 1–38 | Calls GenerateSpeech (MP3) and GenerateVideo (8 s clip), downloads the returned file |
| `apps/api/src/media/index.js` | 4, 14, 28 | Registers the `base44` provider |
| `apps/api/src/media/providers/README.md` | 9 | Documents it |

**Functionality depending on it:** `generateLessonMedia` (one voice clip per scene; video clips only with `MEDIA_SCENE_CLIPS=true`, currently false) and `generateMeetingVideo` (one voice clip per scene; falls back to the browser voice when it fails).

**Replacement:** text-to-speech adapters (Google Cloud TTS primary; ElevenLabs and Piper optional) behind the existing media router, with an audio cache. Generated video clips are dropped by default; videos become template-based MP4s rendered with FFmpeg. **Risk: medium.** Recorded narration stops until a TTS provider is configured. The browser-voice fallback covers meeting briefings, and lesson players already fall back to browser speech for the script.

### 2.3 Labels and comments that name Base44 (no runtime effect)

| File | Line | Text |
|---|---|---|
| `apps/api/src/pipeline/generateMeetingVideo.js` | 17, 377 | Comments mentioning Base44 GenerateSpeech / credits |
| `apps/web/src/components/meetings/VideoBriefingTab.jsx` | 20, 92 | A comment, and the UI notice "regenerate once media credits are available for the Base44 voice" |
| `packages/shared/src/rls.js` | 3 | "Rule grammar (same as the original Base44 schemas)": historical note |
| `apps/api/.env.example` | 45–56 | Base44 configuration documentation |
| `Inspironics Academia/README.md` | 18 | Lists `legacy/base44` |
| `Inspironics Academia/docs/BUILD_SPEC.md` | 5, 15, 17, 75, 77, 112 | Original Base44 build spec (already marked historical at line 5) |

**Replacement:** reword to the provider-neutral wording, mark historical notes as such. **Risk: none.**

### 2.4 Tests that exercise Base44

| File | Covers |
|---|---|
| `apps/api/test/base44.test.js` | The Base44 AI provider against a local fake |
| `apps/api/test/base44-anon.test.js` | Anonymous Base44 access |
| `apps/api/test/media.test.js` (part) | The Base44 media provider |
| `apps/api/test/contentPipeline.test.js` | Uses a fake Base44 as its AI backend |
| `apps/api/test/meetingVideo.test.js` | Uses fake Base44 AI and speech |

**Replacement:** the provider tests move to the new adapters (Anthropic, Gemini, Ollama, Google TTS, ElevenLabs, Piper) with mocked HTTP. The pipeline tests switch their fake backend to a mocked Anthropic/Gemini endpoint. No test may call a paid API.

## 3. Dormant dependency: SlidesVault web Base44 mode

`slide vault/apps/web/src/api/base44Client.js` chooses the backend: the SlidesVault API when `VITE_API_BASE_URL` is set (always true under Apex, `apex/projects.mjs:143`), else Base44 when `VITE_BASE44_APP_ID` is set (it is empty), else the local demo. The Base44 branch lazily imports `@base44/sdk`.

| File | Lines | Depends on it |
|---|---|---|
| `apps/web/src/api/base44Client.js` | whole file (19 references) | The chooser itself; `createRemoteClient()` / `adaptRemoteClient()` are the Base44 branch |
| `apps/web/src/api/entities.js`, `functions.js`, `integrations.js` | 1 | Import `getClient` from the chooser (needed in every mode) |
| `apps/web/src/components/AiCopilot.jsx` | 11, 158 | `backendMode` |
| `apps/web/src/lib/AuthContext.jsx` | 2, 268–269 | `backendMode`, `getClient` |
| `apps/web/src/pages/DropboxSettings.jsx` | 9, 96, 558, 612 | `backendMode` |
| `apps/web/src/pages/Login.jsx`, `Register.jsx`, `ResetPassword.jsx`, `ForgotPassword.jsx` | 4–6, 203 | `isLocalMode`, `getClient`; Login shows "No Base44 app is configured" |
| `apps/web/src/api/localClient.js` | 2–7, 527 | Comments and one error message naming Base44 |
| `apps/web/package.json` | 13 | `@base44/sdk` dependency |
| `apps/web/.env.example` | 8, 25–31 | `VITE_BASE44_APP_ID` option |
| `slide vault/start.bat` | 31, 34, 141–145 | Reads `VITE_BASE44_APP_ID` for its banner |
| `slide vault/README.md`, `apps/api/docs/DEPLOYMENT.md` | 54–139; 162–163 | Documentation |

**Replacement:** rename the chooser to a provider-neutral `backendClient.js` with two modes (`api`, `local`), remove the Base44 branch and the SDK dependency, update imports and docs. **Risk: low.** The Base44 branch never runs under Apex. Sign-in and every page keep using the same exported names (`getClient`, `backendMode`, `isLocalMode`).

## 4. Legacy folders (reference only)

Neither folder is imported by any app (verified: no `import` of `legacy/` anywhere).

| Folder | Contents | References |
|---|---|---|
| `Inspironics Academia/legacy/base44/` | Original Deno functions (`generateAssessment`, `generateLessonContent`, `generateLessonMedia`, `processPlaybookExtract`, `processPlaybookStructure`, `verifyCertificate`), 15 entity schemas, SDK client, config | ≈60 lines |
| `slide vault/legacy/base44/` | Original Deno functions (`dropboxAuth`, `getDownloadLinks`, `getPresentationStream`, `recordLogin`, `renameUntitledPresentations`, `syncDropbox`, `trackView`), shared Dropbox client, entities | ≈125 lines |

**Replacement:** delete both folders after migration. Their behaviour is already re-implemented in `apps/api` (Academia) and `apps/api` (SlidesVault), and they remain in git history. **Risk: none.**

## 5. Outside the repository

The Base44-hosted app `6a7eaa5efef422ba4f16f00f` ("Inspironics Engineering Academy") uses the same integration-credit pool. Removing Base44 from this code does not stop anyone using that hosted app. Disabling or unpublishing it is a manual step in the Base44 dashboard.

## 6. Environment and hardware findings relevant to the replacement

| Item | Finding | Consequence |
|---|---|---|
| FFmpeg | **Not installed** on this machine | Use the `ffmpeg-static` npm package (bundled binary), with `FFMPEG_PATH` to point at a system FFmpeg instead |
| Slide rendering | No server-side renderer exists; slides are drawn by the web player (React) in the browser | Slides for MP4 rendering will be drawn server-side as SVG and rasterized with `@resvg/resvg-js` (no headless browser, low memory) |
| Chrome | Installed | Not required by the chosen design |
| Memory / CPU | 7.8 GB RAM total (≈1 GB free during the audit), 8 logical CPUs | No local LLM or AI video; render jobs run one at a time in the background by default |
| Job queue | None. Every pipeline function runs inside the HTTP request | A lightweight database-backed job queue is needed for video rendering |
| Usage tracking | None. No Base44 call counts are stored anywhere | New generation log table for tokens, characters, render seconds and estimated cost |
| Anthropic model | `.env` pins `ANTHROPIC_MODEL=claude-opus-5`; the code default is older | Code default moves to `claude-opus-5-5` (current Opus); the `.env` value is the owner's choice and is left as is |

## 7. Replacement plan and removal status

| # | Dependency | Status | Replacement | Risk |
|---|---|---|---|---|
| 1 | Academia `ai/base44.js` + `AI_PROVIDER=base44` | Active | AI router + Anthropic / Gemini / Ollama adapters | Medium |
| 2 | Academia `media/providers/base44.js` + `MEDIA_PROVIDER=base44` | Active | Google TTS / ElevenLabs / Piper adapters + audio cache; FFmpeg MP4 rendering | Medium |
| 3 | Academia `config.base44`, `BASE44_*` variables | Active config | Removed from config and `.env.example`; `.env` updated by hand | Low |
| 4 | Academia Base44 labels/comments | Cosmetic | Reworded | None |
| 5 | Academia Base44 tests | Test-only | Rewritten for the new adapters | None |
| 6 | SlidesVault web Base44 mode + `@base44/sdk` | Dormant | Removed; chooser renamed `backendClient.js` | Low |
| 7 | `legacy/base44` folders (both apps) | Legacy | Deleted (kept in git history) | None |
| 8 | Hosted Base44 app | External | Manual: disable in the Base44 dashboard | None for the code |

Removal status is tracked in `BASE44_REMOVAL_REPORT.md`.

## Appendix: every reference outside `legacy/`

Generated by `grep -rn -i base44` over the repository (excluding `node_modules`, `dist`, `data`, `legacy/`, `package-lock.json`). Lines are truncated to 160 characters.

```text
Inspironics Academia/apps/api/.env:45:# AI provider: anthropic (default, uses ANTHROPIC_API_KEY) or base44 (your Base44 app's built-in AI,
Inspironics Academia/apps/api/.env:46:# billed to the Base44 plan). BASE44_EMAIL/PASSWORD are only needed if the app requires sign-in.
Inspironics Academia/apps/api/.env:47:AI_PROVIDER=base44
Inspironics Academia/apps/api/.env:48:BASE44_APP_ID=6a7eaa5efef422ba4f16f00f
Inspironics Academia/apps/api/.env:49:BASE44_EMAIL=
Inspironics Academia/apps/api/.env:50:BASE44_PASSWORD=
Inspironics Academia/apps/api/.env:51:# Optional: override the Base44 app's model, e.g. claude_opus_4_8 (empty = app default)
Inspironics Academia/apps/api/.env:52:BASE44_MODEL=
Inspironics Academia/apps/api/.env:56:# base44 = the Base44 app's GenerateVideo + GenerateSpeech (uses BASE44_APP_ID, billed to its credits)
Inspironics Academia/apps/api/.env:57:MEDIA_PROVIDER=base44
Inspironics Academia/apps/api/.env.example:45:# AI provider: anthropic (default, uses ANTHROPIC_API_KEY) or base44 (your Base44 app's built-in AI,
Inspironics Academia/apps/api/.env.example:46:# billed to the Base44 plan). BASE44_EMAIL/PASSWORD are only needed if the app requires sign-in.
Inspironics Academia/apps/api/.env.example:48:BASE44_APP_ID=
Inspironics Academia/apps/api/.env.example:49:BASE44_EMAIL=
Inspironics Academia/apps/api/.env.example:50:BASE44_PASSWORD=
Inspironics Academia/apps/api/.env.example:51:# Optional: override the Base44 app's model, e.g. claude_opus_4_8 (empty = app default)
Inspironics Academia/apps/api/.env.example:52:BASE44_MODEL=
Inspironics Academia/apps/api/.env.example:56:# base44 = the Base44 app's GenerateVideo + GenerateSpeech (uses BASE44_APP_ID, billed to its credits)
Inspironics Academia/apps/api/src/ai/base44.js:5:// Base44 AI provider: calls the Base44 app's built-in Core.InvokeLLM integration — anonymously for an
Inspironics Academia/apps/api/src/ai/base44.js:6:// app that is public without login, or as a signed-in Base44 user when BASE44_EMAIL/BASE44_PASSWORD are
Inspironics Academia/apps/api/src/ai/base44.js:7:// set (external backends can't use Base44's service role). Same endpoints the official
Inspironics Academia/apps/api/src/ai/base44.js:8:// @base44/sdk uses: POST /api/apps/{appId}/auth/login and
Inspironics Academia/apps/api/src/ai/base44.js:15:const url = (path) => `${config.base44.serverUrl}/api/apps/${encodeURIComponent(config.base44.appId)}${path}`;…
Inspironics Academia/apps/api/src/ai/base44.js:24:        'X-App-Id': config.base44.appId,
Inspironics Academia/apps/api/src/ai/base44.js:31:    throw new HttpError(502, `Could not reach Base44 (${err.name === 'TimeoutError' ? 'timed out' : err.messag…
Inspironics Academia/apps/api/src/ai/base44.js:42:  const { status, data } = await post('/auth/login', { email: config.base44.email, password: config.base44.pas…
Inspironics Academia/apps/api/src/ai/base44.js:44:    log.warn('ai.base44.login_failed', { status });
Inspironics Academia/apps/api/src/ai/base44.js:45:    throw unavailable(`Base44 sign-in failed (${status}${detail(data) ? `: ${String(detail(data)).slice(0, 200…
Inspironics Academia/apps/api/src/ai/base44.js:50:const hasLogin = () => !!(config.base44.email && config.base44.password);
Inspironics Academia/apps/api/src/ai/base44.js:61:// Calls one of the Base44 app's built-in Core integrations (InvokeLLM, GenerateVideo, GenerateSpeech…),
Inspironics Academia/apps/api/src/ai/base44.js:63:export async function base44Integration(endpoint, body) {
Inspironics Academia/apps/api/src/ai/base44.js:67:    throw unavailable(`This Base44 app requires sign-in for ${endpoint} — set BASE44_EMAIL and BASE44_PASSWO…
Inspironics Academia/apps/api/src/ai/base44.js:70:  if (res.status === 429) throw new HttpError(429, `Base44 ${endpoint} rate limit or credit limit reached — …
Inspironics Academia/apps/api/src/ai/base44.js:72:    throw new HttpError(502, `Base44 ${endpoint} error (${res.status})${detail(res.data) ? `: ${String(detail(…
Inspironics Academia/apps/api/src/ai/base44.js:77:export async function invokeBase44({ system, prompt, schema }) {
Inspironics Academia/apps/api/src/ai/base44.js:78:  const out = await base44Integration('InvokeLLM', {
Inspironics Academia/apps/api/src/ai/base44.js:81:    ...(config.base44.model ? { model: config.base44.model } : {}),
Inspironics Academia/apps/api/src/ai/base44.js:88:    throw new HttpError(502, 'Base44 AI returned malformed JSON');
Inspironics Academia/apps/api/src/ai/claude.js:5:import { invokeBase44 } from './base44.js';
Inspironics Academia/apps/api/src/ai/claude.js:26:  return config.aiProvider === 'base44' ? `base44${config.base44.model ? `:${config.base44.model}` : ''}` : co…
Inspironics Academia/apps/api/src/ai/claude.js:31:    throw unavailable(config.aiProvider === 'base44'
Inspironics Academia/apps/api/src/ai/claude.js:32:      ? 'AI is disabled. Set AI_ENABLED=true and BASE44_APP_ID on the API server.'
Inspironics Academia/apps/api/src/ai/claude.js:56:  // Base44 takes no token/effort settings; nothing here sends images.
Inspironics Academia/apps/api/src/ai/claude.js:57:  if (config.aiProvider === 'base44') return invokeBase44({ system, prompt, schema });
Inspironics Academia/apps/api/src/config.js:48:  // AI. AI_PROVIDER=anthropic (Claude via @anthropic-ai/sdk) or base44 (the Base44 app's built-in
Inspironics Academia/apps/api/src/config.js:49:  // InvokeLLM, called anonymously when the app allows it, else as a signed-in Base44 user — billed to the Base…
Inspironics Academia/apps/api/src/config.js:51:  aiEnabled: bool(env.AI_ENABLED, false) && ((env.AI_PROVIDER || 'anthropic').toLowerCase() === 'base44'
Inspironics Academia/apps/api/src/config.js:52:    ? !!env.BASE44_APP_ID
Inspironics Academia/apps/api/src/config.js:55:  base44: {
Inspironics Academia/apps/api/src/config.js:56:    serverUrl: (env.BASE44_SERVER_URL || 'https://base44.app').replace(/\/+$/, ''),
Inspironics Academia/apps/api/src/config.js:57:    appId: env.BASE44_APP_ID || '',
Inspironics Academia/apps/api/src/config.js:58:    email: env.BASE44_EMAIL || '',
Inspironics Academia/apps/api/src/config.js:59:    password: env.BASE44_PASSWORD || '',
Inspironics Academia/apps/api/src/config.js:60:    model: env.BASE44_MODEL || '', // empty = the Base44 app's own model setting
Inspironics Academia/apps/api/src/media/index.js:4:import base44 from './providers/base44.js';
Inspironics Academia/apps/api/src/media/index.js:14:  base44,
Inspironics Academia/apps/api/src/media/index.js:28:  if (config.mediaProvider === 'base44') return unavailable('Base44 media needs BASE44_APP_ID on the API ser…
Inspironics Academia/apps/api/src/media/providers/base44.js:2:import { base44Integration } from '../../ai/base44.js';
Inspironics Academia/apps/api/src/media/providers/base44.js:4:// Base44 media provider: the Base44 app's built-in Core.GenerateVideo (8-second silent clip) and
Inspironics Academia/apps/api/src/media/providers/base44.js:5:// Core.GenerateSpeech (MP3 narration). Base44 answers with a public media URL; we download the fi…
Inspironics Academia/apps/api/src/media/providers/base44.js:10:const MEDIA_HOST = /^https:\/\/([a-z0-9-]+\.)*base44\.(com|app)\//i;
Inspironics Academia/apps/api/src/media/providers/base44.js:13:  if (typeof url !== 'string' || !MEDIA_HOST.test(url)) throw new Error('Base44 returned no media…
Inspironics Academia/apps/api/src/media/providers/base44.js:15:  if (!res.ok) throw new Error(`Downloading Base44 media failed (${res.status})`);
Inspironics Academia/apps/api/src/media/providers/base44.js:17:  if (!bytes.length) throw new Error('Base44 media file was empty');
Inspironics Academia/apps/api/src/media/providers/base44.js:18:  if (bytes.length > MAX_BYTES) throw new Error('Base44 media file is too large');
Inspironics Academia/apps/api/src/media/providers/base44.js:25:  name: 'base44',
Inspironics Academia/apps/api/src/media/providers/base44.js:26:  enabled: !!config.base44.appId,
Inspironics Academia/apps/api/src/media/providers/base44.js:29:    const res = await base44Integration('GenerateVideo', { prompt, duration: durationSeconds, asp…
Inspironics Academia/apps/api/src/media/providers/base44.js:34:    const res = await base44Integration('GenerateSpeech', { text, voice });
Inspironics Academia/apps/api/src/media/providers/README.md:9:| `base44` | ✓ | ✓ | The Base44 app's built-in `Core.GenerateVideo` (8 s, 16:9) and `Core.Gene…
Inspironics Academia/apps/api/src/pipeline/generateMeetingVideo.js:17:// the parts are voiced (MEDIA_PROVIDER, e.g. Base44 GenerateSpeech), joined into one trac…
Inspironics Academia/apps/api/src/pipeline/generateMeetingVideo.js:377:    // knows when it plays). When the provider is off or refuses (e.g. Base44 out of mont…
Inspironics Academia/apps/api/src/server.js:66:    model: config.aiEnabled ? (config.aiProvider === 'base44' ? 'base44' : config.anthropicModel) : undefined,
Inspironics Academia/apps/api/test/base44-anon.test.js:5:// Base44 AI provider with no BASE44_EMAIL/PASSWORD: calls InvokeLLM without signing in.
Inspironics Academia/apps/api/test/base44-anon.test.js:22:  AI_PROVIDER: 'base44',
Inspironics Academia/apps/api/test/base44-anon.test.js:23:  BASE44_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
Inspironics Academia/apps/api/test/base44-anon.test.js:24:  BASE44_APP_ID: 'app-anon',
Inspironics Academia/apps/api/test/base44-anon.test.js:25:  BASE44_EMAIL: '',
Inspironics Academia/apps/api/test/base44-anon.test.js:26:  BASE44_PASSWORD: '',
Inspironics Academia/apps/api/test/base44-anon.test.js:40:  await assert.rejects(invokeLLM({ prompt: 'hi' }), (err) => err.status === 503 && /BASE44_EMAIL/.test…
Inspironics Academia/apps/api/test/base44.test.js:5:// Base44 AI provider against a local stand-in for the Base44 API. No real network.
Inspironics Academia/apps/api/test/base44.test.js:35:  AI_PROVIDER: 'base44',
Inspironics Academia/apps/api/test/base44.test.js:36:  BASE44_SERVER_URL: `http://127.0.0.1:${server.address().port}/`,
Inspironics Academia/apps/api/test/base44.test.js:37:  BASE44_APP_ID: 'app-123',
Inspironics Academia/apps/api/test/base44.test.js:38:  BASE44_EMAIL: 'admin@example.com',
Inspironics Academia/apps/api/test/base44.test.js:39:  BASE44_PASSWORD: 'pw',
Inspironics Academia/apps/api/test/base44.test.js:43:test('base44 provider is enabled by its own credentials', () => {
Inspironics Academia/apps/api/test/base44.test.js:45:  assert.equal(aiModel(), 'base44');
Inspironics Academia/apps/api/test/contentPipeline.test.js:9:// The playbook → course pipeline end to end, with the AI answered by a local stand-in for Base44…
Inspironics Academia/apps/api/test/contentPipeline.test.js:14:// ---- fake Base44 AI -------------------------------------------------------------------------
Inspironics Academia/apps/api/test/contentPipeline.test.js:107:  AI_ENABLED: 'true', AI_PROVIDER: 'base44', BASE44_APP_ID: 'app-test', BASE44_EMAIL: '', BASE44_…
Inspironics Academia/apps/api/test/contentPipeline.test.js:108:  BASE44_SERVER_URL: `http://127.0.0.1:${ai.address().port}/`, MEDIA_PROVIDER: 'none',
Inspironics Academia/apps/api/test/media.test.js:5:process.env.BASE44_APP_ID = 'app-media-test';
Inspironics Academia/apps/api/test/media.test.js:6:process.env.BASE44_SERVER_URL = 'http://127.0.0.1:9';
Inspironics Academia/apps/api/test/media.test.js:9:const base44Media = (await import('../src/media/providers/base44.js')).default;
Inspironics Academia/apps/api/test/media.test.js:36:test('base44 media provider is enabled by the app id and refuses non-Base44 media URLs', async () => {
Inspironics Academia/apps/api/test/media.test.js:37:  assert.equal(base44Media.enabled, true);
Inspironics Academia/apps/api/test/media.test.js:46:    await assert.rejects(base44Media.generateVideo({ prompt: 'x', durationSeconds: 8, aspectRatio: '16:9' })…
Inspironics Academia/apps/api/test/media.test.js:52:test('base44 media provider downloads the returned file into bytes', async () => {
Inspironics Academia/apps/api/test/media.test.js:56:      return new Response(JSON.stringify({ url: 'https://media.base44.com/files/public/app/speech.mp3' }), {…
Inspironics Academia/apps/api/test/media.test.js:58:    if (String(url) === 'https://media.base44.com/files/public/app/speech.mp3') {
Inspironics Academia/apps/api/test/media.test.js:64:    const out = await base44Media.generateNarration({ text: 'Hello', voice: 'storm' });
Inspironics Academia/apps/api/test/meetingVideo.test.js:9:// action item is guaranteed to be in it, each scene is voiced (Base44 GenerateSpeech) and the parts
Inspironics Academia/apps/api/test/meetingVideo.test.js:10:// are joined into one narration track with slides and subtitles timed to it. Base44 is a local fake.…
Inspironics Academia/apps/api/test/meetingVideo.test.js:29:const base44 = http.createServer((req, res) => {
Inspironics Academia/apps/api/test/meetingVideo.test.js:39:      return send(200, { url: `https://media.base44.com/speech-${spoken.length}.mp3` });
Inspironics Academia/apps/api/test/meetingVideo.test.js:44:await new Promise((r) => base44.listen(0, '127.0.0.1', r));
Inspironics Academia/apps/api/test/meetingVideo.test.js:46:// Base44 answers with a public media URL; the provider downloads it.
Inspironics Academia/apps/api/test/meetingVideo.test.js:48:globalThis.fetch = async (url, init) => (String(url).startsWith('https://media.base44.com/')
Inspironics Academia/apps/api/test/meetingVideo.test.js:55:  AI_ENABLED: 'true', AI_PROVIDER: 'base44', MEDIA_PROVIDER: 'base44', BASE44_APP_ID: 'app-test', BAS…
Inspironics Academia/apps/api/test/meetingVideo.test.js:56:  BASE44_SERVER_URL: `http://127.0.0.1:${base44.address().port}/`,
Inspironics Academia/apps/api/test/meetingVideo.test.js:116:  base44.close();
Inspironics Academia/apps/api/test/meetingVideo.test.js:187:test('without a recorded voice (e.g. no Base44 credits) the briefing is still made, for the browser …
Inspironics Academia/apps/web/src/components/meetings/VideoBriefingTab.jsx:20:// and subtitles in step with the narration. Admins generate (and regenerate) it w…
Inspironics Academia/apps/web/src/components/meetings/VideoBriefingTab.jsx:92:            <span>No recorded voice-over{meeting.briefing_error ? ` — ${meeting.…
Inspironics Academia/packages/shared/src/rls.js:3:// Rule grammar (same as the original Base44 schemas):
Inspironics Academia/README.md:18:| `legacy/base44` | — | Retired Base44 artifacts (reference only) |
slide vault/apps/web/.env.example:8:#   2. VITE_BASE44_APP_ID  a deployed Base44 app
slide vault/apps/web/.env.example:25:# --- option 2: Base44 ------------------------------------------------------
slide vault/apps/web/.env.example:26:# The app id is the part of the Base44 editor URL between /apps/ and /editor/.
slide vault/apps/web/.env.example:28:VITE_BASE44_APP_ID=
slide vault/apps/web/.env.example:30:# Optional: override the Base44 server (defaults to https://base44.app).
slide vault/apps/web/.env.example:31:# VITE_BASE44_SERVER_URL=
slide vault/apps/web/package.json:13:    "@base44/sdk": "^0.8.48",
slide vault/apps/web/src/api/base44Client.js:11: * - Otherwise, with VITE_BASE44_APP_ID set, the @base44/sdk client is used, so
slide vault/apps/web/src/api/base44Client.js:12: *   the app reads the live catalog from the deployed Base44 app and calls the
slide vault/apps/web/src/api/base44Client.js:13: *   serverless functions in base44/functions/.
slide vault/apps/web/src/api/base44Client.js:19: * configured, or a Base44 SDK that fails to load, reports the problem instead
slide vault/apps/web/src/api/base44Client.js:26:const APP_ID = import.meta.env.VITE_BASE44_APP_ID;
slide vault/apps/web/src/api/base44Client.js:27:const SERVER_URL = import.meta.env.VITE_BASE44_SERVER_URL || 'https://base44.app';
slide vault/apps/web/src/api/base44Client.js:33:/** 'api' | 'base44' | 'local' | 'none' — for the few places that must adapt. */
slide vault/apps/web/src/api/base44Client.js:34:export const backendMode = isApiMode ? 'api' : APP_ID ? 'base44' : isLocalMode ? 'local' : 'none';
slide vault/apps/web/src/api/base44Client.js:68:    // Base44 hosts the identity provider, so both methods are always offered.
slide vault/apps/web/src/api/base44Client.js:72:      // Base44 sends the browser back to this URL with ?access_token=..., which
slide vault/apps/web/src/api/base44Client.js:95:    // Logout is a full-page round trip through Base44 so the HTTP-only cookies
slide vault/apps/web/src/api/base44Client.js:99:    /** Hands off to Base44's hosted sign-in (covers SSO, magic links, invites). */
slide vault/apps/web/src/api/base44Client.js:104:    mode: 'base44',
slide vault/apps/web/src/api/base44Client.js:115:  const { createClient } = await import('@base44/sdk');
slide vault/apps/web/src/api/base44Client.js:122:    // Base44 and lands on the app's own 404.
slide vault/apps/web/src/api/base44Client.js:137:        'VITE_BASE44_APP_ID, or VITE_DEMO_MODE=true for the local demo.'
slide vault/apps/web/src/api/base44Client.js:142:      console.error('[SlidesVault] The Base44 SDK could not be loaded.', err);
slide vault/apps/web/src/api/base44Client.js:146:      throw backendUnavailable('The Base44 backend could not be loaded. Reload the page to try again.', err);
slide vault/apps/web/src/api/base44Client.js:152:/** The synchronously-known client, or null when it has to be loaded (Base44) or none exists. */
slide vault/apps/web/src/api/entities.js:1:import { getClient } from './base44Client';
slide vault/apps/web/src/api/functions.js:1:import { getClient } from './base44Client';
slide vault/apps/web/src/api/functions.js:4: * Calls a backend function by name. On Base44 these are the handlers under
slide vault/apps/web/src/api/functions.js:5: * base44/functions/<name>/entry.ts; locally they are simulated in localClient.
slide vault/apps/web/src/api/integrations.js:1:import { getClient } from './base44Client';
slide vault/apps/web/src/api/localClient.js:2: * Local backend used when no Base44 app id is configured.
slide vault/apps/web/src/api/localClient.js:4: * It implements the same surface the app consumes from the Base44 SDK
slide vault/apps/web/src/api/localClient.js:7: * is explorable without any cloud credentials. Point VITE_BASE44_APP_ID at a
slide vault/apps/web/src/api/localClient.js:527:              'Dropbox OAuth needs a deployed backend. Configure VITE_BASE44_APP_ID and deploy base44/functions/…
slide vault/apps/web/src/components/AiCopilot.jsx:11:import { backendMode } from '@/api/base44Client';
slide vault/apps/web/src/lib/AuthContext.jsx:2:import { backendMode, getClient } from '@/api/base44Client';
slide vault/apps/web/src/lib/AuthContext.jsx:268:      // simulates the Copilot and Base44 hosts the model, so both have one.
slide vault/apps/web/src/pages/DropboxSettings.jsx:9:import { backendMode } from '@/api/base44Client';
slide vault/apps/web/src/pages/ForgotPassword.jsx:4:import { getClient } from '@/api/base44Client';
slide vault/apps/web/src/pages/Login.jsx:6:import { isLocalMode } from '@/api/base44Client';
slide vault/apps/web/src/pages/Login.jsx:203:              No Base44 app is configured, so a seeded catalog and demo accounts are in use.
slide vault/apps/web/src/pages/Register.jsx:5:import { isLocalMode } from '@/api/base44Client';
slide vault/apps/web/src/pages/ResetPassword.jsx:4:import { getClient, isLocalMode } from '@/api/base44Client';
slide vault/README.md:54:`src/api/base44Client.js` is the only place that knows which backend is in play; everything above
slide vault/README.md:60:| Base44 | `VITE_BASE44_APP_ID` | The serverless functions in [`base44/`](base44/) |
slide vault/README.md:85:### Base44
slide vault/README.md:87:1. Create a Base44 app and deploy the entities in [`legacy/base44/entities/`](legacy/base44/entities/) and the
slide vault/README.md:88:   functions in [`legacy/base44/functions/`](legacy/base44/functions/).
slide vault/README.md:90:3. Copy `.env.example` to `.env` and set `VITE_BASE44_APP_ID`.
slide vault/README.md:91:4. `npm install @base44/sdk` — it is loaded lazily, so it is only needed in this mode.
slide vault/README.md:104:                    (bundled offline backend), base44Client (legacy chooser),
slide vault/README.md:139:  base44/         retired Base44 entities and functions, kept for reference
slide vault/start.bat:31:set "BASE44APP="
slide vault/start.bat:34:    if /I "%%K"=="VITE_BASE44_APP_ID" if not "%%L"=="" set "BASE44APP=%%L"
slide vault/start.bat:141:if defined BASE44APP (
slide vault/start.bat:142:  echo       Backend: Base44 app %BASE44APP%
slide vault/start.bat:143:  echo       Sign in with your Base44 account.
slide vault/start.bat:145:  echo       Backend: local demo catalog ^(no VITE_BASE44_APP_ID set^)
```

### Legacy folders: references per file

```text
Inspironics Academia/legacy/base44/base44Client.js:6
Inspironics Academia/legacy/base44/config.jsonc:2
Inspironics Academia/legacy/base44/functions/generateAssessment/entry.ts:5
Inspironics Academia/legacy/base44/functions/generateLessonContent/entry.ts:8
Inspironics Academia/legacy/base44/functions/generateLessonMedia/entry.ts:8
Inspironics Academia/legacy/base44/functions/processPlaybookExtract/entry.ts:19
Inspironics Academia/legacy/base44/functions/processPlaybookStructure/entry.ts:8
Inspironics Academia/legacy/base44/functions/verifyCertificate/entry.ts:3
Inspironics Academia/legacy/base44/README.md:3
slide vault/legacy/base44/functions/dropboxAuth/entry.ts:18
slide vault/legacy/base44/functions/getDownloadLinks/entry.ts:6
slide vault/legacy/base44/functions/getPresentationStream/entry.ts:8
slide vault/legacy/base44/functions/recordLogin/entry.ts:5
slide vault/legacy/base44/functions/renameUntitledPresentations/entry.ts:13
slide vault/legacy/base44/functions/syncDropbox/entry.ts:36
slide vault/legacy/base44/functions/trackView/entry.ts:8
slide vault/legacy/base44/shared/dropboxClient.ts:24
```
