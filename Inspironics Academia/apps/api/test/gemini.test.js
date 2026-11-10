import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

// Google Gemini as the primary provider, with a mocked Gemini API (no paid calls): text + structured
// output, error handling (missing/invalid key, rate limits, timeouts, malformed output), cost
// estimates and the budget, Gemini speech (WAV → MP3, chunking, cache, cost), the course batch
// (sample first, resume, never overwrite, failures, budget stop, dedupe, confirm + estimate) and the
// intro / closing cards of lesson videos.

const realFetch = globalThis.fetch;
const calls = [];
const mock = { mode: 'ok', rateLimitOnce: false, rejectStyle: false, overloadedCalls: 0, runawayOnce: false, incompleteOnce: false, ttsLimited: 0, ttsDaily: false, textDaily: false };
const DAILY = (model) => `You exceeded your current quota, please check your plan and billing details. For more information on this error, head to: https://aistudio.google.com/docs/rate-limits. To monitor your current usage, head to: https://ai.dev/rate-limit. 
* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 10, model: ${model}, description: Generate content requests per day limit exceeded on Free Tier.`;

// 24 kHz mono 16-bit WAV of `seconds` of a quiet tone.
function wav(seconds = 1) {
  const rate = 24000;
  const samples = Math.round(rate * seconds);
  const buf = Buffer.alloc(44 + samples * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(samples * 2, 40);
  for (let i = 0; i < samples; i++) buf.writeInt16LE(Math.round(Math.sin(i / 8) * 3000), 44 + i * 2);
  return buf;
}

const ok = (data) => new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
const fail = (status, message, extra = {}) => new Response(JSON.stringify({ error: { code: status, message, ...extra } }), { status, headers: { 'content-type': 'application/json' } });
const words = (n, w = 'concept') => Array.from({ length: n }, (_, i) => `${w}${i % 7}`).join(' ');

function lessonJson(prompt) {
  const title = (/^LESSON: (.+)$/m.exec(prompt) || [])[1] || 'Lesson';
  if (/Broken/.test(title)) return { video_title: title, teaching_script: 'Too short.', summary: 's', examples: [], key_points: [], mcqs: [], flashcards: [] };
  const mcq = (n) => ({ question_text: `${title}: question ${n}?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correct_answer: 'Gamma', explanation: 'Per the playbook.', difficulty: 'intermediate', cognitive_level: 'application', source_section: title });
  return {
    video_title: `${title} explained`,
    teaching_script: `In this lesson on ${title} we follow the playbook. ${words(420)}.`,
    summary: `A summary of ${title}.`,
    examples: ['A worked example from operations.'],
    key_points: ['Keep evidence for every change', 'Advise before acting', 'Measure what matters'],
    mcqs: [1, 2, 3, 4, 5, 6].map(mcq),
    flashcards: [1, 2, 3, 4, 5].map((n) => ({ front: `${title} term ${n}`, back: `Meaning ${n}.`, difficulty: 'basic', source_section: title })),
  };
}

function storyboardJson(prompt) {
  const n = Number((/split into (\d+) consecutive parts/.exec(prompt) || [])[1]) || 1;
  return { scenes: Array.from({ length: n }, (_, i) => ({ title: `Scene ${i + 1}`, layout: 'points', source_ref: 'Section', points: ['First idea', 'Second idea'] })) };
}

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!u.startsWith('https://generativelanguage.googleapis.com/')) return realFetch(url, init);
  const body = JSON.parse(init.body);
  const key = init.headers?.['x-goog-api-key'];
  const model = decodeURIComponent((/models\/([^:]+):generateContent/.exec(u) || [])[1] || '');
  calls.push({ model, body, key, url: u });
  if (mock.mode === 'badkey') return fail(400, 'API key not valid. Please pass a valid API key.', { status: 'INVALID_ARGUMENT' });
  if (mock.mode === 'forbidden') return fail(403, 'Permission denied.', { status: 'PERMISSION_DENIED' });
  if (mock.mode === 'quota') return fail(429, 'Resource has been exhausted (e.g. check quota).', { status: 'RESOURCE_EXHAUSTED' });
  if (mock.rateLimitOnce) { mock.rateLimitOnce = false; return fail(429, 'Resource has been exhausted.'); }
  if (mock.overloadedCalls > 0) { mock.overloadedCalls--; return fail(503, 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.', { status: 'UNAVAILABLE' }); }
  if (mock.mode === 'hang') {
    return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }))));
  }
  if (model.includes('-tts') && mock.ttsDaily) return fail(429, DAILY(model));
  if (!model.includes('-tts') && mock.textDaily) return fail(429, DAILY(model));
  if (model.includes('-tts') && mock.ttsLimited > 0) { mock.ttsLimited--; return fail(429, 'Quota exceeded for metric: generate_requests_per_minute'); }
  if (model.includes('-tts')) {
    if (mock.rejectStyle && body.contents[0].parts[0].speech_metadata) return fail(400, 'Invalid JSON payload received. Unknown name "speech_metadata"');
    const text = body.contents[0].parts[0].text;
    const seconds = Math.max(0.4, text.length / 60);
    return ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/wav', data: wav(seconds).toString('base64') } }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: Math.ceil(text.length / 4), candidatesTokenCount: Math.round(seconds * 25) } });
  }
  const prompt = body.contents[0].parts.at(-1).text;
  let text;
  if (mock.mode === 'garbage') text = 'this is not json';
  else if (/^Design the on-screen slides/.test(prompt)) text = JSON.stringify(storyboardJson(prompt));
  else if (/TEACHING OBJECTIVE/.test(prompt) && mock.runawayOnce) { mock.runawayOnce = false; text = JSON.stringify({ video_title: `Vision ${'guide reference text '.repeat(60)} and the whole lesson inside the title` }); }
  else if (/TEACHING OBJECTIVE/.test(prompt) && mock.incompleteOnce) { mock.incompleteOnce = false; const j = lessonJson(prompt); j.mcqs = j.mcqs.map((q) => ({ question_text: q.question_text, source_section: q.source_section })); text = JSON.stringify(j); }
  else if (/TEACHING OBJECTIVE/.test(prompt)) text = JSON.stringify(lessonJson(prompt));
  else if (body.generationConfig.responseFormat) text = JSON.stringify({ title: 'From Gemini', items: ['x'] });
  else text = 'Plain answer from Gemini';
  return ok({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 2000, candidatesTokenCount: 4000, thoughtsTokenCount: 1000 }, modelVersion: model });
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-gemini-'));
// AI_PROVIDER and GEMINI_MODEL are deliberately unset: Gemini and gemini-3.8-flash are the defaults.
delete process.env.AI_PROVIDER;
delete process.env.GEMINI_MODEL;
delete process.env.AI_FALLBACK_PROVIDER;
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  AI_ENABLED: 'true', GEMINI_API_KEY: 'gm-secret-test-key', MEDIA_PROVIDER: 'gemini', GEMINI_TIMEOUT_SECONDS: '1',
  TEMP_PROCESSING_DIR: path.join(dir, 'tmp'), AI_BATCH_CONCURRENCY: '1',
  GEMINI_MAX_ATTEMPTS: '2', AI_BATCH_RETRY_DELAY_SECONDS: '0', GEMINI_TTS_RATE_LIMIT_WAIT_SECONDS: '0',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const ai = await import('../src/ai/index.js');
const { config } = await import('../src/config.js');
const { setLimits } = await import('../src/usage/limits.js');
const { aiCost, geminiTtsCost } = await import('../src/usage/pricing.js');
const { synthesize } = await import('../src/media/index.js');
const { decodeGeminiAudio } = await import('../src/media/providers/gemini-tts.js');
const { entities } = await import('../src/repo/entities.js');
const { runCourseBatch, startCourseBatch, courseProgress } = await import('../src/pipeline/courseContent.js');
const { createApp } = await import('../src/app.js');
const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } };
const logRows = () => db().query('SELECT * FROM generation_log ORDER BY created_at');

let server;
let base;
let cookie = '';
async function call(method, url, body) {
  const res = await realFetch(`${base}/api${url}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data = text;
  try { data = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, data };
}

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123' });
});
after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- provider ------------------------------------------------------------------------------------

test('Gemini is the default provider and model; no fallback; the key is never exposed', async () => {
  assert.deepEqual(ai.describeAiConfig(), { provider: 'gemini', enabled: true, ready: true, model: 'gemini-3.8-flash', fallback: null, fallbackReady: null });
  assert.equal(config.tts.gemini.model, 'gemini-3.8-flash-tts');
  assert.equal(ai.aiUnavailableReason(), null);
  const cfg = await call('POST', '/auth/login', { email: 'admin@example.com', password: 'Admin-pass-123' }).then(() => call('GET', '/studio/config'));
  assert.equal(cfg.data.ai.provider, 'gemini');
  assert.equal(cfg.data.ai.key_configured, true);
  assert.equal(cfg.data.voice.model, 'gemini-3.8-flash-tts');
  assert.ok(!JSON.stringify(cfg.data).includes('gm-secret-test-key'));
  const pub = await call('GET', '/config');
  assert.ok(!JSON.stringify(pub.data).includes('gm-secret-test-key'));
});

test('without GEMINI_API_KEY, AI is off with a reason naming the setting', () => {
  const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const a = await import('./src/ai/index.js'); console.log(JSON.stringify({ on: a.aiEnabled(), why: a.aiUnavailableReason() }))"], {
    cwd: api, encoding: 'utf8', env: { ...process.env, GEMINI_API_KEY: '', AI_PROVIDER: 'gemini', AI_ENABLED: 'true', LOG_LEVEL: 'error' },
  });
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(out.on, false);
  assert.match(out.why, /AI_PROVIDER=gemini but GEMINI_API_KEY is not set/);
});

test('structured output uses the documented responseFormat; usage and cost are logged at the list price', async () => {
  const out = await ai.invokeLLM({ system: 'S', prompt: 'Teach caching', schema: SCHEMA });
  assert.deepEqual(out, { title: 'From Gemini', items: ['x'] });
  const req = calls.at(-1);
  assert.equal(req.model, 'gemini-3.8-flash');
  assert.equal(req.key, 'gm-secret-test-key');
  assert.ok(!req.url.includes('gm-secret-test-key'), 'never in the URL');
  assert.deepEqual(req.body.generationConfig.responseFormat, { text: { mimeType: 'APPLICATION_JSON', schema: { ...SCHEMA, required: ['title', 'items'] } } }, 'every field required');
  assert.deepEqual(req.body.systemInstruction, { parts: [{ text: 'S' }] });
  const row = (await logRows()).at(-1);
  assert.equal(row.provider, 'gemini');
  assert.equal(row.input_tokens, 2000);
  assert.equal(row.output_tokens, 5000, 'thinking tokens are billed as output');
  assert.equal(row.cost_usd, aiCost('gemini', 'gemini-3.8-flash', { input_tokens: 2000, output_tokens: 5000 }));
  assert.ok(row.cost_usd > 0);
});

test('prices follow the published dates', () => {
  assert.equal(aiCost('gemini', 'gemini-3.8-flash', { input_tokens: 1e6, output_tokens: 1e6 }), 4.5, 'Nov 2026: $0.75 + $3.75');
  const { aiPrice } = { aiPrice: (m, d) => import('../src/usage/pricing.js').then((p) => p.aiPrice('gemini', m, d)) };
  return Promise.all([
    aiPrice('gemini-3.8-flash', '2027-01-15').then((p) => assert.deepEqual(p, [1.5, 7.5])),
    aiPrice('gemini-3.8-flash-001', '2026-11-10').then((p) => assert.deepEqual(p, [0.75, 3.75], 'versioned names resolve')),
    aiPrice('gemini-unknown-model', '2026-11-10').then((p) => assert.equal(p, null, 'unknown model: cost unknown, never zero')),
  ]).then(() => assert.equal(geminiTtsCost('gemini-3.8-flash-tts', { inputTokens: 1e6, outputTokens: 1e6 }, '2026-11-10'), 9.5));
});

test('a rejected or forbidden key gives a clear error and no retry with another provider', async () => {
  mock.mode = 'badkey';
  try {
    const before = calls.length;
    await assert.rejects(ai.invokeLLM({ prompt: 'Bad key', schema: SCHEMA, fresh: true }), (e) => e.status === 503 && /rejected the API key/.test(e.message) && !e.message.includes('gm-secret'));
    assert.equal(calls.length, before + 1, 'not retried');
    mock.mode = 'forbidden';
    await assert.rejects(ai.invokeLLM({ prompt: 'Forbidden', fresh: true }), /refused access \(403\)/);
  } finally {
    mock.mode = 'ok';
  }
});

test('rate limits are retried with backoff; an exhausted quota is reported clearly', async () => {
  mock.rateLimitOnce = true;
  assert.equal(await ai.invokeLLM({ prompt: 'After a 429', fresh: true }), 'Plain answer from Gemini');
  mock.mode = 'quota';
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Quota gone', fresh: true }), (e) => e.status === 429 && /rate limit reached/.test(e.message) && !e.details?.quotaDaily);
  } finally {
    mock.mode = 'ok';
  }
});

test('a request that times out is reported, not left hanging', { timeout: 30_000 }, async () => {
  mock.mode = 'hang';
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Too slow', fresh: true }), /Gemini unreachable \(timed out\)/);
  } finally {
    mock.mode = 'ok';
  }
});

test('malformed JSON is rejected, never saved', async () => {
  mock.mode = 'garbage';
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Garbage please', schema: SCHEMA, fresh: true }), /returned malformed JSON/);
  } finally {
    mock.mode = 'ok';
  }
});

test('a demand spike (503) is retried; a lasting one is reported as temporary overload', async () => {
  mock.overloadedCalls = 1;
  assert.equal(await ai.invokeLLM({ prompt: 'After a spike', fresh: true }), 'Plain answer from Gemini');
  mock.overloadedCalls = 99;
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Still busy', fresh: true }), (e) => e.status === 503 && e.details?.overloaded === true && /temporarily overloaded/.test(e.message));
  } finally {
    mock.overloadedCalls = 0;
  }
});

// ---- speech --------------------------------------------------------------------------------------

test('Gemini speech: documented request, WAV turned into MP3, cost from tokens, cached on repeat', async () => {
  const text = 'Welcome to the engineering academy. Today we learn how evidence flows through the platform.';
  const first = await synthesize(text);
  assert.equal(first.cached, false);
  const { mp3Frames } = await import('../src/media/mp3.js');
  assert.ok(mp3Frames(first.bytes).seconds > 1, 'a playable MP3 of the narration');
  const req = calls.at(-1);
  assert.equal(req.model, 'gemini-3.8-flash-tts');
  assert.deepEqual(req.body.generationConfig, { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } });
  assert.match(req.body.contents[0].parts[0].speech_metadata.style, /teaching pace/);
  const row = (await logRows()).at(-1);
  assert.equal(row.kind, 'tts');
  assert.equal(row.provider, 'gemini');
  assert.ok(row.cost_usd > 0 && row.output_tokens > 0);
  const before = calls.length;
  assert.equal((await synthesize(text)).cached, true);
  assert.equal(calls.length, before, 'the same narration is never paid for twice');
});

test('long narration is voiced in pieces and joined; a rejected style falls back to plain speech', async () => {
  const before = calls.length;
  await synthesize(`${'This sentence explains one rule of the playbook carefully. '.repeat(90)}`);
  assert.ok(calls.length - before >= 2, 'several pieces');
  mock.rejectStyle = true;
  try {
    const out = await synthesize('A short line that must still be voiced when the style is rejected.');
    assert.ok(out.bytes.length > 0);
    assert.equal(calls.at(-1).body.contents[0].parts[0].speech_metadata, undefined);
  } finally {
    mock.rejectStyle = false;
  }
});

test('a speech rate limit (requests per minute) is waited out instead of failing the narration', async () => {
  mock.ttsLimited = 3; // more than the quick retries (2 attempts here)
  const out = await synthesize('A sentence voiced after the per-minute limit clears.');
  assert.equal(out.cached, false);
  assert.ok(out.bytes.length > 0);
  assert.equal(mock.ttsLimited, 0);
});

test('a daily quota is reported as such, fails fast (no waiting) and names the limit', async () => {
  mock.ttsDaily = true;
  try {
    const before = calls.length;
    await assert.rejects(synthesize('Something new to say after the daily quota is gone.'), (e) => e.status === 429 && e.details?.quotaDaily === true && /daily quota reached for gemini-3\.8-flash-tts \(10 requests per day on the free tier\)/.test(e.message));
    assert.equal(calls.length - before, 1, 'no quick retries and no waiting for a daily quota');
  } finally {
    mock.ttsDaily = false;
  }
});

test('raw PCM audio (no WAV header) is decoded with its sample rate', () => {
  const pcm = Buffer.alloc(4800);
  assert.deepEqual(decodeGeminiAudio(pcm, 'audio/L16;rate=16000'), { pcm, rate: 16000, channels: 1 });
  assert.equal(decodeGeminiAudio(wav(0.5)).rate, 24000);
});

// ---- course batch --------------------------------------------------------------------------------

let courseId;
let lessonIds;
async function makeCourse() {
  const playbook = await entities.Playbook.create({ title: 'Ops Playbook', status: 'processed', file_url: 'upload:x', file_name: 'ops.docx' });
  await entities.Chapter.create({ playbook_id: playbook.id, number: 'Part 1', title: 'Foundations', content: `PART 1\nFoundations\n${words(200, 'evidence')}`, order: 0 });
  const course = await entities.Course.create({ title: 'Ops Course', status: 'pending_review', playbook_id: playbook.id });
  const mod = await entities.Module.create({ course_id: course.id, title: 'Foundations', order: 0 });
  const titles = ['Vision', 'Doctrine', 'Broken lesson', 'Governance', 'Evidence'];
  const lessons = [];
  for (const [i, t] of titles.entries()) {
    lessons.push(await entities.Lesson.create({ module_id: mod.id, title: t, order: i, status: 'pending', source_chapter: 'Foundations', source_section: t, teaching_objective: `Explain ${t}.`, video_type: 'concept' }));
  }
  // An already reviewed lesson: the batch must never overwrite it.
  await entities.Lesson.update(lessons[4].id, { teaching_script: 'Approved script that must stay.', status: 'approved' });
  return { course, lessons };
}

test('batch: a one-lesson sample first, then a confirmed batch that resumes, skips existing content and records failures', async () => {
  const { course, lessons } = await makeCourse();
  courseId = course.id;
  lessonIds = lessons.map((l) => l.id);

  const sample = await runCourseBatch({ course_id: courseId, limit: 1 });
  assert.deepEqual([sample.selected, sample.completed, sample.failed, sample.stopped], [1, 1, 0, null]);
  const vision = await entities.Lesson.get(lessonIds[0]);
  assert.match(vision.teaching_script, /Vision/);
  assert.ok(vision.content_generated_at);
  assert.equal((await entities.Question.filter({ lesson_id: vision.id })).length, 6);
  assert.equal((await entities.Flashcard.filter({ lesson_id: vision.id })).length, 5);
  const prompt = calls.filter((c) => /TEACHING OBJECTIVE/.test(c.body.contents[0].parts.at(-1).text)).at(-1).body.contents[0].parts.at(-1).text;
  assert.match(prompt, /evidence0 evidence1/, 'grounded in the playbook chapter text');
  const logged = (await db().query("SELECT ref_type, ref_id FROM generation_log WHERE kind = 'ai' AND status = 'ok' ORDER BY created_at DESC LIMIT 1"))[0];
  assert.deepEqual([logged.ref_type, logged.ref_id], ['lesson', vision.id], 'usage is tracked per lesson');

  // More than one lesson needs explicit confirmation; the estimate is measured from the sample.
  const ask = await call('POST', `/studio/courses/${courseId}/generate`, {});
  assert.equal(ask.status, 409);
  assert.equal(ask.data.selected, 3);
  assert.equal(ask.data.estimate.basis, 'measured');
  assert.ok(ask.data.estimate.total_usd > 0);

  const rest = await runCourseBatch({ course_id: courseId });
  assert.deepEqual([rest.selected, rest.completed, rest.failed], [3, 2, 1], 'resumes after the sample');
  assert.equal(rest.failures[0].title, 'Broken lesson');
  const broken = await entities.Lesson.get(lessonIds[2]);
  assert.match(broken.content_error, /teaching script of only/);
  assert.equal(broken.teaching_script || '', '', 'an incomplete answer is not saved');
  assert.equal((await entities.Lesson.get(lessonIds[4])).teaching_script, 'Approved script that must stay.');

  const progress = await courseProgress(courseId);
  assert.deepEqual(progress.totals.content, { completed: 4, processing: 0, failed: 1, pending: 0 });

  // Nothing left to do unless failures are retried explicitly.
  assert.equal((await runCourseBatch({ course_id: courseId })).selected, 0);
  assert.equal((await runCourseBatch({ course_id: courseId, retry_failed: true })).selected, 1);
});

test('a runaway answer (everything inside one field) is not cached or saved, and is asked for again once', async () => {
  const mod = (await entities.Module.filter({ course_id: courseId }))[0];
  const lesson = await entities.Lesson.create({ module_id: mod.id, title: 'Runaway', order: 30, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  mock.runawayOnce = true;
  const before = calls.length;
  const r = await runCourseBatch({ course_id: courseId, lesson_ids: [lesson.id] });
  assert.equal(r.completed, 1);
  assert.equal(calls.length - before, 2, 'one retry, which bypassed the cache');
  const saved = await entities.Lesson.get(lesson.id);
  assert.ok(saved.video_title.length < 150 && saved.teaching_script.length > 1000);
});

test('questions returned without options or answers are rejected as incomplete and asked for again', async () => {
  const mod = (await entities.Module.filter({ course_id: courseId }))[0];
  const lesson = await entities.Lesson.create({ module_id: mod.id, title: 'Incomplete quiz', order: 31, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  mock.incompleteOnce = true;
  const r = await runCourseBatch({ course_id: courseId, lesson_ids: [lesson.id] });
  assert.equal(r.completed, 1);
  const qs = await entities.Question.filter({ lesson_id: lesson.id });
  assert.equal(qs.length, 6);
  assert.ok(qs.every((q) => q.options.length === 4 && q.options.includes(q.correct_answer)));
  const sent = calls.filter((c) => /TEACHING OBJECTIVE/.test(c.body.contents[0].parts.at(-1).text)).at(-1).body.generationConfig.responseFormat.text.schema;
  assert.ok(sent.properties.mcqs.items.required.includes('options'));
});

test('batch: one job per course at a time; the budget stops it cleanly', async () => {
  const a = await startCourseBatch({ course_id: courseId, lesson_ids: [lessonIds[2]] });
  const b = await startCourseBatch({ course_id: courseId, lesson_ids: [lessonIds[2]] });
  assert.equal(b.id, a.id);
  assert.equal(b.deduplicated, true);
  await db().run("UPDATE jobs SET status = 'cancelled' WHERE id = ?", [a.id]);

  const extra = await entities.Lesson.create({ module_id: (await entities.Module.filter({ course_id: courseId }))[0].id, title: 'Late addition', order: 9, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  await setLimits({ aiMonthlyBudgetUsd: 0.0001 });
  try {
    const r = await runCourseBatch({ course_id: courseId, lesson_ids: [extra.id] });
    assert.match(r.stopped, /budget or usage limit/);
    assert.equal(r.completed, 0);
    assert.equal((await entities.Lesson.get(extra.id)).teaching_script || '', '');
  } finally {
    await setLimits({ aiMonthlyBudgetUsd: null });
  }
});

test('batch with narration: slides and Gemini voice-over per lesson', { timeout: 120_000 }, async () => {
  const mod = (await entities.Module.filter({ course_id: courseId }))[0];
  const lesson = await entities.Lesson.create({ module_id: mod.id, title: 'Narrated lesson', order: 10, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  const r = await runCourseBatch({ course_id: courseId, lesson_ids: [lesson.id], media: true });
  assert.equal(r.completed, 1);
  const saved = await entities.Lesson.get(lesson.id);
  assert.ok(saved.audio_url, 'narration recorded');
  assert.ok(JSON.parse(saved.video_scenes).length >= 1, 'slides aligned with the narration');
  assert.equal(saved.media_error || '', '');
});

test('batch: lasting overload stops the batch cleanly and the next run picks those lessons up again', async () => {
  const mod = (await entities.Module.filter({ course_id: courseId }))[0];
  const a = await entities.Lesson.create({ module_id: mod.id, title: 'Busy one', order: 20, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  const b = await entities.Lesson.create({ module_id: mod.id, title: 'Busy two', order: 21, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  const c = await entities.Lesson.create({ module_id: mod.id, title: 'Busy three', order: 22, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  mock.overloadedCalls = 99;
  try {
    const r = await runCourseBatch({ course_id: courseId, lesson_ids: [a.id, b.id, c.id] });
    assert.equal(r.completed, 0);
    assert.equal(r.failed, 2, 'stopped after two overloaded lessons in a row, the third untouched');
    assert.match(r.stopped, /overloaded right now/);
    assert.ok(r.failures.every((f) => f.temporary));
    assert.equal((await entities.Lesson.get(a.id)).content_error_retryable, true);
  } finally {
    mock.overloadedCalls = 0;
  }
  const again = await runCourseBatch({ course_id: courseId });
  assert.equal(again.completed, again.selected, 'temporary failures resume without retry_failed');
  for (const l of [a, b, c]) assert.ok(String((await entities.Lesson.get(l.id)).teaching_script || '').trim(), `${l.title} generated on the next run`);
  assert.equal((await entities.Lesson.get(a.id)).content_error_retryable, false);
});

test('batch: a daily speech quota stops narration but not content; a daily text quota stops the batch', async () => {
  const mod = (await entities.Module.filter({ course_id: courseId }))[0];
  const mk = (t, o) => entities.Lesson.create({ module_id: mod.id, title: t, order: o, status: 'pending', source_chapter: 'Foundations', teaching_objective: 'x', video_type: 'concept' });
  const a = await mk('Quota one', 40);
  const b = await mk('Quota two', 41);
  mock.ttsDaily = true;
  try {
    const r = await runCourseBatch({ course_id: courseId, lesson_ids: [a.id, b.id], media: true });
    assert.equal(r.completed, 2, 'both lessons got their content');
    assert.match(r.media, /daily quota reached/);
    assert.match((await entities.Lesson.get(a.id)).media_error, /daily quota/);
    assert.equal((await entities.Lesson.get(b.id)).media_error || '', '', 'narration not attempted again after the quota');
  } finally {
    mock.ttsDaily = false;
  }
  const c = await mk('Quota three', 42);
  const d = await mk('Quota four', 43);
  mock.textDaily = true;
  try {
    const r = await runCourseBatch({ course_id: courseId, lesson_ids: [c.id, d.id] });
    assert.equal(r.completed, 0);
    assert.match(r.stopped, /daily quota reached for gemini-3.8-flash .*resumes where it stopped/);
    assert.equal((await entities.Lesson.get(c.id)).content_error_retryable, true, 'picked up again after the reset');
    assert.equal((await entities.Lesson.get(d.id)).content_attempts || 0, 0, 'the rest was not attempted');
  } finally {
    mock.textDaily = false;
  }
  await runCourseBatch({ course_id: courseId, lesson_ids: [c.id, d.id] });
});

// ---- video cards -----------------------------------------------------------------------------------

test('lesson videos open with a title card and close with the key takeaways', async () => {
  const { lessonIntro, lessonOutro } = await import('../src/pipeline/renderVideo.js');
  const { validateManifest } = await import('../src/media/video/renderer.js');
  const intro = lessonIntro({ title: 'Twin hierarchy' }, { title: 'Digital Twins' }, { title: 'Ops Course' });
  assert.deepEqual(intro, { layout: 'cover', kicker: 'Lesson', title: 'Twin hierarchy', subtitle: ['Digital Twins', 'Ops Course'], silence: 4 });
  const outro = lessonOutro({ title: 'x', key_points: '- One\n- Two\n- Three' });
  assert.deepEqual([outro.layout, outro.title, outro.points], ['checklist', 'Key takeaways', ['One', 'Two', 'Three']]);
  assert.deepEqual(validateManifest({ scenes: [intro, outro] }), [], 'silent cards need no narration');
});

test('a silent card and a narrated scene render into one MP4 with subtitles and a thumbnail', { timeout: 300_000 }, async () => {
  const { renderVideo } = await import('../src/media/video/renderer.js');
  const audio = await synthesize('This scene is narrated so the video has a voice track to follow the title card.');
  const out = await renderVideo({
    eyebrow: 'Ops Course · Foundations',
    scenes: [
      { layout: 'cover', kicker: 'Lesson', title: 'Twin hierarchy', subtitle: ['Digital Twins', 'Ops Course'], silence: 1.5 },
      { title: 'Why it matters', layout: 'points', points: ['One', 'Two'], captions: [{ start: 0, end: 1, text: 'This scene is narrated' }], audio: { key: audio.key } },
    ],
  }, { ref: { type: 'test', id: 'cards' } });
  assert.ok(out.seconds > 1.5, `${out.seconds}s`);
  assert.ok(out.video && out.thumbnail && out.srt && out.vtt);
});
