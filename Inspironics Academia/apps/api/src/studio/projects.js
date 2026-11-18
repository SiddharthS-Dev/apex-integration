import crypto from 'node:crypto';
import { aiEnabled, invokeLLM } from '../ai/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { entities } from '../repo/entities.js';
import { fallbackPoints, fallbackTitle, narrationText, sceneCount, splitNarration } from '../pipeline/generateLessonMedia.js';

// Video projects: the editable scene lists behind AI Studio's Video Studio. A project starts from a
// lesson, a meeting briefing, a document or pasted text (or blank); each scene holds its slide
// (title, layout, points…) and its narration. Rendering voices each scene and renders the MP4.

export const LAYOUTS = ['points', 'steps', 'checklist', 'rule', 'definition', 'compare', 'decision', 'table', 'timeline', 'code'];
const MAX_SCENES = 30;
const newId = () => crypto.randomUUID().slice(0, 8);
const parse = (raw) => { try { const v = typeof raw === 'string' ? JSON.parse(raw || '[]') : raw; return Array.isArray(v) ? v : []; } catch { return []; } };

/** Cleans one scene from the editor (or a source) into the stored shape. */
export function cleanScene(s = {}) {
  const layout = LAYOUTS.includes(s.layout) ? s.layout : 'points';
  const out = {
    id: String(s.id || newId()).slice(0, 40),
    rev: Number.isFinite(Number(s.rev)) ? Number(s.rev) : 0,
    title: String(s.title || '').slice(0, 120),
    layout,
    points: (Array.isArray(s.points) ? s.points : String(s.points || '').split('\n')).map((p) => String(p).trim()).filter(Boolean).slice(0, 8).map((p) => p.slice(0, 200)),
    narration: String(s.narration ?? s.text ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000),
  };
  if (s.quote) out.quote = String(s.quote).slice(0, 400);
  if (s.term) out.term = String(s.term).slice(0, 80);
  if (s.definition) out.definition = String(s.definition).slice(0, 400);
  if (s.table?.headers?.length) out.table = { headers: s.table.headers.map(String).slice(0, 5), rows: (s.table.rows || []).filter((r) => Array.isArray(r)).slice(0, 8).map((r) => s.table.headers.map((_, i) => String(r[i] ?? ''))) };
  if (Array.isArray(s.columns)) out.columns = s.columns.slice(0, 2).map((c) => ({ label: String(c.label || ''), tone: ['do', 'dont', 'neutral'].includes(c.tone) ? c.tone : 'neutral', items: (c.items || []).map(String).slice(0, 6) }));
  if (Array.isArray(s.events)) out.events = s.events.slice(0, 8).map((e) => ({ label: String(e.label || ''), text: String(e.text || '') }));
  if (Array.isArray(s.branches)) { out.branches = s.branches.slice(0, 6).map((b) => ({ when: String(b.when || ''), then: String(b.then || '') })); out.question = String(s.question || ''); }
  if (s.code) { out.code = String(s.code).slice(0, 2000); out.language = String(s.language || ''); }
  if (s.image_key && /^[a-f0-9]{64}$/.test(s.image_key)) out.image_key = s.image_key;
  if (!out.points.length) out.points = [out.title || 'Key point'];
  return out;
}

export const projectScenes = (project) => parse(project?.scenes);

function scenesFromStored(stored) {
  return stored.map((s) => cleanScene({ ...s, narration: s.text }));
}

function scenesFromScript(script) {
  const text = narrationText(script);
  return splitNarration(text, sceneCount(text)).map((seg, i) => cleanScene({ title: fallbackTitle(seg, i), layout: 'points', points: fallbackPoints(seg), narration: seg }));
}

const SCENES_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    scenes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          layout: { type: 'string', enum: ['points', 'steps', 'checklist', 'rule', 'timeline'] },
          points: { type: 'array', items: { type: 'string' } },
          quote: { type: 'string' },
          narration: { type: 'string' },
        },
      },
    },
  },
};

/** Scenes for an explainer video from source text: the AI when it is on, otherwise split evenly. */
export async function scenesFromText(text, { title = '' } = {}) {
  const source = String(text || '').replace(/\s+\n/g, '\n').trim();
  if (source.length < 40) throw badRequest('The text is too short to make a video from');
  if (!aiEnabled()) return { title, scenes: scenesFromScript(source.slice(0, 8000)) };
  const res = await invokeLLM({
    prompt: `You are an instructor turning the material below into a short narrated explainer video (5–10 scenes) for engineers at Inspironics.
For each scene give: "title" (2–6 words), "layout" (points, steps, checklist, rule or timeline), "points" (2–5 short on-screen points, max 12 words each), "quote" for a rule layout, and "narration": what the instructor says during the scene, 40–120 words of plain spoken English (no markdown).
Use only the facts in the material; keep its terminology and numbers. Also give the video a "title".

MATERIAL
"""
${source.slice(0, 60000)}
"""`,
    schema: SCENES_SCHEMA,
    maxTokens: 16000,
    effort: 'medium',
  });
  const scenes = (res.scenes || []).map(cleanScene).filter((s) => s.narration.length >= 20).slice(0, MAX_SCENES);
  if (!scenes.length) return { title, scenes: scenesFromScript(source.slice(0, 8000)) };
  return { title: res.title || title, scenes };
}

/** Creates a project from a source: { source_type, source_id?, text?, title? }. */
export async function createProject({ source_type: type = 'blank', source_id: sourceId, text, title, eyebrow, default_title: defaultTitle }, user) {
  let scenes;
  let name = title;
  let head = eyebrow;
  if (type === 'lesson') {
    const lesson = await entities.Lesson.get(String(sourceId || ''));
    if (!lesson) throw notFound('Lesson not found');
    const stored = parse(lesson.video_scenes);
    scenes = stored.length ? scenesFromStored(stored) : lesson.teaching_script ? scenesFromScript(lesson.teaching_script) : null;
    if (!scenes) throw badRequest('This lesson has no content yet — generate its content first');
    name ||= lesson.video_title || lesson.title;
    head ||= 'Lesson';
  } else if (type === 'meeting') {
    const meeting = await entities.Meeting.get(String(sourceId || ''));
    if (!meeting) throw notFound('Meeting not found');
    const stored = parse(meeting.briefing_scenes);
    if (!stored.length) throw badRequest('This meeting has no video briefing yet — generate the briefing first');
    scenes = scenesFromStored(stored);
    name ||= `${meeting.title} — briefing`;
    head ||= ['Meeting briefing', meeting.team ? `${meeting.team} team` : ''].filter(Boolean).join(' · ');
  } else if (type === 'document' || type === 'text') {
    const made = await scenesFromText(text, { title });
    scenes = made.scenes;
    name ||= made.title || defaultTitle || 'Explainer video';
  } else {
    scenes = [cleanScene({ title: 'Introduction', layout: 'points', points: ['What this video covers'], narration: '' })];
    name ||= 'Untitled video';
  }
  return entities.VideoProject.create({
    title: String(name).slice(0, 160), source_type: type, source_id: sourceId ? String(sourceId) : '', eyebrow: head || 'Inspironics Academia',
    scenes: JSON.stringify(scenes.slice(0, MAX_SCENES)), status: 'draft', presenter: true, burn_captions: true,
  }, { userId: user?.id });
}

/** Applies an editor update: title, eyebrow, voice settings, scenes (cleaned). */
export async function updateProject(id, patch = {}) {
  const project = await entities.VideoProject.get(id);
  if (!project) throw notFound('Video project not found');
  const update = {};
  if (patch.title !== undefined) update.title = String(patch.title).slice(0, 160) || project.title;
  if (patch.eyebrow !== undefined) update.eyebrow = String(patch.eyebrow).slice(0, 120);
  for (const k of ['voice_provider', 'voice', 'language']) if (patch[k] !== undefined) update[k] = String(patch[k] || '').slice(0, 120);
  if (patch.rate !== undefined) update.rate = patch.rate === '' || patch.rate === null ? null : Math.min(2, Math.max(0.5, Number(patch.rate) || 1));
  if (patch.presenter !== undefined) update.presenter = !!patch.presenter;
  if (patch.burn_captions !== undefined) update.burn_captions = !!patch.burn_captions;
  if (patch.scenes !== undefined) {
    if (!Array.isArray(patch.scenes)) throw badRequest('scenes must be a list');
    if (patch.scenes.length > MAX_SCENES) throw badRequest(`A video has at most ${MAX_SCENES} scenes`);
    update.scenes = JSON.stringify(patch.scenes.map(cleanScene));
  }
  return entities.VideoProject.update(id, update);
}
