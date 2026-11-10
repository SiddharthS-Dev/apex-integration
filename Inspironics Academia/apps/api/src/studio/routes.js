import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import express from 'express';
import { aiEnabled, aiUnavailableReason, availableProviders, describeAiConfig, invokeLLM, providerReady, requireAI } from '../ai/index.js';
import { requireAdmin } from '../auth/sessions.js';
import { config } from '../config.js';
import { objectKey, putObject } from '../files/objectStore.js';
import { cancelJob, getJob, listJobs, retryJob } from '../jobs/queue.js';
import { asyncHandler, badRequest, notFound } from '../lib/errors.js';
import { availableVoiceProviders, listVoices, mediaEnabled, synthesize, voiceSettings } from '../media/index.js';
import { mp3Frames } from '../media/mp3.js';
import { renderingAvailable } from '../media/video/renderer.js';
import { renderSlideSvg, itemCount } from '../media/video/slides.js';
import { renderProjectVideo } from '../pipeline/renderVideo.js';
import { loadLessonSource } from '../pipeline/source.js';
import { extractText } from '../pipeline/text.js';
import { entities } from '../repo/entities.js';
import { runWithGeneration } from '../usage/context.js';
import { getLimits, setLimits } from '../usage/limits.js';
import { byProviderSince, dayStart, monthStart, recentGenerations, totalsSince } from '../usage/log.js';
import { CONTENT_TYPES, buildStudioPrompt, contentTypeList } from './contentTypes.js';
import { browseDropbox, checkAccount, dropboxAccounts, dropboxDocumentText } from '../dropbox/processing.js';
import { outputSettings, setOutputSettings } from '../dropbox/output.js';
import { cleanupStorage, storageReport } from '../storage/storage.js';
import { db } from '../db/index.js';
import { cleanScene, createProject, projectScenes, updateProject } from './projects.js';
import { courseLessons, courseProgress, selectLessons, startCourseBatch } from '../pipeline/courseContent.js';
import { aiPrice, PRICES_CHECKED } from '../usage/pricing.js';

// AI Studio API (admin only): content generation, voice-over, video projects, render jobs, the
// generation history and the usage & budget dashboard. Every paid call goes through the AI and media
// routers, so it is limited, cached where possible and logged.

const require = createRequire(import.meta.url);
const router = express.Router();
router.use(requireAdmin);
const MAX_SOURCE_CHARS = 60_000;

router.get('/config', asyncHandler(async (_req, res) => {
  res.json({
    // key_configured is a yes/no; no key, token or secret is ever sent to the browser.
    ai: { ...describeAiConfig(), key_configured: providerReady(config.aiProvider), unavailable_reason: aiUnavailableReason(), providers: availableProviders(), prices_checked: PRICES_CHECKED },
    voice: {
      enabled: mediaEnabled(), default_provider: config.mediaProvider, providers: availableVoiceProviders(), defaults: voiceSettings(),
      ...(config.mediaProvider === 'gemini' ? { model: config.tts.gemini.model, voice: config.tts.gemini.voice } : {}),
    },
    video: { enabled: renderingAvailable(), provider: config.video.provider, width: config.video.width, height: config.video.height },
    content_types: contentTypeList(),
    auto_generate_audio: config.autoGenerateAudio,
  });
}));

// ---- content generator ------------------------------------------------------------------------

async function sourceText(source) {
  if (!source?.type || !source?.id) return '';
  if (source.type === 'lesson') {
    const lesson = await entities.Lesson.get(String(source.id));
    if (!lesson) throw notFound('Lesson not found');
    const { chapter } = await loadLessonSource(lesson);
    return [`Lesson: ${lesson.title}`, lesson.teaching_objective && `Objective: ${lesson.teaching_objective}`, chapter?.content || lesson.teaching_script || lesson.summary || ''].filter(Boolean).join('\n');
  }
  if (source.type === 'meeting') {
    const m = await entities.Meeting.get(String(source.id));
    if (!m) throw notFound('Meeting not found');
    const items = await entities.ActionItem.filter({ meeting_id: m.id });
    return [`Meeting: ${m.title} (${m.meeting_date || ''})`, `Purpose: ${m.purpose || ''}`, `Summary: ${m.summary || ''}`,
      `Decisions: ${JSON.stringify(m.decisions || [])}`, `Requirements: ${JSON.stringify(m.requirements || [])}`,
      `Action items: ${items.map((a) => `${a.task} — ${a.owner_name || 'team'} — ${a.due_text || a.due_date || ''}`).join('; ')}`,
      `Risks: ${JSON.stringify(m.risks || [])}`, `Open questions: ${JSON.stringify(m.open_questions || [])}`].join('\n');
  }
  if (source.type === 'playbook') {
    const chapters = await entities.Chapter.filter({ playbook_id: String(source.id) });
    if (!chapters.length) throw notFound('Playbook chapters not found — extract the playbook first');
    return chapters.map((c) => `## ${c.number || ''} ${c.title}\n${c.content || c.summary || ''}`).join('\n\n');
  }
  if (source.type === 'dropbox') {
    const doc = await dropboxDocumentText(source.account, String(source.id), { force: source.force === true });
    return `Document: ${doc.meta.name}
${doc.text}`;
  }
  throw badRequest('source.type must be lesson, meeting, playbook or dropbox');
}

router.post('/generate', asyncHandler(async (req, res) => {
  requireAI();
  const b = req.body || {};
  const type = String(b.content_type || '');
  const spec = CONTENT_TYPES[type];
  if (!spec) throw badRequest(`content_type must be one of ${Object.keys(CONTENT_TYPES).join(', ')}`);
  if (b.provider && !availableProviders().some((p) => p.name === b.provider)) throw badRequest(`The ${b.provider} AI provider is not configured`);
  const instructions = String(b.instructions || '').slice(0, 4000);
  if (type === 'custom' && !instructions.trim()) throw badRequest('Write the instructions for a custom generation');
  const source = (String(b.source_text || '') || await sourceText(b.source)).slice(0, MAX_SOURCE_CHARS);
  const prompt = buildStudioPrompt(type, { language: String(b.language || 'English').slice(0, 40), length: b.length, tone: b.tone, instructions, source });
  const started = Date.now();
  const output = await runWithGeneration(
    { operation: `studio:${type}`, userId: req.user.id, fresh: b.fresh === true, refType: b.source?.type, refId: b.source?.id },
    () => invokeLLM({ prompt, schema: spec.schema, maxTokens: 16000, effort: 'medium', provider: b.provider || undefined }),
  );
  res.json({ content_type: type, format: spec.format, output, provider: b.provider || config.aiProvider, ms: Date.now() - started });
}));

// ---- voice studio ------------------------------------------------------------------------------

router.get('/voices', asyncHandler(async (req, res) => {
  res.json(await listVoices(String(req.query.provider || config.mediaProvider), req.query.language ? String(req.query.language) : undefined));
}));

router.post('/voice', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const text = String(b.text || '');
  if (text.length > 5000) throw badRequest('Voice Studio takes up to 5,000 characters at a time');
  const out = await runWithGeneration({ operation: 'studio:voice', userId: req.user.id }, () => synthesize(text, {
    provider: b.provider || undefined, voice: b.voice || undefined, language: b.language || undefined, rate: b.rate, pitch: b.pitch,
  }));
  res.json({ url: out.url, cached: out.cached, characters: out.characters, seconds: +mp3Frames(out.bytes).seconds.toFixed(2) });
}));

// ---- video projects -----------------------------------------------------------------------------

const publicProject = (p) => (p ? { ...p, scenes: projectScenes(p) } : p);

router.get('/projects', asyncHandler(async (_req, res) => {
  const list = await entities.VideoProject.filter({}, '-updated_date', 200);
  res.json(list.map((p) => ({ ...publicProject(p), scene_count: projectScenes(p).length })));
}));

router.post('/projects', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!['blank', 'lesson', 'meeting', 'text'].includes(b.source_type || 'blank')) throw badRequest('source_type must be blank, lesson, meeting or text (upload documents to /projects/from-document)');
  const project = await runWithGeneration({ operation: 'studio:project', userId: req.user.id }, () => createProject({ ...b, text: String(b.text || '').slice(0, MAX_SOURCE_CHARS) }, req.user));
  res.status(201).json(publicProject(project));
}));

const DOC_TYPES = { pdf: 'pdf', docx: 'docx', txt: 'text', md: 'text' };
router.post('/projects/from-document', express.raw({ type: () => true, limit: `${config.maxUploadMb}mb` }), asyncHandler(async (req, res) => {
  const name = decodeURIComponent(req.get('x-file-name') || '');
  const ext = name.split('.').pop().toLowerCase();
  if (!DOC_TYPES[ext]) throw badRequest('Upload a PDF, Word (.docx), .txt or .md document');
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw badRequest('Empty file');
  const text = DOC_TYPES[ext] === 'text' ? req.body.toString('utf8') : (await extractText({ file_name: name, file_type: ext }, req.body)).text;
  const project = await runWithGeneration({ operation: 'studio:project', userId: req.user.id }, () => createProject({ source_type: 'document', text: text.slice(0, MAX_SOURCE_CHARS), default_title: name.replace(/\.[^.]+$/, '') }, req.user));
  res.status(201).json(publicProject(project));
}));

router.get('/projects/:id', asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  res.json(publicProject(p));
}));

router.patch('/projects/:id', asyncHandler(async (req, res) => {
  res.json(publicProject(await updateProject(req.params.id, req.body || {})));
}));

router.delete('/projects/:id', asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  await entities.VideoProject.delete(p.id);
  res.json({ ok: true });
}));

// A slide image for one scene (PNG/JPEG ≤ 5 MB), shown behind the slide.
router.post('/projects/:id/scenes/:sceneId/image', express.raw({ type: () => true, limit: '5mb' }), asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  const buf = req.body;
  const png = Buffer.isBuffer(buf) && buf.length > 8 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG';
  const jpg = Buffer.isBuffer(buf) && buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (!png && !jpg) throw badRequest('Upload a PNG or JPEG image');
  const scenes = projectScenes(p);
  const scene = scenes.find((s) => s.id === req.params.sceneId);
  if (!scene) throw notFound('Scene not found');
  const key = objectKey('studio-image', crypto.createHash('sha256').update(buf).digest('hex'));
  await putObject(key, buf, { source: 'studio-image', content_type: png ? 'image/png' : 'image/jpeg' });
  scene.image_key = key;
  res.json(publicProject(await updateProject(p.id, { scenes })));
}));

router.delete('/projects/:id/scenes/:sceneId/image', asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  const scenes = projectScenes(p).map((s) => (s.id === req.params.sceneId ? { ...s, image_key: undefined } : s));
  res.json(publicProject(await updateProject(p.id, { scenes })));
}));

// Preview of a scene's slide (all items shown), drawn exactly as the renderer draws it.
router.get('/projects/:id/scenes/:sceneId/preview.png', asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  const scenes = projectScenes(p);
  const index = scenes.findIndex((s) => s.id === req.params.sceneId);
  if (index < 0) throw notFound('Scene not found');
  const scene = cleanScene(scenes[index]);
  const { Resvg } = require('@resvg/resvg-js');
  const svg = renderSlideSvg(scene, index, scenes.length, { eyebrow: p.eyebrow, shown: itemCount(scene), caption: scene.narration.split(/(?<=[.!?])\s/)[0]?.slice(0, 120) || null, presenter: p.presenter !== false });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: 960 }, font: { loadSystemFonts: true } }).render().asPng();
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'private, no-store');
  res.end(png);
}));

router.post('/projects/:id/render', asyncHandler(async (req, res) => {
  res.status(202).json(await runWithGeneration({ operation: 'renderProjectVideo', userId: req.user.id }, () => renderProjectVideo({ project_id: req.params.id }, { user: req.user })));
}));

// Re-render one scene: its cache entry is bypassed (rev + 1), every other scene is reused.
router.post('/projects/:id/scenes/:sceneId/rerender', asyncHandler(async (req, res) => {
  const p = await entities.VideoProject.get(req.params.id);
  if (!p) throw notFound('Video project not found');
  const scenes = projectScenes(p);
  const scene = scenes.find((s) => s.id === req.params.sceneId);
  if (!scene) throw notFound('Scene not found');
  scene.rev = (Number(scene.rev) || 0) + 1;
  await updateProject(p.id, { scenes });
  res.status(202).json(await renderProjectVideo({ project_id: p.id }, { user: req.user }));
}));

// ---- jobs ---------------------------------------------------------------------------------------

router.get('/jobs', asyncHandler(async (req, res) => {
  res.json(await listJobs({ refType: req.query.ref_type, refId: req.query.ref_id, status: req.query.status, limit: req.query.limit }));
}));
router.get('/jobs/:id', asyncHandler(async (req, res) => {
  const job = await getJob(req.params.id);
  if (!job) throw notFound('Job not found');
  res.json(job);
}));
router.post('/jobs/:id/cancel', asyncHandler(async (req, res) => res.json(await cancelJob(req.params.id))));
router.post('/jobs/:id/retry', asyncHandler(async (req, res) => res.json(await retryJob(req.params.id))));

// ---- history, usage and limits ----------------------------------------------------------------


// ---- Dropbox documents (metadata browsing; bytes fetched only when a document is processed) -----

router.get('/dropbox/accounts', asyncHandler(async (_req, res) => {
  res.json(await dropboxAccounts());
}));

router.get('/dropbox/browse', asyncHandler(async (req, res) => {
  res.json(await browseDropbox(String(req.query.account || 'playbooks'), typeof req.query.path === 'string' ? req.query.path : ''));
}));

// A video project from a Dropbox document. The same file revision is not processed twice: an existing
// project made from it is returned (pass force: true to make a new one from a fresh extraction).
router.post('/projects/from-dropbox', asyncHandler(async (req, res) => {
  const b = req.body || {};
  if (!b.file_id) throw badRequest('file_id is required');
  const doc = await dropboxDocumentText(b.account, String(b.file_id), { force: b.force === true });
  if (b.force !== true) {
    const [existing] = await entities.VideoProject.filter({ source_type: 'dropbox', source_id: doc.meta.id, source_revision: doc.meta.rev }, '-updated_date', 1);
    if (existing) return res.json({ ...publicProject(existing), reused: true });
  }
  const project = await runWithGeneration({ operation: 'studio:project', userId: req.user.id, refType: 'dropbox', refId: doc.meta.id },
    () => createProject({ source_type: 'document', text: doc.text.slice(0, MAX_SOURCE_CHARS), default_title: doc.meta.name.replace(/\.[^.]+$/, '') }, req.user));
  const saved = await entities.VideoProject.update(project.id, { source_type: 'dropbox', source_id: doc.meta.id, source_revision: doc.meta.rev, source_path: doc.meta.path_display, source_account: String(b.account || 'playbooks') });
  res.status(201).json({ ...publicProject(saved), reused: false, extraction_reused: doc.reused });
}));

// ---- course content batches ---------------------------------------------------------------------

router.get('/courses', asyncHandler(async (_req, res) => {
  const courses = (await entities.Course.list('-created_date', 200)).filter((c) => c.status !== 'archived');
  res.json(courses.map((c) => ({ id: c.id, title: c.title, status: c.status, playbook_id: c.playbook_id || null, module_count: c.module_count, lesson_count: c.lesson_count, created_date: c.created_date })));
}));

router.get('/courses/:id/progress', asyncHandler(async (req, res) => {
  res.json(await courseProgress(req.params.id));
}));

/**
 * Estimated cost of generating `lessons`: from the logged cost of lessons of this course generated so
 * far when there are any (actual usage × list price), otherwise from the source size and the model's
 * list price with a typical output length. Always an estimate; the provider's invoice is what is billed.
 */
async function estimateBatch(courseLessonsList, selected) {
  const done = courseLessonsList.filter((l) => String(l.teaching_script || '').trim()).map((l) => l.id);
  if (done.length) {
    const marks = done.map(() => '?').join(',');
    const [row] = await db().query(`SELECT count(DISTINCT ref_id) AS lessons, sum(cost_usd) AS cost, sum(input_tokens) AS input, sum(output_tokens) AS output FROM generation_log WHERE ref_type = 'lesson' AND status = 'ok' AND kind IN ('ai', 'tts') AND cost_usd IS NOT NULL AND ref_id IN (${marks})`, done);
    if (Number(row?.lessons) > 0 && row.cost != null) {
      const perLesson = Number(row.cost) / Number(row.lessons);
      return { basis: 'measured', per_lesson_usd: +perLesson.toFixed(4), total_usd: +(perLesson * selected.length).toFixed(2), sample_lessons: Number(row.lessons) };
    }
  }
  const price = aiPrice(config.aiProvider, PROVIDER_MODEL());
  if (!price) return { basis: 'unknown', per_lesson_usd: null, total_usd: null };
  // Prompt ≈ 1,500 tokens + the source chapter (≈ 4 characters per token); output 5,000–10,000 tokens
  // (script, summary, examples, quiz, flashcards and thinking).
  let low = 0;
  let high = 0;
  for (const l of selected) {
    const { chapter } = await loadLessonSource(l).catch(() => ({}));
    const input = 1500 + Math.ceil(String(chapter?.content || '').length / 4);
    low += (input * price[0] + 5000 * price[1]) / 1e6;
    high += (input * price[0] + 10000 * price[1]) / 1e6;
  }
  return { basis: 'list price × typical length', low_usd: +low.toFixed(2), high_usd: +high.toFixed(2), prices_checked: PRICES_CHECKED };
}
const PROVIDER_MODEL = () => describeAiConfig().model;

// Starts the course batch. More than one lesson needs { confirm: true }: the first call returns the
// count and the cost estimate (409) so the admin approves the batch knowingly.
router.post('/courses/:id/generate', asyncHandler(async (req, res) => {
  const b = req.body || {};
  const { lessons } = await courseLessons(req.params.id);
  const selected = selectLessons(lessons, { limit: b.limit, lessonIds: b.lesson_ids, retryFailed: b.retry_failed === true });
  if (!selected.length) return res.json({ started: false, reason: 'Every selected lesson already has content (nothing is overwritten; use Regenerate on a lesson to replace it).' });
  if (selected.length > 1 && b.confirm !== true) {
    const estimate = await estimateBatch(lessons, selected);
    return res.status(409).json({ error: 'Confirm the batch', confirm_required: true, selected: selected.length, estimate, details: { confirm_required: true, selected: selected.length, estimate } });
  }
  const job = await startCourseBatch({ ...b, course_id: req.params.id }, { user: req.user });
  res.status(202).json({ started: true, selected: selected.length, job });
}));

// ---- storage ------------------------------------------------------------------------------------

router.get('/storage', asyncHandler(async (req, res) => {
  const report = await storageReport({ fresh: req.query.fresh === '1' });
  res.json({ ...report, output: await outputSettings() });
}));

// Clean-up of the safe categories. dry_run (default true) only lists what would be removed.
router.post('/storage/cleanup', asyncHandler(async (req, res) => {
  const b = req.body || {};
  res.json(await cleanupStorage({ dryRun: b.dry_run !== false, includeSuperseded: b.include_superseded === true }));
}));

router.put('/storage/output', asyncHandler(async (req, res) => {
  res.json(await setOutputSettings(req.body || {}));
}));

// Dropbox and processing overview for the dashboard (all measured from the database and Dropbox).
router.get('/storage/overview', asyncHandler(async (_req, res) => {
  const { getSyncSettings, loadConnection, withDropboxAccount } = await import('../dropbox/connection.js');
  const { getSpaceUsage } = await import('../dropbox/client.js');
  const { latestSyncLog } = await import('../sync/log.js');
  const accounts = await dropboxAccounts();
  const space = {};
  for (const a of accounts) {
    try { space[a.account] = await withDropboxAccount(checkAccount(a.account), () => getSpaceUsage()); } catch (err) { space[a.account] = { error: err.message }; }
  }
  const q = async (sql, args = []) => (await db().query(sql, args).catch(() => [{}]))[0] || {};
  const pb = await q("SELECT count(*) AS total, sum(CASE WHEN source = 'dropbox' THEN 1 ELSE 0 END) AS from_dropbox, sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, sum(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS pending, sum(CASE WHEN coalesce(extracted_revision, '') <> '' THEN 1 ELSE 0 END) AS extracted, max(extracted_at) AS last_extracted FROM e_playbook WHERE status <> 'archived'");
  const mt = await q("SELECT count(*) AS total, sum(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, sum(CASE WHEN status = 'uploaded' THEN 1 ELSE 0 END) AS pending FROM e_meeting WHERE status <> 'archived'");
  const jobs = await db().query("SELECT status, count(*) AS n FROM jobs GROUP BY status").catch(() => []);
  const proc = await q("SELECT sum(CASE WHEN status = 'ok' THEN 1 ELSE 0 END) AS processed, sum(CASE WHEN status = 'reused' THEN 1 ELSE 0 END) AS reused, max(created_at) AS last FROM generation_log WHERE kind = 'process'");
  const aiForDropbox = await q("SELECT count(*) AS n, sum(cost_usd) AS cost FROM generation_log WHERE kind = 'ai' AND status = 'ok' AND (ref_type = 'dropbox' OR operation IN ('processPlaybookExtract', 'processMeeting', 'sync:extract', 'sync:meeting'))");
  res.json({
    dropbox: {
      connected: !!(await loadConnection().catch(() => null)),
      accounts, space,
      folders: await getSyncSettings(),
      last_sync: await latestSyncLog(),
    },
    processing: {
      playbooks: pb, meetings: mt,
      jobs: Object.fromEntries(jobs.map((j) => [j.status, Number(j.n)])),
      documents_processed: Number(proc.processed) || 0,
      duplicate_processing_prevented: Number(proc.reused) || 0,
      last_processed_at: proc.last || null,
      ai_requests_for_dropbox_documents: Number(aiForDropbox.n) || 0,
      ai_cost_for_dropbox_documents_usd: aiForDropbox.cost == null ? null : +Number(aiForDropbox.cost).toFixed(4),
    },
  });
}));

router.get('/history', asyncHandler(async (req, res) => {
  res.json(await recentGenerations({ limit: req.query.limit, kind: req.query.kind, offset: req.query.offset }));
}));

router.get('/usage', asyncHandler(async (_req, res) => {
  const [today, month, providers, limits] = await Promise.all([totalsSince(dayStart()), totalsSince(monthStart()), byProviderSince(monthStart()), getLimits()]);
  const spent = month.ai.cost_usd + month.tts.cost_usd;
  res.json({
    today, month, providers, limits,
    month_start: monthStart(),
    estimated_spend_usd: +spent.toFixed(4),
    budget_remaining_usd: limits.aiMonthlyBudgetUsd == null ? null : +Math.max(0, limits.aiMonthlyBudgetUsd - spent).toFixed(4),
    tts_chars_remaining: limits.ttsMonthlyChars == null ? null : Math.max(0, limits.ttsMonthlyChars - month.tts.characters),
    render_minutes_remaining: limits.videoMonthlyMinutes == null ? null : +Math.max(0, limits.videoMonthlyMinutes - month.render.seconds / 60).toFixed(2),
    ai_requests_left_today: limits.aiDailyRequests == null ? null : Math.max(0, limits.aiDailyRequests - today.ai.requests),
    pricing_note: 'Costs are estimates from published list prices (Google Gemini) or the prices set in AI_PRICE_* / TTS_PRICE_PER_MILLION_CHARS. Requests without a known price are counted but not costed.',
    ai_enabled: aiEnabled(),
  });
}));

router.put('/limits', asyncHandler(async (req, res) => {
  res.json(await setLimits(req.body || {}));
}));

export default router;
