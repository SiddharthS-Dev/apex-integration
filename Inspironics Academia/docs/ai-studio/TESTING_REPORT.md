# Testing report: Base44 removal and AI Studio

> **Historical note (2026-11-13):** this document describes the state at the time it was written. Academia's AI providers in the current code are **Google Gemini (default) and Ollama only**; there is no Anthropic/Claude adapter. See `AI_PROVIDER_SETUP.md` for the current setup.

Run on 2026-11-10 on the development laptop (Windows 11, Node 22.23, 8 logical CPUs, 7.8 GB RAM). Automated tests use **mocked provider APIs**: no paid API was called. Everything below was executed; nothing is reported as passed without having run.

## Automated tests

### Academia API: 178 of 178 pass (21 files, ≈22 s)

New or rewritten for this migration:

| File | Tests | Covers |
|---|---|---|
| `test/aiRouter.test.js` | 9 | Anthropic via the SDK (request shape: streaming, strict schema, adaptive thinking, refusal fallbacks), Gemini and Ollama adapters, Gemini schema fallback, provider fallback (logged), content cache and `fresh`, output-shape rejection, cost estimates, daily and monthly limits, no keys in config output |
| `test/tts.test.js` | 9 | Google TTS (API key and service-account JWT), ElevenLabs, sentence chunking (≤ 4,500 bytes, order kept), audio cache key and reuse, monthly character limit, usage and cost logging, voice listing, refusals |
| `test/videoEngine.test.js` | 5 | **Real FFmpeg renders**: SRT/VTT generation and wrapping, slide timeline, every slide layout rasterised, an MP4 rendered from real MP3 narration and read back, subtitle offsets across scenes, scene-cache reuse (1 reused, 1 rendered after editing one scene), render usage log, manifest validation |
| `test/studio.test.js` | 10 | Over HTTP: admin-only access; content generation (markdown and JSON); voice and cache; project from a DOCX with AI scenes, editing, slide image (type-checked), preview PNG; background render job with dedupe, progress, MP4 streaming with Range; single-scene re-render (no new voice-over); browser-voiced meeting rendered with per-scene TTS; lesson MP4 from a recorded track; job cancel and retry; usage dashboard totals; render limit enforced; sync extraction makes no AI call |
| `test/contentPipeline.test.js` | 10 | The full playbook → course → lessons → assessments pipeline, now against a mocked Gemini API (was Base44) |
| `test/meetingVideo.test.js` | 9 | Meeting briefings against mocked Gemini and Google TTS (was Base44), including the browser-voice fallback |
| `test/media.test.js` | 8 | Narration helpers and MP3 joining (Base44 provider tests removed) |

Removed: `test/base44.test.js`, `test/base44-anon.test.js` (they tested the deleted Base44 provider; the new router tests replace them).

All other existing suites still pass unchanged: authentication, roles and categories, Dropbox flows and sources, sync, meetings, retention, recertification, deletion, final tests, video plans.

### SlidesVault API: 201 of 201 pass

Run after removing SlidesVault's Base44 mode, as a regression check.

### Builds

- Academia web: `vite build` passes.
- SlidesVault web: `vite build` passes (without `@base44/sdk`).

## Live checks on the running system (real data)

| Check | Result |
|---|---|
| API starts with the new configuration | Health 200. Startup reports `ai_config: { provider: 'anthropic', enabled: false }` (no key yet), voice `none`, video available |
| Real lesson MP4 from existing narration ("Text Normalization Techniques") | Job completed: 4 scenes, **185.55 s** of video, 5.6 MB, rendered in **79 s**; H.264 1280×720 25 fps + AAC 44.1 kHz stereo; SRT/VTT correct; a frame was inspected visually |
| Header overflow found in that frame | Fixed (header truncated to the space before the progress dots); template version bumped |
| Voice without a provider | 503 "Voice-over is turned off (MEDIA_PROVIDER=none)" |
| AI without a key | 503 "AI is not configured…" |
| Project from a real meeting briefing | 201, scenes copied (test project deleted afterwards) |
| Render a browser-voiced briefing without TTS | 503 with a clear message |
| Usage endpoint | Shows the real render (185.55 s, ffmpeg, $0) |
| AI Studio page (headless Chrome via the Apex gateway) | Video and Usage tabs render with live data and no console errors; narrow-width layout checked |

## Not executed (needs external accounts or software)

| Not run | Why | How to verify |
|---|---|---|
| Real Anthropic, Gemini, Google TTS or ElevenLabs calls | No keys configured; paid calls need authorisation | Add keys (see the setup guides), then AI Studio → Content and Voice |
| Piper | Not installed on this machine | Install Piper and a voice model, set `MEDIA_PROVIDER=piper` |
| Ollama | No Ollama server available | Point `OLLAMA_BASE_URL` at a server |
| Postgres | The suites use SQLite (as before); the new tables have Postgres-compatible SQL | Run the API against Postgres and open AI Studio |
| Automated frontend tests | The Academia web app has no test setup (known gap) | Visual checks above; adding a web test setup is recommended |
| Remotion | Optional, not installed (licence review needed) | — |

## Known issues

- Without a voice provider, lesson media and new briefing voice-overs cannot be recorded. Players fall back to the browser voice, and MP4 renders that need new narration are refused with a clear message.
- Studio project creation from a lesson or meeting copies its current scenes; later changes to the lesson are not synced back into the project.
