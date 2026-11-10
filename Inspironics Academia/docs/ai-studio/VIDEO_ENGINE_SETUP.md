# Video engine setup

Narrated MP4 videos (lessons, meeting briefings, AI Studio projects) are rendered on the API server from templates, with no external video service:

- **Slides:** drawn as SVG in the same style as the in-app player: header, scene progress, layouts (points, steps, checklist, table, rule, definition, compare, timeline, decision, code), the animated teacher and burned-in subtitles.
- **Rasterising:** `@resvg/resvg-js` turns the SVG into PNG. This is native, fast and low-memory, with no browser.
- **Encoding:** FFmpeg encodes each scene as H.264 video with AAC audio. Scene items appear as the narration reaches them, the teacher's mouth moves while speaking, and each scene fades in. FFmpeg then joins the scenes.
- **Outputs:** MP4 with fast start, SRT and WebVTT subtitles, and a PNG thumbnail.

## Requirements

| Item | How it is provided |
|---|---|
| FFmpeg with libx264 and AAC | The `ffmpeg-static` npm package (installed with the API) ships a binary; FFmpeg 6.1 on this machine. Set `FFMPEG_PATH` to use a system FFmpeg instead. |
| `@resvg/resvg-js` | Installed with the API (prebuilt binaries for Windows, Linux and macOS). |
| Fonts | The renderer uses system fonts: Segoe UI on Windows. On Linux servers install fonts, e.g. `apt install fonts-inter fonts-dejavu`. |
| A voice provider | Needed to voice scenes that don't already have recorded narration (see GOOGLE_TTS_SETUP.md). Lessons with recorded narration render without one. |

Check: AI Studio header chip "Video: FFmpeg · 1280×720", and `/api/config` → `video_render_enabled: true`.

## Settings (`apps/api/.env`)

```
VIDEO_PROVIDER=ffmpeg
FFMPEG_PATH=                  # empty = bundled ffmpeg-static
VIDEO_WIDTH=1280
VIDEO_HEIGHT=720
VIDEO_FPS=25
ENABLE_SCENE_REGENERATION=true   # reuse unchanged scenes
MAX_CONCURRENT_JOBS=1            # renders at a time (raise only on a bigger server)
VIDEO_MONTHLY_RENDER_LIMIT=      # optional, minutes of video per month
```

## How a render works

1. A render request (`renderLessonVideo`, `renderMeetingVideo`, `renderProjectVideo`, or AI Studio's Render button) creates a **background job** and returns at once. A second request for the same video returns the running job.
2. The job builds a manifest: each scene's slide, narration text, subtitle cues and audio (a slice of the recorded track, or a voice clip per scene).
3. For each scene, the engine checks the **scene cache**. The key is the template version, resolution, frame rate, scene content, narration and audio. If the scene is cached it is reused; otherwise its frames are drawn and encoded.
4. The scenes are joined with stream copy, the subtitles and thumbnail are written, and everything is stored in the object store and served at `/api/media/<key>` (Range requests supported).
5. The job records progress ("Scene 3 of 8"), the result and any error. It can be cancelled (FFmpeg is stopped) or retried. Jobs interrupted by a restart run again.
6. The render is logged (seconds of video, time taken) for the usage dashboard.

**Scene-level re-rendering:** after editing scene 3 of a project, only scene 3 is voiced again (if its narration changed) and re-encoded. AI Studio's "Re-render this scene" forces one scene to be redrawn.

## Performance on this machine

Measured on this laptop (8 logical CPUs, 7.8 GB RAM): a real 4-scene, 3 min 5 s lesson rendered in 79 seconds (measured; 5.6 MB, 1280×720, 25 fps), i.e. roughly 0.43 s of rendering per second of video. Still slides encode cheaply (`-tune stillimage`). Keep `MAX_CONCURRENT_JOBS=1` here.

## Optional extensions (not enabled)

- **Remotion** (React-based animated templates) is not installed. It requires a commercial licence for company use above its free-tier thresholds; review the current Remotion licence before adding it. The renderer is self-contained, so another renderer can be added alongside it.
- **Generative AI video clips** are not offered: `generateVideo()` reports that videos are rendered from slides. A future provider adapter could add clips as optional scene backgrounds.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "FFmpeg is not available" | `ffmpeg-static` failed to download its binary during install. Reinstall it, or set `FFMPEG_PATH`. |
| "This lesson has no narrated video yet" | Generate the lesson's media first. |
| "no recorded voice-over and no voice provider" | Configure a voice provider, or regenerate the briefing with one. |
| Job "failed" with a limit message | `VIDEO_MONTHLY_RENDER_LIMIT` is reached. |
| Text looks different from the app | Install the same fonts on the server, or accept the fallback font. |
