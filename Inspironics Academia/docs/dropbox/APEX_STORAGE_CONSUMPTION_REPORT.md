# APEX storage consumption report

All figures were measured on the development server (`E:\apex`) on 2026-11-10 by walking the object
stores and reading each object's `.json` sidecar, and by `stat` on the database files. 1 MB = 1,048,576
bytes. Nothing here is estimated unless it is labelled **projected**.

## Totals by app

| App | Data folder | Of which object store |
|---|---|---|
| Academia | 2.8 GB | 2,728.1 MB in 493 objects |
| SlidesVault | 104 MB | 98 MB (thumbnails and previews) |
| Showcase | 39 MB | 34 MB (thumbnails and previews) |
| Temporary folders | 0 B | no render leftovers found |

SlidesVault and Showcase never store original Dropbox files; their caches are previews only.

## Academia object store by category

| Category | Files | Size | What it is | Removable? |
|---|---:|---:|---|---|
| `dropbox-orphan` | 192 | 1,317.5 MB | Copies of Dropbox files whose playbook was deleted, or of older revisions | Yes — originals are in Dropbox |
| `audio` | 259 | 1,097.2 MB | Lesson and briefing narration in use | No |
| `dropbox-current` | 34 | 302.5 MB | Copies of the current revision of tracked files | Yes, under the temporary policy — fetched again on demand |
| `scene-cache` | 4 | 5.3 MB | Rendered slide frames | After 30 days unused |
| `video` | 1 | 5.3 MB | Rendered lesson video in use | No |
| `thumbnail` | 1 | 0.2 MB | Video thumbnail in use | No |
| `subtitles` | 2 | < 0.1 MB | Subtitles in use | No |
| **Total** | **493** | **2,728.1 MB** | | |

Dropbox copies by type: PDF 1,439 MB, DOCX 181 MB (226 files, 1,620.0 MB).

Database: 59.7 MB including the WAL (chapters 9.5 MB, playbook version snapshots 10.2 MB, transcripts 0.7 MB).

## Where the growth came from

Every sync, extraction and first preview stored a full copy of the file per revision, and nothing ever
removed one. 59 % of the Academia object store (1,620 MB of 2,728 MB) was copies of files that are
already in Dropbox; 81 % of those copies (1,317.5 MB) were for records that no longer exist or revisions
that are no longer current.

## Before and after

| | Before | After the code change | After the clean-up (**projected**, from the dry run) |
|---|---|---|---|
| Object store | 2,728.1 MB / 493 | 2,728.1 MB / 493 (existing files untouched) | 1,108.1 MB / 267 |
| Dropbox copies | 1,620.0 MB / 226 | 1,620.0 MB / 226 | 0 |
| Bytes written per new synced file | Full file | 0 (metadata only) | 0 |
| Bytes written per preview | Full file (first view) | 0 (streamed) | 0 |
| Bytes written per extraction | Full file, kept forever | 0 (in memory) | 0 |
| Re-extraction of an unchanged revision | Download + parse | Skipped | Skipped |

The "after the code change" column is proven by the automated tests (`test/dropboxStorage.test.js`
counts downloads and stored copies). The clean-up itself has **not** been run on this server: it deletes
files and needs the administrator's approval. The dry run on the real data reports:

```
DRY RUN would remove 226 objects, 1620.0 MB (removed: 0)
   dropbox-orphan  192  1317.5 MB
   dropbox-current  34   302.5 MB
temporary folders: 0
```

Once approved (AI Studio → Storage & Dropbox → Preview clean-up → Clean up…), measure again with
"Measure again" and replace the projected column with the measured one.

## Dropbox side

`users/get_space_usage` for the connected team: 2,127,762 MB used of 15,728,640 MB allocated (≈ 2.0 TB of
15 TB). APEX writes nothing to Dropbox unless video output to Dropbox is switched on.
