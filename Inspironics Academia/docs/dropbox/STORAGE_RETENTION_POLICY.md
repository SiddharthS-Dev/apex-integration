# Storage retention policy

## Rules

1. **Original Dropbox files are never deleted, moved or modified by APEX.**
2. **Uploaded originals** (files uploaded straight to APEX, not from Dropbox) are the only copy and are
   never removed by clean-up — not even when their record is deleted (they are reported separately as
   "Uploaded originals of deleted records" for a human decision).
3. **Media in use is never removed**: narration, videos, subtitles, thumbnails and slide images that a
   lesson, meeting or video project points to.
4. Everything else on the APEX server is either a copy of something in Dropbox or something that can be
   regenerated, and has a bounded lifetime.

## Lifetimes (Academia)

| Category | Kept | Removed by |
|---|---|---|
| Copies of current Dropbox revisions (`dropbox-current`) | Not created under `DROPBOX_SOURCE_CACHE=temporary`; kept under `permanent` | Clean-up (temporary policy) |
| Copies of deleted records / old revisions (`dropbox-orphan`) | — | Clean-up |
| Extracted text of Dropbox documents (`extract-cache`) | 90 days (`EXTRACT_CACHE_RETENTION_DAYS`) | Clean-up |
| AI answer cache (`ai-cache`) | 90 days (`AI_CACHE_RETENTION_DAYS`) | Clean-up |
| Voice-over cache (`tts-cache`) | 180 days (`TTS_CACHE_RETENTION_DAYS`) | Clean-up |
| Scene render cache (`scene-cache`) | 30 days (`SCENE_CACHE_RETENTION_DAYS`) | Clean-up |
| Generated media no record uses (`*-superseded`, `studio-image-unused`) | Until an admin opts in | Clean-up with "include superseded media" |
| Partial writes (`.tmp`) | 1 day | Clean-up |
| Temporary processing folders | Until the job ends; abandoned ones after 6 h (`TEMP_MAX_AGE_HOURS`) | Job end; daily sweep |
| Database | Permanent | — |

`0` days means "keep". Age is measured from the object's last write.

## When clean-up runs

- **Daily, always** — abandoned temporary folders (not in use by this process or an active job, older
  than `TEMP_MAX_AGE_HOURS`).
- **Daily, if `STORAGE_AUTO_CLEANUP=true`** — all the safe categories above.
- **On demand** — AI Studio → Storage & Dropbox: *Preview clean-up* (dry run, lists categories, counts
  and sizes) → *Clean up…* (confirmation dialog) → result toast. API: `POST /api/studio/storage/cleanup`
  with `dry_run` (default **true**) and `include_superseded`.

Every run is logged (`storage.cleanup`, counts and bytes) and the storage report cache is invalidated.

## SlidesVault and Showcase

| App | Cache | TTL | Sweep |
|---|---|---|---|
| SlidesVault | Thumbnails and previews | `objectStore.ttlHours` (336 h) | Daily, now also when scheduled sync is off |
| Showcase | Thumbnails and previews | `OBJECT_CACHE_TTL_HOURS` (336 h, new) | Daily (new) |

Both remove a partial `.tmp` file when a write fails. Removed previews are fetched again from Dropbox on
the next request.
