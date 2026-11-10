import crypto from 'node:crypto';
import { getObject } from '../files/objectStore.js';
import { badRequest, notFound, unavailable } from '../lib/errors.js';
import { enqueueJob, registerJobHandler } from '../jobs/queue.js';
import { mediaEnabled, mediaUnavailableError, synthesize, voiceSettings } from '../media/index.js';
import { mp3Frames } from '../media/mp3.js';
import { renderVideo, renderingAvailable, renderingUnavailableError } from '../media/video/renderer.js';
import { entities } from '../repo/entities.js';
import { dropboxVideoUrl, publishVideo } from '../dropbox/output.js';
import { buildCaptions } from './generateLessonMedia.js';
import { loadLessonSource } from './source.js';

// Rendered MP4 videos, made in the background (jobs) from what a lesson, a meeting briefing or a
// Studio video project already holds:
//   renderLessonVideo   { lesson_id }  — the lesson's slides + its recorded narration
//   renderMeetingVideo  { meeting_id } — the briefing's slides + its narration (voiced now, scene by
//                                        scene, when the briefing was read by the browser)
//   renderProjectVideo  { project_id } — a Studio project: every scene voiced (cached per scene), then rendered
// Each returns { job } at once; the job's status/progress is at GET /api/jobs/:id. Rendering reuses
// unchanged scenes, so re-rendering after editing one scene only renders that scene again.

const LAYOUT_FIELDS = ['quote', 'term', 'definition', 'columns', 'question', 'branches', 'table', 'events', 'code', 'language'];
const mediaKey = (url) => {
  const m = /\/api\/media\/([a-f0-9]{64})$/.exec(String(url || ''));
  return m ? m[1] : null;
};
const parseJson = (raw) => {
  if (Array.isArray(raw)) return raw;
  try { const v = JSON.parse(raw || '[]'); return Array.isArray(v) ? v : []; } catch { return []; }
};

/** A stored scene list ({ start, end, title, …, text, captions }) → manifest scenes slicing one audio track. */
export function scenesOnTrack(stored, audioKey) {
  return stored
    .filter((s) => Number.isFinite(+s.start) && Number.isFinite(+s.end) && +s.end > +s.start)
    .map((s) => {
      const start = +s.start;
      const end = +s.end;
      return {
        ...slide(s),
        text: s.text || '',
        captions: (s.captions || []).map((c) => ({ start: Math.max(0, +c.start - start), end: Math.min(end - start, +c.end - start), text: String(c.text || '') })).filter((c) => c.end > c.start && c.text),
        audio: { key: audioKey, start, end },
      };
    });
}

function slide(s) {
  const out = {
    title: String(s.title || ''),
    layout: s.layout || 'points',
    points: (Array.isArray(s.points) ? s.points : []).map(String).filter(Boolean),
    playbook: s.playbook || '',
    source: s.source || '',
  };
  for (const f of LAYOUT_FIELDS) if (s[f] !== undefined && s[f] !== null && s[f] !== '') out[f] = s[f];
  if (!out.points.length) out.points = [out.title || ' '];
  return out;
}

/** Voices each scene's narration on its own (cached by text + voice), so a changed scene is the only one paid for. */
async function voicedScenes(scenes, voice, onProgress) {
  if (!mediaEnabled() && !voice?.provider) throw mediaUnavailableError();
  const out = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const text = String(s.narration ?? s.text ?? '').trim();
    if (!text) throw badRequest(`Scene ${i + 1} has no narration to voice`);
    onProgress?.(Math.round((i / scenes.length) * 30), `Voicing scene ${i + 1} of ${scenes.length}`);
    const audio = await synthesize(text, voice || {});
    const seconds = mp3Frames(audio.bytes).seconds;
    out.push({ ...slide(s), text, captions: buildCaptions(text, 0, seconds), audio: { key: audio.key }, ...(s.rev ? { rev: s.rev } : {}), ...(s.backgroundImage ? { backgroundImage: s.backgroundImage } : {}) });
  }
  return out;
}

const scale = (onProgress, from, to) => (p, m) => onProgress(from + ((to - from) * p) / 100, m);

// ---- lesson ------------------------------------------------------------------------------------

async function lessonManifest(lessonId) {
  const lesson = await entities.Lesson.get(lessonId);
  if (!lesson) throw notFound('Lesson not found');
  const stored = parseJson(lesson.video_scenes);
  const audioKey = mediaKey(lesson.audio_url);
  if (!stored.length || !audioKey) throw badRequest('This lesson has no narrated video yet — generate its media first, then render the MP4.');
  const { course, mod } = await loadLessonSource(lesson);
  const scenes = scenesOnTrack(stored, audioKey);
  return { lesson, manifest: { eyebrow: [course?.title, mod?.title].filter(Boolean).join(' · '), presenter: true, scenes: [lessonIntro(lesson, mod, course), ...scenes, lessonOutro(lesson)] } };
}

// Opening and closing cards of a lesson video: silent, fixed length, so the narration is unchanged.
export function lessonIntro(lesson, mod, course) {
  return { layout: 'cover', kicker: 'Lesson', title: lesson.video_title || lesson.title, subtitle: [mod?.title, course?.title], silence: 4 };
}

export function lessonOutro(lesson) {
  const points = String(lesson.key_points || '').split('\n').map((l) => l.replace(/^\s*[-*•]\s*/, '').trim()).filter(Boolean).slice(0, 4);
  return points.length
    ? { layout: 'checklist', kicker: 'Recap', title: 'Key takeaways', points, silence: Math.min(12, 3 + points.length * 2) }
    : { layout: 'cover', kicker: 'Recap', title: 'Thank you for watching', subtitle: [lesson.title], silence: 3 };
}

registerJobHandler('render:lesson', async ({ lesson_id: lessonId }, { progress, signal, jobId }) => {
  const { lesson, manifest } = await lessonManifest(lessonId);
  const out = await renderVideo(manifest, { ref: { type: 'lesson', id: lessonId }, onProgress: progress, signal, jobId });
  await entities.Lesson.update(lesson.id, {
    rendered_video_url: out.video, rendered_thumbnail_url: out.thumbnail, rendered_subtitles_url: out.vtt, rendered_srt_url: out.srt,
    rendered_video_seconds: out.seconds, rendered_video_rendered_at: new Date().toISOString(),
    rendered_scenes_signature: crypto.createHash('sha256').update(`${lesson.audio_url}|${lesson.video_scenes}`).digest('hex'),
  });
  out.output = await publishAfterRender('lesson', lesson.id, lesson.video_title || lesson.title, out, 'rendered_');
  return out;
});

// ---- meeting briefing --------------------------------------------------------------------------

registerJobHandler('render:meeting', async ({ meeting_id: meetingId }, { progress, signal, jobId }) => {
  const meeting = await entities.Meeting.get(meetingId);
  if (!meeting) throw notFound('Meeting not found');
  const stored = parseJson(meeting.briefing_scenes);
  if (!stored.length) throw badRequest('This meeting has no video briefing yet — generate the briefing first.');
  const audioKey = mediaKey(meeting.briefing_audio_url);
  const eyebrow = ['Meeting briefing', meeting.team ? `${meeting.team} team` : ''].filter(Boolean).join(' · ');
  const scenes = audioKey
    ? scenesOnTrack(stored, audioKey)
    : await voicedScenes(stored.map((s) => ({ ...s, narration: s.text })), {}, progress);
  const out = await renderVideo({ eyebrow, presenter: true, scenes }, { ref: { type: 'meeting', id: meetingId }, onProgress: audioKey ? progress : scale(progress, 30, 100), signal, jobId });
  await entities.Meeting.update(meetingId, {
    briefing_video_url: out.video, briefing_thumbnail_url: out.thumbnail, briefing_subtitles_url: out.vtt, briefing_srt_url: out.srt,
    briefing_video_seconds: out.seconds, briefing_video_rendered_at: new Date().toISOString(),
  });
  out.output = await publishAfterRender('meeting', meetingId, `${meeting.title} briefing`, out, 'briefing_');
  return out;
});

// ---- Studio project ----------------------------------------------------------------------------

async function imageDataUri(key) {
  if (!key) return undefined;
  const bytes = await getObject(key);
  if (!bytes) return undefined;
  const type = bytes[0] === 0x89 ? 'image/png' : 'image/jpeg';
  return `data:${type};base64,${bytes.toString('base64')}`;
}

registerJobHandler('render:project', async ({ project_id: projectId }, { progress, signal, jobId }) => {
  const project = await entities.VideoProject.get(projectId);
  if (!project) throw notFound('Video project not found');
  await entities.VideoProject.update(projectId, { status: 'rendering', error: '' });
  try {
    const raw = parseJson(project.scenes);
    if (!raw.length) throw badRequest('Add at least one scene before rendering');
    const withImages = await Promise.all(raw.map(async (s) => ({ ...s, backgroundImage: await imageDataUri(s.image_key) })));
    const voice = voiceSettings({ provider: project.voice_provider || undefined, voice: project.voice || undefined, language: project.language || undefined, rate: project.rate ?? undefined });
    const scenes = await voicedScenes(withImages, voice, progress);
    const out = await renderVideo(
      { eyebrow: project.eyebrow || 'Inspironics Academia', presenter: project.presenter !== false, burnCaptions: project.burn_captions !== false, scenes },
      { ref: { type: 'project', id: projectId }, onProgress: scale(progress, 30, 100), signal, jobId },
    );
    await entities.VideoProject.update(projectId, {
      status: 'ready', video_url: out.video, thumbnail_url: out.thumbnail, subtitles_url: out.vtt, srt_url: out.srt, video_seconds: out.seconds,
      rendered_at: new Date().toISOString(), scenes_rendered: out.scenesRendered, scenes_reused: out.scenesReused, error: '',
    });
    out.output = await publishAfterRender('project', projectId, project.title, out, '');
    return out;
  } catch (err) {
    await entities.VideoProject.update(projectId, { status: err?.cancelled ? 'draft' : 'failed', error: err?.cancelled ? '' : String(err.message || err).slice(0, 500) }).catch(() => {});
    throw err;
  }
});


// ---- output destination ------------------------------------------------------------------------

const ENTITY = { lesson: 'Lesson', meeting: 'Meeting', project: 'VideoProject' };
const URL_FIELD = { lesson: 'rendered_video_url', meeting: 'briefing_video_url', project: 'video_url' };

/**
 * Uploads the rendered video to Dropbox when that is the configured destination and records where it
 * went. An upload failure does not fail the render: the video stays in APEX, the error is recorded
 * on the record, and the upload can be retried (publish job).
 */
async function publishAfterRender(refType, refId, title, out, prefix) {
  const entity = entities[ENTITY[refType]];
  try {
    const published = await publishVideo({ refType, refId, title, videoUrl: out.video });
    if (!published) return null;
    await entity.update(refId, {
      [`${prefix}dropbox_path`]: published.path, [`${prefix}dropbox_id`]: published.id, [`${prefix}dropbox_rev`]: published.rev, [`${prefix}output_error`]: '',
      ...(published.removed_local ? { [URL_FIELD[refType]]: dropboxVideoUrl(refType, refId) } : {}),
    });
    return published;
  } catch (err) {
    await entity.update(refId, { [`${prefix}output_error`]: String(err.message || err).slice(0, 500) }).catch(() => {});
    return { error: err.message };
  }
}

registerJobHandler('publish:output', async ({ ref_type: refType, ref_id: refId }) => {
  const entity = entities[ENTITY[refType]];
  if (!entity) throw badRequest('ref_type must be lesson, meeting or project');
  const record = await entity.get(refId);
  if (!record) throw notFound('Not found');
  const prefix = refType === 'lesson' ? 'rendered_' : refType === 'meeting' ? 'briefing_' : '';
  const out = { video: record[URL_FIELD[refType]] };
  const published = await publishAfterRender(refType, refId, record.video_title || record.title, out, prefix);
  if (published?.error) throw new Error(published.error);
  return published || { skipped: true, reason: 'The output destination is APEX storage' };
});

/** Retries (or performs) the Dropbox upload of a rendered video: { ref_type, ref_id }. */
export async function publishRenderedVideo(payload = {}, ctx = {}) {
  const refType = String(payload.ref_type || '');
  const refId = String(payload.ref_id || '');
  if (!ENTITY[refType] || !refId) throw badRequest('ref_type (lesson, meeting or project) and ref_id are required');
  const job = await enqueueJob({ type: 'publish:output', payload: { ref_type: refType, ref_id: refId }, dedupeKey: `publish:${refType}:${refId}`, refType, refId, userId: ctx.user?.id });
  return { ok: true, job };
}

// ---- function handlers (POST /api/functions/:name) ---------------------------------------------

function assertRendering() {
  if (!renderingAvailable()) throw renderingUnavailableError();
}

export async function renderLessonVideo(payload = {}, ctx = {}) {
  const lessonId = String(payload.lesson_id || '');
  if (!lessonId) throw badRequest('lesson_id is required');
  assertRendering();
  await lessonManifest(lessonId); // fail fast with a clear message
  const job = await enqueueJob({ type: 'render:lesson', payload: { lesson_id: lessonId }, dedupeKey: `render:lesson:${lessonId}`, refType: 'lesson', refId: lessonId, userId: ctx.user?.id });
  return { ok: true, job };
}

export async function renderMeetingVideo(payload = {}, ctx = {}) {
  const meetingId = String(payload.meeting_id || '');
  if (!meetingId) throw badRequest('meeting_id is required');
  assertRendering();
  const meeting = await entities.Meeting.get(meetingId);
  if (!meeting) throw notFound('Meeting not found');
  if (!parseJson(meeting.briefing_scenes).length) throw badRequest('Generate the video briefing first, then render the MP4.');
  if (!mediaKey(meeting.briefing_audio_url) && !mediaEnabled()) {
    throw unavailable('This briefing has no recorded voice-over and no voice provider is configured to record one (see GOOGLE_TTS_SETUP.md).');
  }
  const job = await enqueueJob({ type: 'render:meeting', payload: { meeting_id: meetingId }, dedupeKey: `render:meeting:${meetingId}`, refType: 'meeting', refId: meetingId, userId: ctx.user?.id });
  return { ok: true, job };
}

export async function renderProjectVideo(payload = {}, ctx = {}) {
  const projectId = String(payload.project_id || '');
  if (!projectId) throw badRequest('project_id is required');
  assertRendering();
  const project = await entities.VideoProject.get(projectId);
  if (!project) throw notFound('Video project not found');
  if (!parseJson(project.scenes).length) throw badRequest('Add at least one scene before rendering');
  const job = await enqueueJob({ type: 'render:project', payload: { project_id: projectId }, dedupeKey: `render:project:${projectId}`, refType: 'project', refId: projectId, userId: ctx.user?.id });
  return { ok: true, job };
}
