# AI Studio API

All endpoints are under the Academia API (`/api`, or `/academia/api` through the Apex gateway), use the session cookie, and require an **administrator** unless stated. Errors are `{ "error": "message" }` with a meaningful status: 400 invalid request, 403 not an admin, 404 not found, 409 conflict, 429 usage limit or rate limit, 502 provider or output problem, 503 feature not configured.

## Configuration

`GET /api/config` (public) adds `video_render_enabled` to the existing flags.

`GET /api/studio/config`:
```json
{
  "ai": { "provider": "gemini", "enabled": true, "ready": true, "model": "gemini-3.8-flash", "fallback": null, "fallbackReady": null,
          "providers": [{ "name": "gemini", "model": "gemini-3.8-flash" }] },
  "voice": { "enabled": true, "default_provider": "google", "providers": ["google"], "defaults": { "provider": "google", "voice": "", "language": "en-IN", "rate": 1, "pitch": 0 } },
  "video": { "enabled": true, "provider": "ffmpeg", "width": 1280, "height": 720 },
  "content_types": [{ "key": "lesson_summary", "label": "Lesson summary", "format": "markdown" }],
  "auto_generate_audio": false
}
```

## Content generation

`POST /api/studio/generate`
```json
{ "content_type": "assessment", "provider": "gemini", "language": "English", "length": "medium", "tone": "professional",
  "instructions": "Focus on incident response", "source_text": "…", "source": { "type": "lesson", "id": "…" }, "fresh": false }
```
- `content_type`: `lesson_content`, `course_description`, `learning_objectives`, `lesson_summary`, `assessment`, `question_bank`, `meeting_summary`, `playbook_extraction`, `playbook_structure` or `custom` (custom requires `instructions`).
- Source: `source_text`, or `source` = lesson (its playbook chapter), meeting (notes and action items) or playbook (its chapters). Without either, the request has no source.
- `provider`: optional, must be a configured provider (`gemini` or `ollama`; there is no Anthropic adapter). `fresh: true` bypasses the content cache.
- Returns `{ content_type, format: "markdown" | "json", output, provider, ms }`. JSON types return `{ questions: [...] }`, `{ chapters: [...] }` or `{ modules: [...] }`.

## Voice

- `GET /api/studio/voices?provider=google&language=en-IN` returns `[{ id, name, languages, gender }]`.
- `POST /api/studio/voice` with `{ text (≤ 5,000 chars), provider?, language?, voice?, rate?, pitch? }` returns `{ url, cached, characters, seconds }`. The URL is `/api/media/<key>`, playable by any signed-in user.

## Video projects

| Method and path | Body / result |
|---|---|
| `GET /api/studio/projects` | List with `scene_count`. |
| `POST /api/studio/projects` | `{ source_type: blank \| lesson \| meeting \| text, source_id?, text?, title?, eyebrow? }`, returns 201 and the project. |
| `POST /api/studio/projects/from-document` | Raw file body, `X-File-Name` header (PDF, DOCX, TXT, MD). Returns 201 and the project; with AI on, the AI turns it into scenes. |
| `GET /api/studio/projects/:id` | Project with `scenes` as an array. |
| `PATCH /api/studio/projects/:id` | `{ title?, eyebrow?, voice_provider?, voice?, language?, rate?, presenter?, burn_captions?, scenes? }`. Scenes are cleaned and capped at 30. |
| `DELETE /api/studio/projects/:id` | `{ ok: true }` |
| `POST /api/studio/projects/:id/scenes/:sceneId/image` | Raw PNG/JPEG ≤ 5 MB, used as that scene's background. |
| `DELETE /api/studio/projects/:id/scenes/:sceneId/image` | Removes it. |
| `GET /api/studio/projects/:id/scenes/:sceneId/preview.png` | The slide as the renderer draws it. |
| `POST /api/studio/projects/:id/render` | 202 `{ ok, job }` |
| `POST /api/studio/projects/:id/scenes/:sceneId/rerender` | Forces that scene to re-render; 202 `{ ok, job }`. |

Scene shape: `{ id, rev, title, layout (points|steps|checklist|rule|definition|compare|decision|table|timeline|code), points[], quote?, term?, definition?, table?, columns?, events?, branches?, code?, narration, image_key? }`.

## Render functions

`POST /api/functions/<name>`:

| Function | Payload | Notes |
|---|---|---|
| `renderLessonVideo` | `{ lesson_id }` | Needs the lesson's generated media (slides + narration). Saves `rendered_*` fields on the lesson. |
| `renderMeetingVideo` | `{ meeting_id }` | Needs a generated briefing. A browser-voiced briefing is voiced scene by scene (needs a voice provider). Saves `briefing_video_*` fields. |
| `renderProjectVideo` | `{ project_id }` | Same as the project render endpoint. |

Each returns `{ ok: true, job }` immediately. An active job for the same record is returned instead of a new one (`job.deduplicated: true`).

Existing functions keep their contracts, with these additions:
- `generateLessonContent` accepts `with_media: true` to voice the lesson straight after (otherwise only when `AUTO_GENERATE_AUDIO=true`).
- Any function accepts `fresh: true` to bypass the AI content cache.
- `processPlaybookExtract` and `processMeeting` accept `ai: false` to run without AI (what Dropbox sync uses by default).

## Jobs

- `GET /api/studio/jobs?ref_type=lesson|meeting|project&ref_id=…&status=…&limit=…` returns the newest first.
- `GET /api/studio/jobs/:id` returns `{ id, type, status: queued|processing|completed|failed|cancelled, progress (0–100), message, error, result, attempts, max_attempts, ref_type, ref_id, created_at, started_at, finished_at, cancel_requested }`.
- `POST /api/studio/jobs/:id/cancel`: a queued job is cancelled; a running render is stopped. Returns 409 if already finished.
- `POST /api/studio/jobs/:id/retry`: requeues a failed or cancelled job (or returns the active duplicate).

A completed render's `result` is `{ video, thumbnail, srt, vtt (all /api/media/… URLs), seconds, scenes, scenesRendered, scenesReused, bytes }`.

## History, usage and limits

- `GET /api/studio/history?kind=ai|tts|render&limit=…&offset=…` returns `generation_log` rows: `id, created_at, kind, operation, provider, model, status, input_tokens, output_tokens, characters, seconds, cost_usd, duration_ms, error, ref_type, ref_id, user_id, output_ref`.
- `GET /api/studio/usage` returns `{ today, month (per kind: requests, cached, failed, input_tokens, output_tokens, characters, seconds, cost_usd, unpriced), providers, limits, estimated_spend_usd, budget_remaining_usd, tts_chars_remaining, render_minutes_remaining, ai_requests_left_today, pricing_note }`.
- `PUT /api/studio/limits` takes `{ aiDailyRequests?, aiMonthlyBudgetUsd?, ttsMonthlyChars?, videoMonthlyMinutes? }`; `null` or empty means no limit, and negative values return 400.

## Media

`GET /api/media/:key` (signed-in users) serves stored audio, video, subtitles and thumbnails with their content type and `Range` support for seeking.
