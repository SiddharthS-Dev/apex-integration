# AI processing of Dropbox documents

Documents are processed **on demand**: when an admin asks for it, or on sync when
`AUTO_EXTRACT_ON_SYNC=true`. Browsing and syncing never download file contents.

## Paths into processing

| Path | Trigger | Result |
|---|---|---|
| Playbook extraction | Sync (auto) or Admin → Playbook → Extract | Chapters, then lessons / assessments via the content pipeline |
| Meeting transcript | Sync of the meetings folder or Process | Summary, decisions, action items, risks |
| AI Studio → Content → Source "A Dropbox file" | Generate | Any studio content type (summary, objectives, question bank, …) from the file |
| AI Studio → Video → New video → "A Dropbox file" | Create | A video project (scenes + narration script) |

## Steps for a Dropbox document (AI Studio)

1. **Browse** — `GET /api/studio/dropbox/browse?account=&path=` lists sub-folders and files with type,
   size, modified date, revision, whether the format is supported and whether APEX already tracks the
   file as a playbook or meeting. Metadata only.
2. **Select** — the browser sends the Dropbox **file id** (never a name or path).
3. **Check** — `files/get_metadata`: the file must still exist (else 404), be a supported format
   (PDF, DOCX, PPTX, TXT, MD, CSV — images, audio, video and legacy `.doc/.ppt/.xls` get a 415 that says
   why) and be at most `MAX_EXTRACT_MB`.
4. **Reuse** — text already extracted for this file id **and revision** is read from the extract cache
   (logged as `process / reused`). For video projects, an existing project made from the same revision
   is returned instead of creating a new one (`reused: true`). `force: true` bypasses both.
5. **Download** — into memory only; nothing is written to disk.
6. **Extract** — PDF text, DOCX paragraphs, PPTX slides in order plus speaker notes, plain text / CSV.
7. **Cache** — the extracted text (not the file) is cached per revision for `EXTRACT_CACHE_RETENTION_DAYS`.
8. **Generate** — the text goes to the configured AI provider through the normal AI router, with its
   content cache, cost tracking and limits (see `docs/ai-studio/`). The request is tagged
   `ref_type = dropbox, ref_id = <file id>` in the generation log.

## Duplicate-processing prevention

| Situation | What happens |
|---|---|
| Same playbook revision extracted again | Skipped before the lock; `{ skipped: true }`; generation log `process / reused` |
| Same revision, `force: true` | Extracted again |
| New revision in Dropbox | Detected from metadata on sync; extracted once |
| Same Dropbox file → video project again | Existing project returned |
| Same AI prompt + source text | Answered from the AI content cache at no cost |
| Same narration text + voice | Served from the TTS cache |

The dashboard (AI Studio → Storage & Dropbox → Processing) shows documents processed, repeats avoided,
and AI requests / estimated cost for Dropbox documents — all read from the generation log.

## Failure handling

| Failure | Behaviour |
|---|---|
| File deleted or moved out of reach | 404 with a clear message; nothing changes |
| Unsupported format | 415 naming the reason (no OCR / no transcription configured / legacy format) |
| Too large | 413 before downloading |
| Dropbox 429 / 5xx | Retried with backoff (honours `Retry-After`) |
| Token expired | New access token minted from the refresh token, request retried once |
| Missing permission | 403 naming the scope to enable |
| AI not configured | Studio says so; extraction still works (chapters need no AI) |
| AI limit reached | Blocked with the limit's message; nothing partial is saved |

## Cost controls

Processing a Dropbox document costs nothing by itself (Dropbox API calls are free). AI cost is incurred
only when content is generated, and every request goes through the daily request limit and monthly
budget set in AI Studio → Usage & budget.
