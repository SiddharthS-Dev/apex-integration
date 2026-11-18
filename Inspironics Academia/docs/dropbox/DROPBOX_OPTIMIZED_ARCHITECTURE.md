# Optimised architecture: Dropbox as the primary store

**Principle:** Dropbox holds the source documents. APEX holds metadata, the results of processing
(chapters, lessons, summaries, narration, videos) and short-lived working files. A document's bytes are
read from Dropbox when they are needed and not kept.

## Responsibilities

| Concern | Lives in | Notes |
|---|---|---|
| Source documents (PDF, DOCX, PPTX, transcripts) | **Dropbox** | Never modified or deleted by APEX |
| File identity | Database | Dropbox file id + `rev` + `content_hash`; never the file name |
| Folder structure, names, sizes, dates | Database (refreshed each sync) | Display only |
| Extracted text | Database (chapters) / `extract-cache` (AI Studio) | Per revision |
| Generated content | Database | Lessons, assessments, summaries |
| Generated media | APEX media store, optionally Dropbox | Narration, MP4, subtitles, thumbnails |
| Working files | `TEMP_PROCESSING_DIR` | Per job, removed when the job ends |

## Components (Academia API)

| Module | Role |
|---|---|
| `dropbox/client.js` | Dropbox HTTP calls: list, metadata, streamed download (Range), space usage, upload (single or session), Dropbox content hash |
| `dropbox/connection.js` | Encrypted refresh tokens, in-memory access tokens, several connections |
| `dropbox/processing.js` | Browse a folder (metadata), read a document's text at its current revision (cached per revision) |
| `dropbox/output.js` | Output settings; upload a rendered video, skip identical content, optional local removal |
| `files/playbookSource.js` | `loadPlaybookBytes` (memory, copy only under the permanent policy), `streamPlaybookSource` (preview) |
| `files/tempStore.js` | Temp dirs with an owner file; abandoned-dir sweep |
| `storage/storage.js` | What is stored and why (categories), safe clean-up plan, daily maintenance |
| `pipeline/processPlaybookExtract.js` | Skips an already-extracted revision; records `extracted_revision` |
| `sync/pipeline.js` | Metadata-only unless `AUTO_EXTRACT_ON_SYNC=true` |
| `studio/routes.js` | `/studio/dropbox/*`, `/studio/projects/from-dropbox`, `/studio/storage*` |
| `files/routes.js` | `/api/outputs/:type/:id/video` — streams a Dropbox-stored video |

## Policies (environment, see `DROPBOX_API_CONFIGURATION.md`)

- `DROPBOX_SOURCE_CACHE=temporary` (default) | `permanent`.
- `AUTO_EXTRACT_ON_SYNC` decides whether sync also processes new revisions.
- Retention days per cache, `STORAGE_AUTO_CLEANUP`, `TEMP_MAX_AGE_HOURS`.
- `VIDEO_OUTPUT_DESTINATION`, `DROPBOX_OUTPUT_FOLDER`, `VIDEO_KEEP_LOCAL_COPY` (admin-overridable in AI Studio).

## Trade-offs

- **Latency.** A preview or extraction now waits for Dropbox. Streaming starts immediately and Range
  requests let PDF viewers fetch only what they show; extraction of a 50 MB PDF adds the download time
  (seconds on a normal connection). Set `DROPBOX_SOURCE_CACHE=permanent` where Dropbox is slow or metered.
- **Dropbox availability.** If Dropbox is unreachable, previews and new extractions fail with a clear
  error; everything already generated keeps working because it does not depend on the source file.
- **Memory.** Extraction holds one file in memory, bounded by `MAX_EXTRACT_MB` (500 MB). With
  `SYNC_CONCURRENCY=4` the worst case is four large files at once; lower the concurrency on small servers.

## SlidesVault and Showcase

Both already followed the principle for originals (streamed, never stored). Their preview caches are
now bounded: SlidesVault's 14-day TTL sweep runs even with scheduled sync off, Showcase gained a TTL
(`OBJECT_CACHE_TTL_HOURS`, default 336) and both clean up partial writes.
