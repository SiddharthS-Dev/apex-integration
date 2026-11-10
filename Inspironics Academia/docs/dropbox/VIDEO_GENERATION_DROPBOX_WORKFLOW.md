# Video generation from Dropbox documents

## From document to video

1. **AI Studio → Video → New video → "A Dropbox file"** — pick a PDF, Word, PowerPoint or text file in
   the folder browser (`POST /api/studio/projects/from-dropbox { account, file_id }`).
2. The document's text is read as described in `AI_DROPBOX_PROCESSING_WORKFLOW.md` (metadata check,
   per-revision reuse, in-memory download).
3. The AI turns the text into scenes: title, layout, on-screen points and the narration script. Without
   an AI provider the text is split into scenes deterministically.
4. The project records where it came from: `source_type = dropbox`, `source_id` (file id),
   `source_revision`, `source_path`, `source_account`. Asking again for the same revision opens the
   existing project.
5. Edit scenes, then **Render**. Rendering runs as a job (`renderVideoProject`): slides are drawn as SVG
   → PNG, narration is synthesised (cached per text and voice), FFmpeg assembles the MP4, subtitles and a
   thumbnail. All working files live in a job-owned temp folder that is removed when the job ends.
6. The MP4, subtitles and thumbnail are stored in the APEX media store and attached to the project.

## Output destination

Set in AI Studio → Storage & Dropbox → "Where rendered videos go" (or `VIDEO_OUTPUT_DESTINATION`).

| Setting | Behaviour |
|---|---|
| APEX server (default) | Video stays in the media store, served from `/api/media/<key>` |
| Dropbox | After each render the MP4 is uploaded to `<folder>/<lessons\|meetings\|projects>/<title> (<id8>).mp4` in the Playbooks Dropbox, overwriting the previous render of the same record |
| Dropbox + keep local copy off | After a successful upload the local MP4 is deleted and the record points to `/api/outputs/<type>/<id>/video`, which streams from Dropbox (Range supported) |

Applies to lesson videos, meeting video briefings and studio projects alike.

**No duplicate uploads.** Before uploading, APEX computes the Dropbox content hash of the MP4 and
compares it with the file already at the target path; identical content is not uploaded again.

**Failures do not lose the video.** If the upload fails (e.g. the app lacks `files.content.write`), the
render is still marked completed, the video stays on APEX, and the error is stored on the record
(`rendered_output_error`, `briefing_output_error` or `output_error`). Retry with the
`publishRenderedVideo` function / `publish:output` job after fixing the cause.

**Permanent media is never cleaned up.** A video in use by a record is never removed by the storage
clean-up. Older renders that no record points to are removed only when the admin explicitly ticks
"Also remove generated media no record uses any more".

## Fields recorded

| Record | Dropbox output fields |
|---|---|
| Lesson | `rendered_dropbox_path`, `rendered_dropbox_id`, `rendered_dropbox_rev`, `rendered_output_error` |
| Meeting | `briefing_dropbox_path`, `briefing_dropbox_id`, `briefing_dropbox_rev`, `briefing_output_error` |
| VideoProject | `dropbox_path`, `dropbox_id`, `dropbox_rev`, `output_error` |

## Who can watch

`/api/outputs/project/:id/video` — admins. `/api/outputs/lesson/:id/video` — signed-in users (same rule
as `/api/media`). `/api/outputs/meeting/:id/video` — signed-in users for published meetings, admins
otherwise. The browser never receives a Dropbox link or token.
