# Migration guide: from Base44 to the independent AI Studio

For whoever deploys or runs Inspironics Academia after the Base44 removal.

## What changes for users

- **Admins** get **AI Studio** (top navigation, or `/admin/ai-studio`) with five tabs: Content, Voice, Video, History, and Usage & budget.
- Lessons (content review → Media) and meeting briefings get **Render MP4**, with background progress and MP4/SRT/VTT downloads.
- **Generate Learning Package** now writes content only. Voice-over is a separate, explicit step. Bulk actions show what they will spend and ask for confirmation.
- **Dropbox sync** still imports and extracts new playbooks and transcripts, but without AI. Use Reprocess or Process for the AI version.
- Learners see no change except MP4 downloads where admins rendered them. Roles and access rules are unchanged.

## Steps to upgrade an environment

1. **Pull the code** and install dependencies at the repository root: `npm install`. This adds `ffmpeg-static` and `@resvg/resvg-js` to the Academia API and removes `@base44/sdk` from SlidesVault web.
2. **Update `apps/api/.env`** (never commit it) using `apps/api/.env.example` as the template:
   - Remove the `BASE44_*` lines. `AI_PROVIDER=base44` and `MEDIA_PROVIDER=base44` are no longer valid.
   - AI: `AI_ENABLED=true`, `AI_PROVIDER=anthropic`, `ANTHROPIC_API_KEY=…` (see AI_PROVIDER_SETUP.md). Optionally Gemini as `AI_FALLBACK_PROVIDER`.
   - Voice: `MEDIA_PROVIDER=google` with `GOOGLE_TTS_API_KEY` or `GOOGLE_APPLICATION_CREDENTIALS` (see GOOGLE_TTS_SETUP.md). Without it, keep `MEDIA_PROVIDER=none`.
   - Optional: limits (`AI_DAILY_LIMIT`, `AI_MONTHLY_BUDGET`, `TTS_MONTHLY_CHARACTER_LIMIT`, `VIDEO_MONTHLY_RENDER_LIMIT`) and prices (`TTS_PRICE_PER_MILLION_CHARS`, `AI_PRICE_*`).
3. **SlidesVault web:** remove `VITE_BASE44_APP_ID` / `VITE_BASE44_SERVER_URL` from its `.env` if present.
4. **Start the API.** The database migrations run automatically on startup and are additive only:
   - `006_generation_log` and `007_jobs` create two tables.
   - New columns are added to Lesson and Meeting, plus the new `VideoProject` table.
   - No data is changed or deleted.
5. **Check** the startup log line `api.listening` → `ai_config` and `media`. Then open AI Studio: the header chips show what is configured.
6. **Linux servers:** install fonts for the video renderer (e.g. `fonts-inter`, `fonts-dejavu`). FFmpeg comes from `ffmpeg-static`; set `FFMPEG_PATH` to use a system FFmpeg.
7. **Base44 dashboard (manual):** unpublish the old hosted app if nobody uses it, since it shares the credit pool.

There are no build-command changes: `npm run build` in `apps/web` as before; the API runs as before (`start.bat` / `apex/run.mjs`).

## Behaviour changes to know about

| Area | Before | Now | To get the old behaviour |
|---|---|---|---|
| Lesson content | Also voiced the lesson | Content only | `AUTO_GENERATE_AUDIO=true`, or `with_media: true` per call |
| Sync extraction | AI (contents, summaries) | Built-in detection | `SYNC_AI_EXTRACT=true` |
| Sync meeting analysis | AI | Keyword analysis | `SYNC_AI_MEETINGS=true` |
| Identical AI requests | Paid again | Cached | `ENABLE_CONTENT_CACHE=false`, or `fresh: true` per call |
| Same narration voiced again | Paid again | Cached | `ENABLE_AUDIO_CACHE=false` |
| AI video clips (`MEDIA_SCENE_CLIPS`) | Base44 GenerateVideo | Not available; MP4s are rendered from slides | — |
| Voice names | Base44 voice `storm` | Provider voice from `TTS_VOICE` (or the language default) | Choose a voice in AI Studio → Voice |
| Existing narration and videos | Recorded with Base44 | Still playable (stored locally) and renderable to MP4 | — |

## Rollback

The migration is additive in the database, so rolling back the code leaves the data usable: the new tables and columns are simply unused. Base44 itself cannot be restored by configuration, because the provider code was removed; it remains in git history.

## Related documents

- `BASE44_DEPENDENCY_AUDIT.md`: what was found
- `BASE44_REMOVAL_REPORT.md`: what was removed
- `AI_STUDIO_ARCHITECTURE.md`: how it fits together
- `AI_PROVIDER_SETUP.md`, `GOOGLE_TTS_SETUP.md`, `VIDEO_ENGINE_SETUP.md`: setup
- `GENERATION_COST_OPTIMIZATION.md`: cost controls
- `API_DOCUMENTATION.md`: endpoints
- `TESTING_REPORT.md`: what was tested
