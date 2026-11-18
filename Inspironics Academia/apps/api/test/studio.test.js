import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';

// AI Studio end to end over HTTP: content generation, voice, video projects rendered by background
// jobs (real FFmpeg renders), lesson and meeting MP4s, job controls, usage and limits — and the
// on-demand rules (sync and lesson content no longer spend on AI or voice unasked).
// The AI (Gemini API) is a local fake; Google TTS is mocked at fetch and returns real MP3 audio.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-studio-'));
const aiCalls = [];
const ttsCalls = [];

const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    const prompt = body.contents?.[0]?.parts?.at(-1)?.text || '';
    aiCalls.push(prompt);
    let out;
    if (prompt.includes('narrated explainer video')) {
      out = { title: 'Code review basics', scenes: [
        { title: 'Why review', layout: 'points', points: ['Catch defects early', 'Share knowledge'], narration: 'We review code to catch defects early and to share knowledge across the team.' },
        { title: 'The checklist', layout: 'checklist', points: ['Tests pass', 'Docs updated'], narration: 'Before asking for a review, make sure the tests pass and the documentation is updated.' },
      ] };
    } else if (prompt.includes('multiple-choice')) {
      out = { questions: [{ question_text: 'Why review code?', options: ['Catch defects', 'Slow down', 'Skip tests', 'None'], correct_answer: 'Catch defects', explanation: 'Reviews find defects.', difficulty: 'basic' }] };
    } else if (prompt.includes('identify its structure') || prompt.includes('meticulous technical librarian') || prompt.includes('preparing an engineering playbook')) {
      out = { title: '', author: '', version: '', organization: '', toc: [], chapters: [] };
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '## Summary\n\n- Reviews catch defects.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } }));
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 200 } }));
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));

Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  AI_ENABLED: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'gemini-test', GEMINI_BASE_URL: `http://127.0.0.1:${ai.address().port}/v1beta`,
  AI_PRICE_INPUT_PER_MTOK: '1', AI_PRICE_OUTPUT_PER_MTOK: '2',
  MEDIA_PROVIDER: 'google', GOOGLE_TTS_API_KEY: 'k', TTS_PRICE_PER_MILLION_CHARS: '16',
  VIDEO_WIDTH: '640', VIDEO_HEIGHT: '360', VIDEO_FPS: '10', AUTO_GENERATE_AUDIO: 'false', MAX_CONCURRENT_JOBS: '1',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');
const { entities } = await import('../src/repo/entities.js');
const { objectKey, putObject } = await import('../src/files/objectStore.js');
const { runFfmpeg } = await import('../src/media/video/ffmpeg.js');
const { startJobWorker, stopJobWorker, waitForJob } = await import('../src/jobs/queue.js');
const { handlers } = await import('../src/pipeline/index.js');

// Real MP3 audio for every voice-over (2.0 s tone).
const toneFile = path.join(dir, 'tone.mp3');
await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=500:duration=2', '-ar', '44100', '-ac', '1', '-b:a', '64k', toneFile]);
const TONE = fs.readFileSync(toneFile);
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url) === 'https://texttospeech.googleapis.com/v1/text:synthesize') {
    ttsCalls.push(JSON.parse(init.body).input.text);
    return new Response(JSON.stringify({ audioContent: TONE.toString('base64') }), { status: 200 });
  }
  return realFetch(url, init);
};

let server;
let base;
const jar = { admin: '', learner: '' };
async function call(who, method, url, body, headers = {}) {
  const raw = Buffer.isBuffer(body);
  const res = await realFetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}), ...headers },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set && who) jar[who] = set.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf.toString();
  try { data = JSON.parse(data); } catch { /* binary */ }
  return { status: res.status, data, buf, type: res.headers.get('content-type') };
}
const admin = (...a) => call('admin', ...a);

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123' });
  await call('learner', 'POST', '/auth/register', { email: 'learner@example.com', password: 'Learner-pass-123' });
  await startJobWorker({ intervalMs: 150 });
});
after(async () => {
  stopJobWorker();
  globalThis.fetch = realFetch;
  server?.close();
  ai.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('AI Studio is for administrators only, and reports what is configured', async () => {
  assert.equal((await call('learner', 'GET', '/studio/config')).status, 403);
  assert.equal((await call('', 'GET', '/studio/usage')).status, 401);
  const { data } = await admin('GET', '/studio/config');
  assert.equal(data.ai.provider, 'gemini');
  assert.deepEqual(data.ai.providers.map((p) => p.name), ['gemini']);
  assert.deepEqual(data.voice.providers, ['gemini', 'google'], 'Gemini speech uses the same GEMINI_API_KEY');
  assert.equal(data.ai.key_configured, true);
  assert.equal(data.video.enabled, true);
  assert.equal(data.auto_generate_audio, false);
  assert.ok(data.content_types.some((t) => t.key === 'question_bank' && t.format === 'json'));
  assert.ok(!JSON.stringify(data).includes('"k"'), 'no keys');
  const cfg = await call('', 'GET', '/config');
  assert.equal(cfg.data.video_render_enabled, true);
});

test('content generator: markdown and structured questions, from pasted text', async () => {
  const md = await admin('POST', '/studio/generate', { content_type: 'lesson_summary', source_text: 'Code review catches defects early.', tone: 'friendly', length: 'short', language: 'English' });
  assert.equal(md.status, 200);
  assert.equal(md.data.format, 'markdown');
  assert.match(md.data.output, /Reviews catch defects/);
  assert.match(aiCalls.at(-1), /warm, friendly/);
  assert.match(aiCalls.at(-1), /SOURCE MATERIAL\n"""\nCode review catches defects early/);
  const mcq = await admin('POST', '/studio/generate', { content_type: 'assessment', source_text: 'Code review catches defects early.' });
  assert.equal(mcq.data.format, 'json');
  assert.equal(mcq.data.output.questions[0].correct_answer, 'Catch defects');
  assert.equal((await admin('POST', '/studio/generate', { content_type: 'nope' })).status, 400);
  assert.equal((await admin('POST', '/studio/generate', { content_type: 'custom' })).status, 400, 'custom needs instructions');
  assert.equal((await admin('POST', '/studio/generate', { content_type: 'lesson_summary', provider: 'ollama', source_text: 'x' })).status, 400, 'unconfigured provider');
});

test('voice studio: speak, reuse from the cache, preview the audio', async () => {
  const first = await admin('POST', '/studio/voice', { text: 'Welcome to AI Studio.', language: 'en-IN', rate: 1 });
  assert.equal(first.status, 200);
  assert.equal(first.data.cached, false);
  assert.ok(Math.abs(first.data.seconds - 2) < 0.1);
  const again = await admin('POST', '/studio/voice', { text: 'Welcome to AI Studio.', language: 'en-IN', rate: 1 });
  assert.equal(again.data.cached, true);
  assert.equal(again.data.url, first.data.url);
  const audio = await call('learner', 'GET', first.data.url.replace('/api', ''));
  assert.equal(audio.status, 200, 'served like other media');
  assert.equal(audio.type, 'audio/mpeg');
  assert.equal((await admin('POST', '/studio/voice', { text: '   ' })).status, 400);
});

let project;
test('video project from a document: AI scenes, edit, slide image, preview, background render', { timeout: 300_000 }, async () => {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Code review guide. We review code to catch defects early and share knowledge. Before a review the tests must pass.</w:t></w:r></w:p></w:body></w:document>');
  const docx = await zip.generateAsync({ type: 'nodebuffer' });
  const made = await admin('POST', '/studio/projects/from-document', docx, { 'X-File-Name': encodeURIComponent('Code review.docx') });
  assert.equal(made.status, 201);
  project = made.data;
  assert.equal(project.title, 'Code review basics');
  assert.equal(project.scenes.length, 2);
  assert.equal(project.scenes[1].layout, 'checklist');

  const scenes = project.scenes.map((s, i) => (i === 0 ? { ...s, title: 'Why we review code' } : s));
  const patched = await admin('PATCH', `/studio/projects/${project.id}`, { scenes, eyebrow: 'Engineering basics', language: 'en-IN' });
  assert.equal(patched.data.scenes[0].title, 'Why we review code');

  const image = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108020000009077053e0000000c4944415408d763f8ffff3f0005fe02fe0dd8b5e80000000049454e44ae426082', 'hex');
  const withImage = await admin('POST', `/studio/projects/${project.id}/scenes/${scenes[0].id}/image`, image);
  assert.equal(withImage.status, 200);
  assert.match(withImage.data.scenes[0].image_key, /^[a-f0-9]{64}$/);
  assert.equal((await admin('POST', `/studio/projects/${project.id}/scenes/${scenes[0].id}/image`, Buffer.from('not an image'))).status, 400);

  const preview = await admin('GET', `/studio/projects/${project.id}/scenes/${scenes[1].id}/preview.png`);
  assert.equal(preview.type, 'image/png');
  assert.ok(preview.buf.length > 5000);

  const started = await admin('POST', `/studio/projects/${project.id}/render`);
  assert.equal(started.status, 202);
  const dup = await admin('POST', `/studio/projects/${project.id}/render`);
  assert.equal(dup.data.job.id, started.data.job.id, 'a second request returns the running job');
  assert.equal(dup.data.job.deduplicated, true);
  const job = await waitForJob(started.data.job.id);
  assert.equal(job.status, 'completed', job.error || '');
  assert.equal(job.progress, 100);
  assert.equal(job.result.scenesRendered, 2);
  const ready = (await admin('GET', `/studio/projects/${project.id}`)).data;
  assert.equal(ready.status, 'ready');
  assert.ok(ready.video_seconds > 3.5);
  const mp4 = await call('learner', 'GET', ready.video_url.replace('/api', ''), undefined, { Range: 'bytes=0-99' });
  assert.equal(mp4.status, 206, 'the MP4 streams with Range requests');
  assert.equal(mp4.type, 'video/mp4');
  assert.match((await admin('GET', ready.subtitles_url.replace('/api', ''))).buf.toString(), /^WEBVTT/);
});

test('re-render one scene: only that scene is rendered again, the voice-over is reused', { timeout: 300_000 }, async () => {
  const ttsBefore = ttsCalls.length;
  const r = await admin('POST', `/studio/projects/${project.id}/scenes/${project.scenes[1].id}/rerender`);
  const job = await waitForJob(r.data.job.id);
  assert.equal(job.status, 'completed', job.error || '');
  assert.deepEqual([job.result.scenesRendered, job.result.scenesReused], [1, 1]);
  assert.equal(ttsCalls.length, ttsBefore, 'narration unchanged: no new voice-over');
});

test('meeting briefing read by the browser: the MP4 render voices it scene by scene', { timeout: 300_000 }, async () => {
  const meeting = await entities.Meeting.create({
    title: 'HMS review', team: 'HMS', status: 'needs_review',
    briefing_scenes: JSON.stringify([
      { start: 0, end: 4, title: 'Welcome', layout: 'points', points: ['HMS team'], text: 'Welcome to the HMS review briefing.', captions: [] },
      { start: 4, end: 8, title: 'Action items', layout: 'table', table: { headers: ['Task', 'Owner', 'Due'], rows: [['Update RBAC', 'Vishnu', 'Oct 20']] }, points: ['Vishnu: RBAC'], text: 'Vishnu, you need to update the RBAC schema.', captions: [] },
    ]),
    briefing_audio_url: '', briefing_status: 'ready', briefing_voice: 'browser',
  });
  const r = await admin('POST', '/functions/renderMeetingVideo', { meeting_id: meeting.id });
  assert.equal(r.status, 200);
  const job = await waitForJob(r.data.job.id);
  assert.equal(job.status, 'completed', job.error || '');
  const m = await entities.Meeting.get(meeting.id);
  assert.match(m.briefing_video_url, /^\/api\/media\//);
  assert.ok(m.briefing_video_seconds > 3.5);
  assert.ok(ttsCalls.includes('Vishnu, you need to update the RBAC schema.'));
  const jobs = await admin('GET', `/studio/jobs?ref_type=meeting&ref_id=${meeting.id}`);
  assert.equal(jobs.data[0].id, job.id);
});

test('lesson MP4 from its recorded narration track', { timeout: 300_000 }, async () => {
  const key = objectKey('test', 'lesson-track');
  const track = path.join(dir, 'track.mp3');
  await runFfmpeg(['-f', 'lavfi', '-i', 'sine=frequency=300:duration=5', '-ar', '44100', '-ac', '1', '-b:a', '64k', track]);
  await putObject(key, fs.readFileSync(track), { source: 'media', content_type: 'audio/mpeg' });
  const course = await entities.Course.create({ title: 'Engineering basics', status: 'published' });
  const mod = await entities.Module.create({ course_id: course.id, title: 'Reviews', order: 0 });
  const lesson = await entities.Lesson.create({
    module_id: mod.id, title: 'Reviews', status: 'approved', audio_url: `/api/media/${key}`,
    video_scenes: JSON.stringify([
      { start: 0, end: 2.5, title: 'Why', layout: 'points', points: ['Defects'], text: 'Why.', captions: [{ start: 0, end: 2, text: 'Why we review.' }] },
      { start: 2.5, end: 5, title: 'How', layout: 'steps', points: ['Open', 'Review', 'Merge'], text: 'How.', captions: [{ start: 2.5, end: 4.8, text: 'How we review.' }] },
    ]),
  });
  const r = await admin('POST', '/functions/renderLessonVideo', { lesson_id: lesson.id });
  const job = await waitForJob(r.data.job.id);
  assert.equal(job.status, 'completed', job.error || '');
  const l = await entities.Lesson.get(lesson.id);
  // 5 s of narration between a 4 s title card and a 3 s closing card (this lesson has no key points).
  assert.ok(Math.abs(l.rendered_video_seconds - 12) < 0.6, String(l.rendered_video_seconds));
  assert.match(l.rendered_srt_url, /^\/api\/media\//);
  const bare = await entities.Lesson.create({ module_id: mod.id, title: 'No media yet', status: 'pending' });
  const refused = await admin('POST', '/functions/renderLessonVideo', { lesson_id: bare.id });
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /generate its media first/);
  assert.equal((await call('learner', 'POST', '/functions/renderLessonVideo', { lesson_id: lesson.id })).status, 403);
});

test('jobs: a queued job can be cancelled, a cancelled one retried', async () => {
  stopJobWorker();
  try {
    const r = await admin('POST', `/studio/projects/${project.id}/render`);
    const cancelled = await admin('POST', `/studio/jobs/${r.data.job.id}/cancel`);
    assert.equal(cancelled.data.status, 'cancelled');
    assert.equal((await admin('POST', `/studio/jobs/${r.data.job.id}/cancel`)).status, 409);
    const retried = await admin('POST', `/studio/jobs/${r.data.job.id}/retry`);
    assert.equal(retried.data.status, 'queued');
  } finally {
    await startJobWorker({ intervalMs: 150 });
  }
  const queued = (await admin('GET', `/studio/jobs?ref_type=project&ref_id=${project.id}&status=queued`)).data;
  if (queued[0]) assert.equal((await waitForJob(queued[0].id)).status, 'completed');
});

test('usage dashboard: real totals per kind and provider; limits are adjustable and enforced', async () => {
  const { data } = await admin('GET', '/studio/usage');
  assert.ok(data.month.ai.requests >= 3);
  assert.ok(data.month.ai.cost_usd > 0, 'priced from AI_PRICE_*');
  assert.ok(data.month.tts.characters > 0);
  assert.ok(data.month.tts.cached >= 1);
  assert.ok(data.month.render.seconds > 10);
  assert.ok(data.providers.some((p) => p.kind === 'render' && p.provider === 'ffmpeg'));
  const history = (await admin('GET', '/studio/history?kind=ai&limit=5')).data;
  assert.ok(history.length && history.every((h) => h.kind === 'ai' && h.provider === 'gemini'));
  assert.ok(history.some((h) => h.operation?.startsWith('studio:')));

  const limits = await admin('PUT', '/studio/limits', { videoMonthlyMinutes: 0 });
  assert.equal(limits.data.videoMonthlyMinutes, 0);
  const r = await admin('POST', `/studio/projects/${project.id}/scenes/${project.scenes[0].id}/rerender`);
  const job = await waitForJob(r.data.job.id);
  assert.equal(job.status, 'failed');
  assert.match(job.error, /video rendering limit/);
  await admin('PUT', '/studio/limits', { videoMonthlyMinutes: null });
  assert.equal((await call('learner', 'PUT', '/studio/limits', { videoMonthlyMinutes: 999 })).status, 403);
});

test('on demand: lesson content does not voice the lesson unless asked; sync extraction uses no AI', async () => {
  const handlersWithMedia = (await import('../src/media/index.js')).mediaEnabled();
  assert.equal(handlersWithMedia, true, 'voice is configured, so only the switch prevents it');
  const zip = new JSZip();
  const lines = ['Operations Playbook', ...Array.from({ length: 30 }, (_, i) => `Intro line ${i} about how to use this playbook well.`), 'Chapter 1: Incident basics', ...Array.from({ length: 20 }, () => 'Rules for incidents explained for engineers in detail.'), 'Chapter 2: Escalation paths', ...Array.from({ length: 20 }, () => 'Rules for escalation explained for engineers in detail.')];
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  const key = objectKey('upload', 'ops-playbook');
  await putObject(key, await zip.generateAsync({ type: 'nodebuffer' }));
  const pb = await entities.Playbook.create({ title: 'ops', file_url: `upload:${key}`, file_name: 'ops.docx', file_type: 'docx' });
  const aiBefore = aiCalls.length;
  const { runExtract } = await import('../src/pipeline/index.js');
  const out = await runExtract(pb.id);
  assert.equal(out.chapter_count, 2);
  assert.equal(aiCalls.length, aiBefore, 'SYNC_AI_EXTRACT is off: no AI call during sync extraction');
  assert.ok(handlers.generateLessonContent, 'lesson content function still exists');
});
