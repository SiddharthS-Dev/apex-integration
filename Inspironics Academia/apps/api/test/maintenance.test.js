import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Fixes for: the batch estimate counting failed attempts, temp files landing on a full system drive,
// and voice-over being silently unavailable.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-maint-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  TEMP_PROCESSING_DIR: path.join(dir, 'proc-tmp'), MEDIA_PROVIDER: 'gemini', GEMINI_API_KEY: '', AI_ENABLED: 'false',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { recordGeneration } = await import('../src/usage/log.js');
const { runWithGeneration } = await import('../src/usage/context.js');
const { measuredLessonCost } = await import('../src/studio/routes.js');
const { setupProcessTemp, assertTempSpace } = await import('../src/lib/tempEnv.js');
const { mediaUnavailableReason } = await import('../src/media/index.js');

before(async () => { await migrate(await getDb()); });
after(async () => {
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the measured estimate uses each lesson\'s final successful request, not its failed or retried attempts', async () => {
  const lesson = { id: 'L1', teaching_script: 'x', audio_url: '/api/media/a' };
  const log = (entry) => runWithGeneration({ refType: 'lesson', refId: 'L1' }, () => recordGeneration(entry));
  await log({ kind: 'ai', operation: 'generateLessonContent', provider: 'gemini', status: 'ok', cost_usd: 0.03 }); // rejected by the quality gate
  await log({ kind: 'ai', operation: 'generateLessonContent', provider: 'gemini', status: 'error', cost_usd: null });
  await new Promise((r) => setTimeout(r, 5));
  await log({ kind: 'ai', operation: 'generateLessonContent', provider: 'gemini', status: 'ok', cost_usd: 0.04 }); // the one saved
  await log({ kind: 'ai', operation: 'generateLessonMedia', provider: 'gemini', status: 'ok', cost_usd: 0.03 });
  await log({ kind: 'tts', operation: 'generateLessonMedia', provider: 'gemini', status: 'ok', cost_usd: 0.01 });
  await log({ kind: 'tts', operation: 'generateLessonMedia', provider: 'gemini', status: 'ok', cost_usd: 0.02 });
  const m = await measuredLessonCost([lesson, { id: 'L2', teaching_script: '' }]);
  assert.equal(m.content, 0.04);
  assert.equal(+m.media.toFixed(4), 0.06);
  assert.equal(m.content_samples, 1);
  assert.equal((await db().query('SELECT count(*) AS n FROM generation_log'))[0].n, 6);
});

test('TEMP_PROCESSING_DIR becomes the temp folder of the whole process and its child processes', () => {
  const info = setupProcessTemp();
  const want = path.join(dir, 'proc-tmp');
  assert.equal(info.configured, true);
  assert.ok(fs.existsSync(want));
  for (const name of ['TMP', 'TEMP', 'TMPDIR']) assert.equal(process.env[name], want);
  assert.equal(path.resolve(os.tmpdir()), path.resolve(want));
  assert.ok(info.free_mb == null || info.free_mb > 0);
});

test('a render stops early with a clear message when the temp folder is nearly full', () => {
  assert.doesNotThrow(() => assertTempSpace(1));
  assert.throws(() => assertTempSpace(Number.MAX_SAFE_INTEGER), (e) => e.status === 507 && /Not enough free disk space/.test(e.message));
});

test('voice-over that is configured but cannot work says why', () => {
  assert.match(mediaUnavailableReason(), /GEMINI_API_KEY is not set/);
});

test('a lesson is complete only when every field the page shows is filled; incomplete ones are generated again', async () => {
  const { selectLessons, isComplete, missingFields, lastQuotaReset } = await import('../src/pipeline/courseContent.js');
  const full = { id: 'a', status: 'pending_review', video_title: 'T', teaching_script: 'S', summary: 'Sum', key_points: '- k', examples: '- e' };
  const blankSummary = { ...full, id: 'b', summary: '  ' };
  const none = { id: 'c', status: 'pending' };
  const approvedPartial = { ...full, id: 'd', status: 'approved', examples: '' };
  assert.equal(isComplete(full), true);
  assert.deepEqual(missingFields(blankSummary), ['summary']);
  assert.deepEqual(selectLessons([full, blankSummary, none, approvedPartial]).map((l) => l.id), ['b', 'c']);
  assert.deepEqual(selectLessons([full, approvedPartial], { lessonIds: ['d'] }).map((l) => l.id), ['d'], 'an approved lesson only when asked for');
  // The daily quota resets at midnight Pacific; 08:00 UTC is always after it.
  assert.equal(lastQuotaReset(new Date('2026-11-12T05:00:00Z')).toISOString(), '2026-11-11T08:00:00.000Z');
  assert.equal(lastQuotaReset(new Date('2026-11-12T09:00:00Z')).toISOString(), '2026-11-12T08:00:00.000Z');
});

test('the quality gate refuses a lesson with an empty summary, examples or too few key points', async () => {
  const { assessLessonQuality } = await import('../src/pipeline/lessonQuality.js');
  const codes = (c) => assessLessonQuality(c, '').issues.filter((i) => i.severity === 'error').map((i) => i.code);
  const base = { video_title: 'T', teaching_script: 'word '.repeat(10), questions: [], flashcards: [] };
  const errs = codes({ ...base, summary: '', key_points: '- one\n- two', examples: '' });
  for (const code of ['summary', 'key_points', 'examples']) assert.ok(errs.includes(code), code);
  assert.ok(!codes({ ...base, summary: 'One. Two. Three.', key_points: '- a\n- b\n- c\n- d\n- e', examples: '- x' }).some((c) => ['summary', 'key_points', 'examples'].includes(c)));
});
