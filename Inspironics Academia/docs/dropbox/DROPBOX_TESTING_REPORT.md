# Dropbox integration testing report

Date: 2026-11-10. All automated tests use a **fake Dropbox** behind `fetch` (no real Dropbox calls, no
production files) and no paid AI or voice providers (AI disabled in the test environment).

## Results

| Suite | Command | Result |
|---|---|---|
| Academia API (all) | `npm test` in `apps/api` | **187 / 187 pass** (178 before this work, +9) |
| Academia web | `npm run build` | Builds |
| SlidesVault API | `npm test` in `slide vault/apps/api` | **203 / 203 pass** (+2) |
| Showcase API | `npm test` in `inspironics-innovation-showcase/apps/api` | **49 / 49 pass** (+1) |

## New tests — `apps/api/test/dropboxStorage.test.js`

The fake Dropbox counts every download and upload, and the tests count `source: dropbox` objects on disk.

| # | Test | Proves |
|---|---|---|
| 1 | Sync with extraction off | 0 downloads, 0 stored copies; record created from metadata |
| 2 | Extraction | 1 download into memory, 0 stored copies (`DROPBOX_SOURCE_CACHE=temporary`); `extracted_revision` and version `source_revision` recorded |
| 3 | Same revision again / forced / new revision | Skipped with no download; `force` re-extracts; a changed file is detected from metadata and extracted once; dashboard counts processed = 3, repeats avoided = 1; space usage reported |
| 4 | Preview | Full and `Range: bytes=0-9` (206, 10 bytes) streamed from Dropbox; nothing stored |
| 5 | Browse | Folders and files with size, revision, date, processable flag, tracked playbook; no downloads; `..` rejected; unknown account rejected |
| 6 | Video project from a Dropbox PPTX | Scenes contain slide text; same revision → existing project, no download; changed file → new project, one download; PNG → 415 mentioning OCR; deleted file → 404 |
| 7 | Storage report and clean-up | Orphan copy, unreferenced upload and narration in use classified correctly; dry run deletes nothing; real run removes the orphan and an abandoned temp dir (from a "crashed" process), keeps the upload, the narration and a temp dir in use |
| 8 | Video output to Dropbox | Destination APEX → no upload; Dropbox → fixed path `/APEX Generated Videos/projects/Onboarding (<id8>).mp4`; identical bytes not uploaded twice; missing `files.content.write` → 403 naming the scope; retry via the `publishRenderedVideo` job succeeds; `keep_local=false` removes the local MP4 and the video streams from Dropbox with Range; output folder `/` refused |
| 9 | Token exposure | `/dropbox/status`, `/studio/dropbox/accounts`, `/studio/storage`, `/studio/storage/overview`, browse — none contain the refresh or access token; the settings table never holds the refresh token in clear text |

## New tests — SlidesVault and Showcase

| App | Test | Proves |
|---|---|---|
| SlidesVault | `tests/unit/storage.test.js` — failed `putBuffer` | No `.tmp` left behind |
| SlidesVault | same file — scheduler with sync disabled | The daily retention timer is still scheduled, once |
| Showcase | `test/units.test.mjs` — object cache | TTL sweep removes only the stale revision (and its metadata); a failed `put` leaves no `.tmp` |

## Regression coverage

The existing suites already cover Dropbox OAuth (state, callback, multi-account), sync (add, update,
move, delete, team root namespace), meeting transcripts, category sources, the content pipeline, media,
video rendering and AI Studio; all pass.

## Live smoke test (read-only, real data)

Run against the development database and the connected Dropbox, with no deletes and no uploads:

```
object store 493 2728.1 MB | db 59.7 MB | temp 0 0.0 MB
DRY RUN would remove 226 1620.0 MB removed: 0 | temp dirs 0
accounts playbooks, meetings, source:learning
browse root: 9 folders, 0 files, 493 ms (metadata only)
```

The API on port 4177 was restarted on the new code and answers `/api/health`.

## Not tested

- The real clean-up on the development data (needs approval — it deletes 1.6 GB of copies).
- A real upload to Dropbox (the connected apps lack `files.content.write`, and uploading is a write
  to the team's Dropbox).
- Real AI generation from a Dropbox document (no AI key configured; would incur cost).
- Browser UI flows (the build succeeds; the new tab and pickers were not exercised in a browser).
