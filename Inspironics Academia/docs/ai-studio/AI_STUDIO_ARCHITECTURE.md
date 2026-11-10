# AI Studio architecture

How Inspironics Academia generates content, voice-overs and videos without Base44. All AI, voice and rendering work runs on the Academia API server (`apps/api`); the browser never holds a provider key.

## Overview

```
Web app (Academia)                         AI Studio page · lesson review · meeting briefing tab
        │  HTTPS, session cookie
        ▼
Academia API (Express)
  ├─ functions/routes.js   POST /api/functions/:name   (pipeline functions; sets the generation context)
  ├─ studio/routes.js      /api/studio/*               (admin: generate, voice, projects, jobs, usage, limits)
  │
  ├─ ai/index.js           AI provider router ──► providers/anthropic.js  (Claude, official SDK)
  │                                           ├► providers/gemini.js     (Gemini REST)
  │                                           └► providers/ollama.js     (optional, self-hosted)
  ├─ media/index.js        Voice provider router ─► providers/google-tts.js · elevenlabs.js · piper.js
  ├─ media/video/          Video engine: slides.js (SVG templates) → resvg (PNG) → ffmpeg.js (MP4)
  │                        renderer.js (scene cache, subtitles, thumbnail) · subtitleGenerator.js (SRT/VTT)
  ├─ jobs/queue.js         Background job queue (database-backed) for renders
  ├─ usage/                Generation log, prices, limits, request context
  └─ files/objectStore.js  Storage for audio, video, subtitles, thumbnails, caches
        │
        ▼
Database (SQLite / Postgres): entities + generation_log + jobs + settings
```

## Layers and responsibilities

| Layer | Files | Responsibility |
|---|---|---|
| AI provider router | `ai/index.js`, `ai/schema.js` | Single entry point `invokeLLM()`. Picks the provider (`AI_PROVIDER`, or per request), checks limits, serves the content cache, falls back on availability errors (`AI_FALLBACK_PROVIDER`, logged), validates JSON output against the requested schema, logs tokens and estimated cost. |
| AI providers | `ai/providers/*.js` | Adapters with one method, `generate({ system, prompt, schema, maxTokens, effort, images }) → { text, usage, model }`. `http.js` gives REST providers retries with exponential backoff. |
| Voice router | `media/index.js` | `synthesize(text, settings)`: provider choice, audio cache, character limit, usage log, storage. `generateNarration()` keeps the pipelines' interface. |
| Voice providers | `media/providers/*.js` | `synthesize()` → MP3 bytes, `voices()`. Long text chunked at sentence ends and joined frame by frame (`media/mp3.js`). |
| Video engine | `media/video/*.js` | Scene manifest → timeline → SVG slides → PNG → per-scene MP4 (H.264/AAC) → concatenated MP4, SRT/VTT, thumbnail. Scene cache for scene-level re-rendering. |
| Render pipeline | `pipeline/renderVideo.js` | Builds manifests for lessons, meeting briefings and Studio projects; registers the `render:*` job handlers and the `render*Video` functions. |
| Jobs | `jobs/queue.js` | Queue, worker, progress, cancel, retry, dedupe, concurrency, restart recovery. |
| Usage | `usage/*.js` | `generation_log` table, totals, prices, limits (env defaults + admin overrides), the request context (operation, user, record, fresh). |
| Studio API | `studio/*.js` | Content types and prompts, video projects, Studio endpoints. |
| Web | `pages/admin/AIStudio.jsx`, `components/studio/*`, `lib/studio.js` | Content, Voice, Video, History, Usage & budget tabs; MP4 panels on lessons and meetings; cost confirmation for bulk actions. |

Business logic (extraction, course design, lessons, assessments, meetings) is unchanged: it still calls `invokeLLM()` and `generateNarration()`, which now route to the configured providers. Changing a provider never touches business logic.

## Data model additions

| Where | What |
|---|---|
| `generation_log` table (migration `006`) | One row per AI call, voice-over or render: kind, operation, provider, model, status (`ok`, `cached`, `error`, `blocked`, `cancelled`), tokens, characters, seconds, estimated cost, duration, record, user, output link. |
| `jobs` table (migration `007`) | Background jobs: type, status, payload, result, error, progress, message, attempts, dedupe key, record, cancel flag, timestamps. |
| `Lesson` | `rendered_video_url`, `rendered_thumbnail_url`, `rendered_subtitles_url`, `rendered_srt_url`, `rendered_video_seconds`, `rendered_video_rendered_at`, `rendered_scenes_signature`. |
| `Meeting` | `briefing_voice`, `briefing_video_url`, `briefing_thumbnail_url`, `briefing_subtitles_url`, `briefing_srt_url`, `briefing_video_seconds`, `briefing_video_rendered_at`. |
| `VideoProject` (new, admin-only) | Studio videos: title, source, header line, scenes (JSON), voice settings, presenter and subtitle switches, status, outputs. |
| Settings `usage.limits` | Limits changed by administrators at runtime. |

Columns are added by the existing entity reconciliation; nothing is dropped and existing data is untouched.

## Generation flows

**Lesson content** (unchanged purpose): `generateLessonContent` → one AI request. It no longer voices the lesson automatically (`AUTO_GENERATE_AUDIO=false`); media is generated per lesson or with "Regenerate Media".

**Lesson media**: `generateLessonMedia` → AI storyboard (1 request) + one voice clip per scene through the voice router (cached by text and voice) → slides and subtitles played in the browser.

**Lesson MP4**: `renderLessonVideo` → job `render:lesson` → the lesson's slides + its recorded narration track → MP4 + SRT/VTT + thumbnail on the lesson.

**Meeting briefing**: `generateMeetingVideo` → AI script (or written from the notes) → voice per scene, or browser voice when no provider is configured. `renderMeetingVideo` → job `render:meeting` → MP4 (voicing the scenes first when the briefing has no recorded narration).

**Studio project**: create from a lesson, meeting briefing, document, text or blank → edit scenes → `renderProjectVideo` → job `render:project` → voice each scene (cache reused) → render (scene cache reused) → MP4 on the project.

**Dropbox sync**: new and changed files are stored and extracted with the built-in chapter detection (no AI); meetings get the keyword analysis. AI extraction and AI meeting analysis run on an explicit action (or with `SYNC_AI_EXTRACT=true` / `SYNC_AI_MEETINGS=true`).

## Security

- Provider keys are read from the server environment only; `/api/config` and `/api/studio/config` expose provider names and models, never keys (covered by tests).
- Gemini and Google TTS keys are sent in headers (`x-goog-api-key`, `X-Goog-Api-Key`), never in URLs.
- All Studio endpoints and render functions require an administrator; generated media is served at `/api/media/<key>` to signed-in users only, with Range support.
- Uploads are type-checked by content (PNG/JPEG magic bytes for slide images; PDF/DOCX/TXT/MD for documents) and size-limited; object keys are SHA-256 hashes, so no path traversal is possible.
- Rendering uses a per-render temporary directory, removed afterwards even on failure or cancellation.
- Narration text and API keys are never logged.
