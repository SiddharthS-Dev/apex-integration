import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// End to end through the HTTP API on a throwaway SQLite database: review queue, notifications on
// publish, the email outbox, certificate issuing and the recertification round trip.
// Config is read at import time, so the environment is set before anything from src/ loads.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-retention-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
});
const silence = console.log;
console.log = () => {}; // the request log and the log email transport

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');
const { store } = await import('../src/repo/store.js');
const { openRecertifications, utcToday } = await import('@academy/shared');

let server;
let base;
const today = utcToday();

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
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data };
  };
  const ok = async (method, url, body) => {
    const r = await call(method, url, body);
    assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return {
    call,
    ok,
    fn: (name, payload = {}) => ok('POST', `/functions/${name}`, payload),
    create: (entity, data) => ok('POST', `/entities/${entity}`, data),
    list: (entity, q = {}) => ok('GET', `/entities/${entity}?q=${encodeURIComponent(JSON.stringify(q))}`),
  };
}

const waitFor = async (check, ms = 3000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await check();
    if (v || Date.now() > end) return v;
    await new Promise((r) => { setTimeout(r, 50); });
  }
};

const admin = client();
const learner = client();
let learnerId;
let world;

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;

  await admin.ok('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
  learnerId = (await learner.ok('POST', '/auth/register', { email: 'lee@example.com', password: 'Learner-pass-123', full_name: 'Lee Learner' })).user.id;

  const playbook = await admin.create('Playbook', { title: 'SRE Playbook', file_url: 'local://x', recert_grace_days: 21 });
  await admin.create('PlaybookVersion', { playbook_id: playbook.id, version_label: 'v1' });
  const course = await admin.create('Course', { playbook_id: playbook.id, title: 'SRE Foundations', status: 'pending_review' });
  const mod = await admin.create('Module', { course_id: course.id, title: 'Incidents', order: 0 });
  const lesson = await admin.create('Lesson', { module_id: mod.id, title: 'Paging', status: 'approved', source_chapter: 'Incident Response' });
  for (let i = 0; i < 3; i++) await admin.create('Flashcard', { lesson_id: lesson.id, front: `Q${i}`, back: `A${i}`, status: 'approved' });
  await admin.create('Flashcard', { lesson_id: lesson.id, front: 'draft', back: 'draft', status: 'pending_review' });
  const assessment = await admin.create('Assessment', { course_id: course.id, title: 'Final', type: 'certification', status: 'published', passing_score: 50 });
  const question = await admin.create('Question', { assessment_id: assessment.id, question_text: 'Who pages?', options: ['on-call', 'nobody'], correct_answer: 'on-call', status: 'approved' });
  world = { playbook, course, lesson, question };
});

after(async () => {
  server?.close();
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('review queue and review logging, with RLS on the log', async () => {
  await learner.create('CourseProgress', { user_id: learnerId, course_id: world.course.id, completed_lessons: [world.lesson.id], started: true });
  const q = await learner.fn('getReviewQueue', { today });
  assert.equal(q.new.length, 3, 'approved cards only');
  assert.equal(q.stats.due_today, 0);

  const r = await learner.fn('submitFlashcardReview', { flashcard_id: q.new[0].id, quality: 4, today });
  assert.equal(r.schedule.interval_days, 1);
  assert.equal(r.schedule.course_id, world.course.id);
  assert.equal((await learner.list('ReviewLog')).length, 1);
  assert.equal((await learner.call('POST', '/entities/ReviewLog', { user_id: learnerId, flashcard_id: 'x', quality: 5 })).status, 403, 'logs are server-written');
  assert.equal((await learner.call('POST', '/functions/submitFlashcardReview', { flashcard_id: q.new[1].id, quality: 7 })).status, 400);
  assert.equal((await learner.fn('getReviewQueue', { today })).new.length, 2);
});

test('publishing a course notifies learners in-app and by email (outbox)', async () => {
  await admin.ok('PATCH', `/entities/Course/${world.course.id}`, { status: 'published', published: true });
  const notes = await waitFor(async () => {
    const list = await learner.list('Notification');
    return list.length ? list : null;
  });
  assert.equal(notes[0].kind, 'course_published');
  assert.equal(notes[0].link, `/courses/${world.course.id}`);
  await learner.ok('PATCH', `/entities/Notification/${notes[0].id}`, { read: true });

  const sent = await waitFor(async () => {
    const s = await admin.ok('GET', '/notifications/email/status');
    return s.recent.some((m) => m.kind === 'course_published' && m.to_email === 'lee@example.com' && m.status === 'sent') ? s : null;
  });
  assert.ok(sent, 'course_published email was delivered by the log transport');
  assert.equal(sent.provider, 'log');
  assert.equal(sent.configured, false);
  assert.equal((await learner.call('GET', '/notifications/email/status')).status, 403);
});

test('opting out of an email kind still leaves the in-app notification', async () => {
  await learner.create('NotificationPreference', { user_id: learnerId, certificates: false });
  const result = await learner.fn('submitFinalTest', { course_id: world.course.id, answers: [{ question_id: world.question.id, selected: 'on-call' }] });
  assert.equal(result.passed, true);
  world.certId = result.certificate_id;

  const [cert] = await learner.list('Certificate');
  assert.deepEqual([cert.status, cert.playbook_id, cert.playbook_version], ['valid', world.playbook.id, 'v1']);
  const verify = await client().fn('verifyCertificate', { certificate_id: result.certificate_id });
  assert.deepEqual([verify.valid, verify.status], [true, 'valid']);

  const notes = await learner.list('Notification', { kind: 'certificate_issued' });
  assert.equal(notes.length, 1);
  const status = await admin.ok('GET', '/notifications/email/status');
  assert.ok(!status.recent.some((m) => m.kind === 'certificate_issued'), 'no email when the preference is off');
});

test('recertification: playbook change → updated course published → learner renews', async () => {
  const changes = { added: [], removed: [], modified: [{ title: 'Incident Response', similarity: 0.3 }], unchanged: 2, significant: true };
  const opened = await openRecertifications(store, { playbook: world.playbook, fromVersion: 'v1', toVersion: 'v2', changes });
  assert.deepEqual(opened, { opened: 1, updated: 0 });
  assert.equal((await client().fn('verifyCertificate', { certificate_id: world.certId })).status, 'recert_required');

  // The rebuilt course from the new version.
  const v2 = await admin.create('Course', { playbook_id: world.playbook.id, title: 'SRE Foundations v2', status: 'pending_review' });
  const mod = await admin.create('Module', { course_id: v2.id, title: 'Incidents', order: 0 });
  const lesson = await admin.create('Lesson', { module_id: mod.id, title: 'Paging v2', status: 'approved', source_chapter: 'Incident Response' });
  const assessment = await admin.create('Assessment', { course_id: v2.id, title: 'Final', type: 'certification', status: 'published', passing_score: 50 });
  const question = await admin.create('Question', { assessment_id: assessment.id, question_text: 'Who pages now?', options: ['on-call', 'nobody'], correct_answer: 'on-call', status: 'approved' });
  await admin.ok('PATCH', `/entities/Course/${world.course.id}`, { status: 'archived', published: false });
  await admin.ok('PATCH', `/entities/Course/${v2.id}`, { status: 'published', published: true });

  const [rc] = await waitFor(async () => {
    const list = await learner.fn('getMyRecertifications', { today });
    return list[0]?.status === 'pending' ? list : null;
  });
  assert.equal(rc.course.id, v2.id);
  assert.equal(rc.days_left, 21);
  assert.deepEqual(rc.delta_lessons.map((l) => l.id), [lesson.id]);
  assert.ok((await learner.list('Notification', { kind: 'recert_required' })).length === 1);

  const report = await admin.fn('getComplianceReport');
  assert.equal(report.kpis.recert_required, 1);
  assert.equal(report.kpis.open_recerts, 1);
  assert.equal((await learner.call('POST', '/functions/getComplianceReport', {})).status, 403);

  const result = await learner.fn('submitFinalTest', { course_id: v2.id, answers: [{ question_id: question.id, selected: 'on-call' }] });
  assert.notEqual(result.certificate_id, world.certId);
  const old = await client().fn('verifyCertificate', { certificate_id: world.certId });
  assert.deepEqual([old.status, old.superseded_by], ['superseded', result.certificate_id]);
  const [done] = await learner.fn('getMyRecertifications', { today });
  assert.equal(done.status, 'completed');
  assert.equal((await admin.fn('getComplianceReport')).kpis.compliance_rate, 100);
});

test('password reset and the admin compliance run go through the outbox and jobs', async () => {
  await client().ok('POST', '/auth/reset-password-request', { email: 'lee@example.com' });
  const status = await waitFor(async () => {
    const s = await admin.ok('GET', '/notifications/email/status');
    return s.recent.some((m) => m.kind === 'password_reset') ? s : null;
  });
  assert.ok(status, 'reset email queued');

  const run = await admin.fn('runComplianceChecks');
  assert.equal(run.today, today);
  assert.equal(typeof run.review_reminders, 'number');
  const invite = await admin.ok('POST', '/auth/invite', { email: 'new@example.com' });
  assert.equal(invite.email_sent, false, 'log transport: the admin hands over the temporary password');
  assert.ok(invite.temporary_password);
});
