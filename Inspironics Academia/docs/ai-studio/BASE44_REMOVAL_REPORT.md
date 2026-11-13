# Base44 removal report

> **Historical note (2026-11-13):** this document describes the state at the time it was written. Academia's AI providers in the current code are **Google Gemini (default) and Ollama only**; there is no Anthropic/Claude adapter. See `AI_PROVIDER_SETUP.md` for the current setup.

Status on 2026-11-10: **Base44 is no longer used anywhere in the Apex code.** No code, configuration, package or test references it. The only mentions left are in documentation: `BASE44_DEPENDENCY_AUDIT.md` (this migration's audit) and `docs/BUILD_SPEC.md` (the original spec, marked historical).

## Summary

| | Count |
|---|---|
| Files that referenced Base44 at the start (audit) | 49, plus 5 test files |
| Active integrations removed | 2 (Academia AI text via `InvokeLLM`; Academia voice/video via `GenerateSpeech` / `GenerateVideo`) |
| Dormant integrations removed | 1 (SlidesVault web's optional Base44 backend mode) |
| Legacy folders removed | 2 (`Inspironics Academia/legacy/base44`, `slide vault/legacy/base44`; kept in git history) |
| npm dependencies removed | `@base44/sdk` (SlidesVault web) |
| Environment variables retired | `BASE44_APP_ID`, `BASE44_EMAIL`, `BASE44_PASSWORD`, `BASE44_MODEL`, `BASE44_SERVER_URL`, `AI_PROVIDER=base44`, `MEDIA_PROVIDER=base44` (Academia); `VITE_BASE44_APP_ID`, `VITE_BASE44_SERVER_URL` (SlidesVault web) |

## What was removed, by item

| # | Item | Was | Replaced by | Status |
|---|---|---|---|---|
| 1 | `apps/api/src/ai/base44.js` | Base44 HTTP client (sign-in, `InvokeLLM`) | `ai/index.js` router + `ai/providers/{anthropic,gemini,ollama}.js` | Deleted |
| 2 | `apps/api/src/ai/claude.js` | `invokeLLM()` with a Base44 branch | `ai/index.js` (same `invokeLLM()` contract), `ai/schema.js`, `ai/providers/anthropic.js` | Deleted; all 8 importers updated |
| 3 | `apps/api/src/media/providers/base44.js` | `GenerateSpeech` / `GenerateVideo` | `media/providers/{google-tts,elevenlabs,piper}.js`; FFmpeg video engine `media/video/*` | Deleted |
| 4 | `config.base44`, Base44 env handling in `config.js` | Configuration | Provider-neutral `ai`, `tts`, `video`, `limits` configuration | Removed |
| 5 | Base44 labels and comments (`server.js`, `generateMeetingVideo.js`, `VideoBriefingTab.jsx`, `media/providers/README.md`, `rls.js`) | Text | Provider-neutral wording; `rls.js` note marked historical | Updated |
| 6 | `apps/api/.env.example`, local `.env` | Base44 variables | AI, voice, video, generation-switch, limit and price variables | Updated (the local `.env` keeps your AI switch and model) |
| 7 | `test/base44.test.js`, `test/base44-anon.test.js` | Base44 provider tests | `test/aiRouter.test.js`, `test/tts.test.js` | Deleted |
| 8 | Pipeline tests using a fake Base44 | Test fixtures | Mocked Gemini API and Google TTS | Rewritten |
| 9 | SlidesVault `src/api/base44Client.js` | Backend chooser with a Base44 branch | `src/api/backendClient.js` (API server or local demo) | Replaced; 10 importers updated |
| 10 | SlidesVault `@base44/sdk`, `.env.example`, `start.bat`, README, DEPLOYMENT, login text, local-client comments | Dormant mode | Removed or reworded | Done |
| 11 | `legacy/base44` folders (both apps) | Reference-only Deno functions and schemas | Already reimplemented in each app's API | Deleted |
| 12 | `Inspironics Academia/README.md` legacy row, `docs/BUILD_SPEC.md` note | Docs | Row removed; spec marked historical | Done |

## Verified before deleting

- Nothing imports `legacy/` in either app.
- SlidesVault's Base44 branch only runs when `VITE_BASE44_APP_ID` is set with no API URL. Under Apex the API URL is always set (`apex/projects.mjs`), and the app ID was empty.
- No other app (Showcase, the Apex gateway) referenced Base44.
- The replacement providers pass their tests before the old files were removed. All Academia (178) and SlidesVault (201) tests pass after removal, and both web apps build.

## Not covered by code changes (manual step)

The Base44-hosted app **"Inspironics Engineering Academy" (`6a7eaa5efef422ba4f16f00f`)** still exists on Base44 and uses the same credit pool. If nobody uses it, unpublish or delete it in the Base44 dashboard. Nothing in Apex depends on it any more.
