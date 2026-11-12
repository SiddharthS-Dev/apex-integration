import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Security boundaries found in the audit, end to end over HTTP on a throwaway database:
//  - a learner cannot record a final-test pass themselves (only submitFinalTest does);
//  - a lesson's video follows the lesson's read rule (no video of an unapproved lesson);
//  - the CORS preflight allows the PUT routes the studio uses.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-security-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  APP_ORIGIN: 'http://web.example',
});
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    return { status: res.status, data };
  };
  const ok = async (method, url, body) => {
    const r = await call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, ok, create: (e, d) => ok('POST', `/entities/${e}`, d) };
}
const q = (query) => `?q=${encodeURIComponent(JSON.stringify(query))}`;

const admin = client();
const learner = client();
let learnerId;
let w;

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await admin.ok('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
  learnerId = (await learner.ok('POST', '/auth/register', { email: 'lee@example.com', password: 'Learner-pass-123', full_name: 'Lee Learner' })).user.id;
  const playbook = await admin.create('Playbook', { title: 'SRE', file_url: 'local://x', category: 'corporate' });
  const course = await admin.create('Course', { playbook_id: playbook.id, title: 'SRE Foundations', status: 'published', category: 'corporate' });
  const mod = await admin.create('Module', { course_id: course.id, title: 'Incidents', order: 0 });
  const approved = await admin.create('Lesson', { module_id: mod.id, title: 'Paging', status: 'approved', rendered_dropbox_id: 'id:approved' });
  const draft = await admin.create('Lesson', { module_id: mod.id, title: 'Draft', status: 'pending_review', rendered_dropbox_id: 'id:draft' });
  const assessment = await admin.create('Assessment', { course_id: course.id, title: 'Final', type: 'certification', status: 'published', passing_score: 50 });
  const question = await admin.create('Question', { assessment_id: assessment.id, question_text: 'Who pages?', options: ['on-call', 'nobody'], correct_answer: 'on-call', explanation: 'The on-call engineer is paged.', status: 'approved' });
  await admin.create('Question', { lesson_id: approved.id, question_text: 'Lesson Q1?', options: ['yes', 'no'], correct_answer: 'yes', explanation: 'Because the playbook says so.', status: 'approved' });
  await admin.create('Question', { lesson_id: approved.id, question_text: 'Lesson Q2?', options: ['yes', 'no'], correct_answer: 'no', explanation: 'Because the playbook says otherwise.', status: 'approved' });
  w = { course, mod, approved, draft, question };
});

after(async () => {
  server?.close();
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a learner cannot record a final-test pass on their own progress', async () => {
  const forged = await learner.call('POST', '/entities/CourseProgress', { user_id: learnerId, course_id: w.course.id, final_passed: true, final_score: 100 });
  assert.equal(forged.status, 403);
  const progress = await learner.create('CourseProgress', { user_id: learnerId, course_id: w.course.id, completed_lessons: [w.approved.id], started: true });
  assert.equal((await learner.call('PATCH', `/entities/CourseProgress/${progress.id}`, { final_passed: true })).status, 403);
  assert.equal((await learner.call('PATCH', `/entities/CourseProgress/${progress.id}`, { final_score: 90 })).status, 403);
  // Saving the record back with its unchanged values still works.
  const saved = await learner.ok('PATCH', `/entities/CourseProgress/${progress.id}`, { ...progress, percentage: 50 });
  assert.equal(saved.percentage, 50);
});

test('a learner cannot write quiz attempts or chapter completion; the server records them', async () => {
  const attempt = { user_id: learnerId, course_id: w.course.id, score: 1, total: 1, percentage: 100, passed: true };
  for (const type of ['final', 'chapter', 'lesson']) {
    assert.equal((await learner.call('POST', '/entities/QuizAttempt', { ...attempt, type })).status, 403, type);
  }
  assert.equal((await learner.call('POST', '/entities/QuizAttempt/bulk', [{ ...attempt, type: 'chapter' }])).status, 403);
  const [progress] = await learner.ok('GET', `/entities/CourseProgress${q({ user_id: learnerId })}`);
  assert.equal((await learner.call('PATCH', `/entities/CourseProgress/${progress.id}`, { completed_chapters: [w.mod.id] })).status, 403);
});

test('learners read questions without their answers; admins see them', async () => {
  const mine = await learner.ok('GET', `/entities/Question${q({ lesson_id: w.approved.id })}`);
  assert.equal(mine.length, 2);
  assert.ok(mine.every((x) => !('correct_answer' in x) && !('explanation' in x) && x.options.length === 2));
  const one = await learner.ok('GET', `/entities/Question/${w.question.id}`);
  assert.ok(!('correct_answer' in one));
  assert.equal((await admin.ok('GET', `/entities/Question/${w.question.id}`)).correct_answer, 'on-call');
});

test('a lesson quiz is graded on the server and returns the review', async () => {
  const qs = await learner.ok('GET', `/entities/Question${q({ lesson_id: w.approved.id })}`);
  const answers = qs.map((x) => ({ question_id: x.id, selected: x.question_text === 'Lesson Q1?' ? 'yes' : 'no' }));
  const r = await learner.ok('POST', '/functions/submitQuiz', { type: 'lesson', lesson_id: w.approved.id, answers });
  assert.deepEqual([r.score, r.total, r.percentage, r.passed], [2, 2, 100, true]);
  assert.ok(r.answers.every((a) => a.is_correct && a.correct_answer && a.explanation));
  const recorded = await learner.ok('GET', `/entities/QuizAttempt${q({ type: 'lesson' })}`);
  assert.equal(recorded.length, 1);
  // Not one sitting of the quiz: a question left out, or one from elsewhere.
  assert.equal((await learner.call('POST', '/functions/submitQuiz', { type: 'lesson', lesson_id: w.approved.id, answers: answers.slice(1) })).status, 400);
  assert.equal((await learner.call('POST', '/functions/submitQuiz', { type: 'lesson', lesson_id: w.draft.id, answers })).status, 404, 'unapproved lesson');
});

test('a passed chapter test marks the chapter complete; a failed one does not', async () => {
  const qs = await learner.ok('GET', `/entities/Question${q({ lesson_id: w.approved.id })}`);
  const failed = await learner.ok('POST', '/functions/submitQuiz', { type: 'chapter', module_id: w.mod.id, answers: qs.map((x) => ({ question_id: x.id, selected: null })) });
  assert.equal(failed.passed, false);
  let [progress] = await learner.ok('GET', `/entities/CourseProgress${q({ user_id: learnerId })}`);
  assert.deepEqual(progress.completed_chapters || [], []);
  const answers = qs.map((x) => ({ question_id: x.id, selected: x.question_text === 'Lesson Q1?' ? 'yes' : 'no' }));
  assert.equal((await learner.ok('POST', '/functions/submitQuiz', { type: 'chapter', module_id: w.mod.id, answers })).passed, true);
  [progress] = await learner.ok('GET', `/entities/CourseProgress${q({ user_id: learnerId })}`);
  assert.deepEqual(progress.completed_chapters, [w.mod.id]);
});

test('the server still records the final test, and an admin can still correct progress', async () => {
  const graded = await learner.ok('POST', '/functions/submitFinalTest', { course_id: w.course.id, answers: [{ question_id: w.question.id, selected: 'on-call' }] });
  assert.equal(graded.passed, true);
  assert.deepEqual(graded.answers, [{ question_id: w.question.id, selected: 'on-call', correct_answer: 'on-call', explanation: 'The on-call engineer is paged.', is_correct: true, marks: 1 }]);
  const [progress] = await admin.ok('GET', `/entities/CourseProgress${q({ user_id: learnerId })}`);
  assert.equal(progress.final_passed, true);
  assert.equal((await learner.ok('GET', `/entities/QuizAttempt${q({ type: 'final' })}`)).length, 1);
  assert.equal((await admin.ok('PATCH', `/entities/CourseProgress/${progress.id}`, { final_passed: false })).final_passed, false);
});

test('a lesson video follows the lesson read rule', async () => {
  assert.equal((await learner.call('GET', `/outputs/lesson/${w.draft.id}/video`)).status, 404, 'unapproved lesson: not found for a learner');
  // The approved lesson (and any lesson for an admin) passes the check and reaches Dropbox, which is
  // not connected here, so it fails later with a different error than "not found".
  assert.notEqual((await learner.call('GET', `/outputs/lesson/${w.approved.id}/video`)).status, 404);
  assert.notEqual((await admin.call('GET', `/outputs/lesson/${w.draft.id}/video`)).status, 404);
});

test('the CORS preflight allows PUT for the web app origin', async () => {
  const r = await fetch(`${base}/api/studio/limits`, { method: 'OPTIONS', headers: { Origin: 'http://web.example', 'Access-Control-Request-Method': 'PUT' } });
  assert.equal(r.status, 204);
  assert.match(r.headers.get('access-control-allow-methods'), /\bPUT\b/);
});
