import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { config } from '../../config.js';
import { getObject, objectKey, putObject } from '../../files/objectStore.js';
import { createTempDir, releaseTempDir } from '../../files/tempStore.js';
import { assertTempSpace } from '../../lib/tempEnv.js';
import { unavailable } from '../../lib/errors.js';
import { assertWithinLimits } from '../../usage/limits.js';
import { recordGeneration } from '../../usage/log.js';
import { mp3Frames } from '../mp3.js';
import { ffmpegAvailable, mediaDuration, runFfmpeg } from './ffmpeg.js';
import { TEMPLATE_VERSION, itemCount, renderSlideSvg } from './slides.js';
import { toSrt, toVtt } from './subtitleGenerator.js';

// The video rendering engine (VIDEO_PROVIDER=ffmpeg): turns a manifest of scenes — slide content,
// narration, subtitle cues and the audio each scene plays — into an MP4.
//
//   1. Validate the manifest and the audio.
//   2. For each scene: work out its visual states over time (items revealed as the narration reaches
//      them, the subtitle showing, the teacher's mouth moving), draw each state as an SVG slide,
//      rasterise it (resvg), and encode the scene with its slice of narration (H.264 + AAC, fade-in).
//   3. A scene whose content, narration, audio and template are unchanged is reused from the scene
//      cache instead of being encoded again — so editing scene 3 re-renders only scene 3.
//   4. Join the scenes (stream copy), write SRT/WebVTT subtitles and a thumbnail, store everything in
//      the object store, log the render (seconds of video, time taken) and clean up temporary files.
//
// manifest = {
//   eyebrow, presenter (bool, default true), burnCaptions (bool, default true),
//   scenes: [{ title, layout, points, …layout fields, playbook, source, text,
//              captions: [{ start, end, text }] (seconds from the scene start),
//              audio: { key, start?, end? } (MP3 object; a slice when start/end are given),
//              backgroundImage? (data URI) }]
// }

const require = createRequire(import.meta.url);
const MOUTH_STEP = 0.18; // seconds between mouth frames while speaking

function resvg() {
  try {
    return require('@resvg/resvg-js').Resvg;
  } catch {
    return null;
  }
}

export function renderingAvailable() {
  return config.video.provider === 'ffmpeg' && ffmpegAvailable() && !!resvg();
}

export function renderingUnavailableError() {
  if (config.video.provider !== 'ffmpeg') return unavailable(`Video rendering provider "${config.video.provider}" is not supported (use VIDEO_PROVIDER=ffmpeg)`);
  if (!ffmpegAvailable()) return unavailable('FFmpeg is not available on the API server (install ffmpeg-static or set FFMPEG_PATH)');
  return unavailable('The slide renderer (@resvg/resvg-js) is not installed on the API server');
}

const sha = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex');

/** Times at which a scene's picture changes, and the state between them. Exported for tests. */
export function sceneTimeline(scene, duration) {
  const n = itemCount(scene);
  const cuts = new Set([0, duration]);
  // Items build up over the first 70% of the scene, as in the player.
  for (let k = 1; k < n; k++) cuts.add(+((k / n) * duration * 0.7).toFixed(3));
  for (const c of scene.captions || []) {
    if (c.start > 0 && c.start < duration) cuts.add(+c.start.toFixed(3));
    if (c.end > 0 && c.end < duration) cuts.add(+c.end.toFixed(3));
  }
  const times = [...cuts].sort((a, b) => a - b);
  const segments = [];
  for (let i = 0; i < times.length - 1; i++) {
    const from = times[i];
    const to = times[i + 1];
    if (to - from < 0.01) continue;
    const mid = (from + to) / 2;
    const shown = n ? Math.max(1, Math.min(n, Math.floor((mid / Math.max(0.1, duration * 0.7)) * n) + 1)) : 0;
    const cue = (scene.captions || []).find((c) => mid >= c.start && mid < c.end) || null;
    segments.push({ from, to, shown, caption: cue?.text || null, speaking: !!cue });
  }
  return segments;
}

async function audioBytes(audio, cache) {
  if (!cache.has(audio.key)) {
    const bytes = await getObject(audio.key);
    if (!bytes) throw new Error('The narration audio for this video is missing from storage');
    cache.set(audio.key, bytes);
  }
  return cache.get(audio.key);
}

function concatLine(file) {
  return `file '${file.replace(/\\/g, '/').replace(/'/g, "'\\''")}'`;
}

async function renderScene({ scene, index, count, manifest, dir, audioCache, signal }) {
  const Resvg = resvg();
  // A silent card (intro, closing summary) has a fixed length and no narration.
  const silent = !scene.audio && Number(scene.silence) > 0;
  const bytes = silent ? null : await audioBytes(scene.audio, audioCache);
  const clipSeconds = silent ? Number(scene.silence) : mp3Frames(bytes).seconds || 0;
  const start = silent ? 0 : scene.audio.start ?? 0;
  const end = silent ? clipSeconds : scene.audio.end ?? clipSeconds;
  const duration = Math.max(0.5, end - start);
  const segments = sceneTimeline(scene, duration);
  const sdir = path.join(dir, `scene-${index}`);
  await fsp.mkdir(sdir, { recursive: true });

  // Each distinct visual state is drawn once (mouth open and closed); the concat list repeats them.
  const pngs = new Map();
  const png = async (seg, mouthOpen) => {
    const id = `${seg.shown}|${seg.caption || ''}|${mouthOpen ? 1 : 0}|${Math.round((seg.from / duration) * 20)}`;
    if (!pngs.has(id)) {
      const svg = renderSlideSvg(scene, index, count, {
        eyebrow: manifest.eyebrow, shown: seg.shown, caption: manifest.burnCaptions === false ? null : seg.caption,
        mouthOpen, presenter: manifest.presenter !== false, progress: seg.from / duration, backgroundImage: scene.backgroundImage,
      });
      const out = new Resvg(svg, { fitTo: { mode: 'width', value: config.video.width }, font: { loadSystemFonts: true } }).render().asPng();
      const file = path.join(sdir, `f${pngs.size}.png`);
      await fsp.writeFile(file, out);
      pngs.set(id, file);
    }
    return pngs.get(id);
  };

  const lines = [];
  let last = null;
  for (const seg of segments) {
    if (signal?.aborted) throw Object.assign(new Error('Rendering was cancelled'), { cancelled: true });
    if (!seg.speaking) {
      last = await png(seg, false);
      lines.push(concatLine(last), `duration ${(seg.to - seg.from).toFixed(3)}`);
      continue;
    }
    let t = seg.from;
    let open = true;
    while (t < seg.to - 0.001) {
      const d = Math.min(MOUTH_STEP, seg.to - t);
      last = await png(seg, open);
      lines.push(concatLine(last), `duration ${d.toFixed(3)}`);
      t += d;
      open = !open;
    }
  }
  if (last) lines.push(concatLine(last)); // the concat demuxer needs the last image repeated
  const list = path.join(sdir, 'frames.txt');
  await fsp.writeFile(list, lines.join('\n'));
  const mp3 = path.join(sdir, 'audio.mp3');
  if (!silent) await fsp.writeFile(mp3, bytes);
  const out = path.join(dir, `scene-${index}.mp4`);
  const { fps, width, height } = config.video;
  // Silent cards get a silent stereo track so every scene has the same streams for joining.
  const audioInput = silent
    ? ['-f', 'lavfi', '-t', duration.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo']
    : ['-ss', start.toFixed(3), '-t', duration.toFixed(3), '-i', mp3];
  await runFfmpeg([
    '-f', 'concat', '-safe', '0', '-i', list,
    ...audioInput,
    '-map', '0:v', '-map', '1:a',
    '-vf', `fps=${fps},scale=${width}:${height}:flags=lanczos,format=yuv420p,fade=t=in:st=0:d=0.35`,
    '-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'stillimage', '-crf', '22', '-r', String(fps),
    '-c:a', 'aac', '-b:a', '128k', '-ar', '44100', '-ac', '2',
    '-t', duration.toFixed(3), '-movflags', '+faststart', out,
  ], { signal });
  return { file: out, duration, firstFrame: pngs.values().next().value };
}

/** Validates a manifest before any work is done. */
export function validateManifest(manifest) {
  const problems = [];
  if (!manifest || !Array.isArray(manifest.scenes) || !manifest.scenes.length) problems.push('the video has no scenes');
  (manifest?.scenes || []).forEach((s, i) => {
    if (!s.audio?.key && !(Number(s.silence) > 0)) problems.push(`scene ${i + 1} has no narration audio`);
    if (s.audio && s.audio.start != null && s.audio.end != null && !(s.audio.end > s.audio.start)) problems.push(`scene ${i + 1} has an empty audio slice`);
  });
  return problems;
}

/**
 * Renders the manifest. Returns { video, thumbnail, srt, vtt (object URLs), seconds, scenes,
 * scenesRendered, scenesReused }. `ref` ({ type, id }) names what the video belongs to.
 */
export async function renderVideo(manifest, { ref = {}, onProgress = () => {}, signal, jobId } = {}) {
  if (!renderingAvailable()) throw renderingUnavailableError();
  // Fail clearly before starting when the temp folder is nearly full, instead of ENOSPC part-way through.
  assertTempSpace();
  const problems = validateManifest(manifest);
  if (problems.length) throw Object.assign(new Error(`Cannot render: ${problems.join('; ')}`), { status: 400 });
  await assertWithinLimits('render', { provider: 'ffmpeg' });

  const started = Date.now();
  // A unique temporary directory under TEMP_PROCESSING_DIR, owned by this render's job.
  const dir = await createTempDir(`render-${ref.type || 'video'}`, { jobId: jobId || null });
  const audioCache = new Map();
  const count = manifest.scenes.length;
  let rendered = 0;
  let reused = 0;
  try {
    const sceneFiles = [];
    const allCues = [];
    let offset = 0;
    let thumbnail = null;
    for (let i = 0; i < count; i++) {
      if (signal?.aborted) throw Object.assign(new Error('Rendering was cancelled'), { cancelled: true });
      const scene = manifest.scenes[i];
      onProgress(Math.round((i / count) * 90), `Scene ${i + 1} of ${count}`);
      // The scene cache key covers everything that changes the picture or the sound.
      const visual = { ...scene, audio: undefined, backgroundImage: scene.backgroundImage ? sha(scene.backgroundImage) : undefined };
      const key = objectKey('render-scene', sha([TEMPLATE_VERSION, config.video.width, config.video.height, config.video.fps,
        manifest.eyebrow || '', manifest.presenter !== false, manifest.burnCaptions !== false, i, count, visual, scene.audio]));
      const cached = config.video.sceneCache ? await getObject(key) : null;
      const file = path.join(dir, `scene-${i}.mp4`);
      let duration;
      if (cached) {
        await fsp.writeFile(file, cached);
        duration = !scene.audio ? Math.max(0.5, Number(scene.silence))
          : (scene.audio.end != null && scene.audio.start != null) ? scene.audio.end - scene.audio.start : await mediaDuration(file);
        reused++;
      } else {
        const r = await renderScene({ scene, index: i, count, manifest, dir, audioCache, signal });
        duration = r.duration;
        if (i === 0) thumbnail = await fsp.readFile(r.firstFrame);
        await putObject(key, await fsp.readFile(file), { source: 'render-scene', ref_type: ref.type, ref_id: ref.id });
        rendered++;
      }
      sceneFiles.push(file);
      for (const c of scene.captions || []) allCues.push({ start: offset + c.start, end: offset + Math.min(c.end, duration), text: c.text });
      offset += duration;
    }

    onProgress(92, 'Joining scenes');
    const list = path.join(dir, 'scenes.txt');
    await fsp.writeFile(list, sceneFiles.map(concatLine).join('\n'));
    const srt = toSrt(allCues);
    const vtt = toVtt(allCues);
    const srtFile = path.join(dir, 'subtitles.srt');
    await fsp.writeFile(srtFile, srt);
    const final = path.join(dir, 'video.mp4');
    // Subtitles burned into the picture are always readable; a soft track is added when they are not.
    const soft = manifest.burnCaptions === false;
    await runFfmpeg([
      '-f', 'concat', '-safe', '0', '-i', list, ...(soft ? ['-i', srtFile, '-map', '0', '-map', '1', '-c:s', 'mov_text'] : []),
      '-c:v', 'copy', '-c:a', 'copy', '-movflags', '+faststart', final,
    ], { signal });
    const seconds = await mediaDuration(final);
    if (!(seconds > 0)) throw new Error('The rendered video could not be read back');

    if (!thumbnail) {
      const thumbPng = path.join(dir, 'thumb.png');
      await runFfmpeg(['-ss', '0.5', '-i', final, '-frames:v', '1', thumbPng], { signal });
      thumbnail = await fsp.readFile(thumbPng);
    }

    onProgress(97, 'Saving');
    const videoBytes = await fsp.readFile(final);
    const id = sha([ref, sceneFiles.length, videoBytes.length, Date.now()]);
    const store = async (kind, bytes, contentType) => {
      const key = objectKey('media', 'render', ref.type || '', ref.id || '', kind, id);
      await putObject(key, bytes, { source: 'media', kind, content_type: contentType, ref_type: ref.type, ref_id: ref.id });
      return `/api/media/${key}`;
    };
    const result = {
      video: await store('video', videoBytes, 'video/mp4'),
      thumbnail: await store('thumbnail', thumbnail, 'image/png'),
      srt: await store('srt', Buffer.from(srt), 'application/x-subrip'),
      vtt: await store('vtt', Buffer.from(vtt), 'text/vtt'),
      seconds: +seconds.toFixed(2),
      scenes: count,
      scenesRendered: rendered,
      scenesReused: reused,
      bytes: videoBytes.length,
    };
    await recordGeneration({
      kind: 'render', provider: 'ffmpeg', model: TEMPLATE_VERSION, status: 'ok', seconds: result.seconds, cost_usd: 0,
      duration_ms: Date.now() - started, ref_type: ref.type, ref_id: ref.id, output_ref: result.video,
    });
    onProgress(100, 'Done');
    return result;
  } catch (err) {
    await recordGeneration({ kind: 'render', provider: 'ffmpeg', model: TEMPLATE_VERSION, status: err.cancelled ? 'cancelled' : 'error', error: err.message, duration_ms: Date.now() - started, ref_type: ref.type, ref_id: ref.id });
    throw err;
  } finally {
    await releaseTempDir(dir);
  }
}
