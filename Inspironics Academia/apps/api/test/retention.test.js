import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  NEW_CARDS_PER_DAY, addDays, addMonths, buildNotification, certificateStatus, chapterChanges, complianceReport,
  emailAllowed, issueCertificate, loadReviewQueue, matchesQuery, myRecertifications, onCoursePublished,
  openRecertifications, previewIntervals, recertState, recordReview, resolveToday, reviewStats, runComplianceChecks,
  sm2, sortRecords, utcToday, waiveRecertification,
} from '@academy/shared';

// An in-memory store with the shape the shared review/recertification logic expects.
function memoryStore(tables = {}, users = []) {
  let seq = 0;
  const t = (name) => (tables[name] ||= []);
  return {
    tables,
    filter: (name, q = {}, sort, limit = 100000) => sortRecords(t(name).filter((r) => matchesQuery(r, q)), sort).slice(0, limit),
    get: (name, id) => t(name).find((r) => r.id === id) || null,
    create: (name, data) => {
      seq += 1;
      const rec = { ...data, id: `${name}-${seq}`, created_date: new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString() };
      t(name).push(rec);
      return rec;
    },
    update: (name, id, patch) => Object.assign(t(name).find((r) => r.id === id), patch),
    users: () => users,
  };
}

function recorder() {
  const sent = [];
  const keys = new Set();
  const notify = (userId, kind, data, key) => {
    if (key && keys.has(key)) return null;
    keys.add(key);
    sent.push({ userId, kind, data, key });
    return true;
  };
  return { sent, notify };
}

const TODAY = '2026-10-30';

// ---- SM-2 -----------------------------------------------------------------------------------

test('sm2 grows the interval on recall, resets it and counts a lapse on a miss', () => {
  const first = sm2({}, 4, TODAY);
  assert.deepEqual([first.reps, first.interval_days, first.due_date, first.lapses], [1, 1, '2026-10-31', 0]);
  const second = sm2(first, 4, '2026-10-31');
  assert.equal(second.interval_days, 6);
  const third = sm2(second, 5, '2026-11-06');
  assert.equal(third.interval_days, Math.round(6 * second.ease_factor));
  const missed = sm2(third, 1, '2026-11-20');
  assert.deepEqual([missed.reps, missed.interval_days, missed.lapses, missed.last_quality], [0, 1, 1, 1]);
  assert.ok(missed.ease_factor < third.ease_factor);
  assert.ok(sm2({ ease_factor: 1.3 }, 0).ease_factor >= 1.3, 'ease never drops below 1.3');
});

test('previewIntervals shows what each rating would schedule', () => {
  assert.deepEqual(previewIntervals(null), { again: 1, hard: 1, good: 1, easy: 1 });
  assert.deepEqual(previewIntervals({ reps: 1, interval_days: 1, ease_factor: 2.5 }), { again: 1, hard: 6, good: 6, easy: 6 });
});

test('resolveToday accepts the learner day only within a day of UTC', () => {
  const utc = utcToday();
  assert.equal(resolveToday(addDays(utc, 1)), addDays(utc, 1));
  assert.equal(resolveToday(addDays(utc, -1)), addDays(utc, -1));
  assert.equal(resolveToday(addDays(utc, 5)), utc);
  assert.equal(resolveToday('nonsense'), utc);
});

test('reviewStats: due, forecast, retention excludes first reviews, streak', () => {
  const schedules = [
    { due_date: '2026-10-28', interval_days: 30 }, { due_date: TODAY, interval_days: 1 },
    { due_date: '2026-11-01', interval_days: 3 }, { due_date: '2026-12-01', interval_days: 40 },
  ];
  const logs = [
    { reviewed_date: TODAY, quality: 4 }, { reviewed_date: '2026-10-29', quality: 1 },
    { reviewed_date: '2026-10-28', quality: 5 }, { reviewed_date: '2026-10-28', quality: 4, first_review: true },
    { reviewed_date: '2026-08-01', quality: 1 }, // outside 30 days
  ];
  const s = reviewStats({ schedules, logs, today: TODAY });
  assert.equal(s.due_today, 2);
  assert.equal(s.overdue, 1);
  assert.equal(s.mature, 2);
  assert.equal(s.reviewed_today, 1);
  assert.equal(s.retention_30d, 67); // 2 of 3 non-first reviews recalled
  assert.equal(s.streak, 3);
  assert.deepEqual(s.forecast.slice(0, 3).map((d) => d.count), [2, 0, 1]);
  assert.equal(s.forecast[2].date, '2026-11-01');
  assert.equal(s.forecast.length, 7);
});

// ---- review queue -----------------------------------------------------------------------------

function learningWorld() {
  const cards = Array.from({ length: 30 }, (_, i) => ({ id: `fc${i}`, lesson_id: 'L1', status: 'approved', front: `Q${i}`, back: `A${i}`, created_date: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z` }));
  return memoryStore({
    Course: [{ id: 'c1', title: 'Reliability', playbook_id: 'p1', status: 'published' }],
    Module: [{ id: 'm1', course_id: 'c1' }],
    Lesson: [{ id: 'L1', module_id: 'm1', title: 'Incidents' }, { id: 'L2', module_id: 'm1', title: 'Deploys' }],
    Flashcard: [...cards, { id: 'rejected', lesson_id: 'L1', status: 'rejected' }, { id: 'later', lesson_id: 'L2', status: 'approved' }],
    CourseProgress: [{ id: 'cp', user_id: 'u1', course_id: 'c1', completed_lessons: ['L1'] }],
    ReviewSchedule: [],
    ReviewLog: [],
  });
}

test('queue offers new cards from completed lessons only, capped per day', async () => {
  const store = learningWorld();
  const q = await loadReviewQueue(store, { id: 'u1' }, { today: TODAY });
  assert.equal(q.due.length, 0);
  assert.equal(q.new.length, NEW_CARDS_PER_DAY);
  assert.equal(q.new_available, 30);
  assert.ok(q.new.every((c) => c.lesson_id === 'L1' && c.course_title === 'Reliability' && c.lesson_title === 'Incidents'));
});

test('recordReview schedules the card, logs it, and today’s new allowance shrinks', async () => {
  const store = learningWorld();
  const user = { id: 'u1' };
  const r = await recordReview(store, user, { flashcard_id: 'fc0', quality: 4, today: TODAY });
  assert.equal(r.schedule.course_id, 'c1', 'course derived from lesson → module');
  assert.equal(r.schedule.due_date, '2026-10-31');
  assert.equal(r.log.first_review, true);
  await recordReview(store, user, { flashcard_id: 'fc0', quality: 1, today: TODAY });
  assert.equal(store.tables.ReviewSchedule.length, 1, 'one schedule per card');
  assert.equal(store.tables.ReviewLog.length, 2);
  assert.equal(store.tables.ReviewLog[1].first_review, false);

  const q = await loadReviewQueue(store, user, { today: TODAY });
  assert.equal(q.new_allowance, NEW_CARDS_PER_DAY - 1);
  assert.equal(q.new.length, NEW_CARDS_PER_DAY - 1);
  const tomorrow = await loadReviewQueue(store, user, { today: '2026-10-31' });
  assert.deepEqual(tomorrow.due.map((c) => c.id), ['fc0']);
  assert.equal(await recordReview(store, user, { flashcard_id: 'rejected', quality: 4, today: TODAY }), null);
  await assert.rejects(() => recordReview(store, user, { flashcard_id: 'fc1', quality: 9, today: TODAY }), RangeError);
});

// ---- chapter changes ------------------------------------------------------------------------

const text = (topic, n = 40) => Array.from({ length: n }, (_, i) => `${topic} procedure step ${i} requires review approval logging`).join(' ');

test('chapterChanges pairs by title (ignoring numbering) and flags material rewrites only', () => {
  const prev = [
    { number: '1', title: '1. Introduction', content: text('intro') },
    { number: '2', title: 'Incident Response', content: text('incident') },
    { number: '3', title: 'Legacy Tools', content: text('legacy') },
  ];
  const next = [
    { number: '1', title: 'Chapter 1: Introduction', content: `${text('intro')} minor addition` },
    { number: '2', title: 'Incident Response', content: text('paging escalation rotation') },
    { number: '4', title: 'Observability', content: text('metrics') },
  ];
  const c = chapterChanges(prev, next);
  assert.deepEqual(c.added, ['Observability']);
  assert.deepEqual(c.removed, ['Legacy Tools']);
  assert.deepEqual(c.modified.map((m) => m.title), ['Incident Response']);
  assert.equal(c.unchanged, 1);
  assert.equal(c.significant, true);
  assert.equal(chapterChanges(prev, prev).significant, false);
});

test('addMonths clamps to the end of shorter months', () => {
  assert.equal(addMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonths('2026-10-30', 12), '2027-10-30');
});

// ---- recertification lifecycle ----------------------------------------------------------------

function certWorld() {
  return memoryStore({
    Playbook: [{ id: 'p1', title: 'SRE Playbook', recert_grace_days: 14, cert_validity_months: 12 }],
    PlaybookVersion: [{ id: 'v1', playbook_id: 'p1', version_label: 'v1', created_date: '2026-01-01T00:00:00Z' }],
    Course: [{ id: 'old', playbook_id: 'p1', title: 'SRE v1', status: 'archived' }],
    Module: [{ id: 'm-new', course_id: 'new', order: 0 }],
    Lesson: [
      { id: 'l-changed', module_id: 'm-new', title: 'Paging', source_chapter: 'Incident Response', status: 'approved' },
      { id: 'l-same', module_id: 'm-new', title: 'Welcome', source_chapter: 'Introduction', status: 'approved' },
    ],
    Certificate: [
      { id: 'cert-a', user_id: 'ana', course_id: 'old', certificate_id: 'IEA-A', user_name: 'Ana', course_title: 'SRE v1', created_date: '2026-02-01T00:00:00Z' },
      { id: 'cert-b', user_id: 'ben', course_id: 'old', certificate_id: 'IEA-B', status: 'superseded', created_date: '2026-02-01T00:00:00Z' },
    ],
    Recertification: [],
    CourseProgress: [{ id: 'cp', user_id: 'ana', course_id: 'new', completed_lessons: ['l-changed'] }],
  }, [{ id: 'ana', full_name: 'Ana' }, { id: 'ben', full_name: 'Ben' }, { id: 'off', disabled: true }]);
}

const CHANGES = { added: ['Observability'], removed: [], modified: [{ title: 'Incident Response', similarity: 0.4 }], unchanged: 3, significant: true };

test('a material playbook change flags valid certificates and waits for the updated course', async () => {
  const store = certWorld();
  const playbook = store.get('Playbook', 'p1');
  const r = await openRecertifications(store, { playbook, fromVersion: 'v1', toVersion: 'v2', changes: CHANGES, today: TODAY });
  assert.deepEqual(r, { opened: 1, updated: 0 });
  assert.equal(store.get('Certificate', 'cert-a').status, 'recert_required');
  assert.equal(store.get('Certificate', 'cert-b').status, 'superseded', 'only valid certificates are flagged');
  const [rc] = store.tables.Recertification;
  assert.equal(rc.status, 'awaiting_course');
  assert.deepEqual(rc.changed_chapters, ['Observability', 'Incident Response']);

  // A second change before the course is out folds into the same recertification.
  store.update('Certificate', 'cert-a', { status: 'valid' });
  const again = await openRecertifications(store, { playbook, toVersion: 'v3', changes: { ...CHANGES, added: ['Runbooks'] }, today: TODAY });
  assert.deepEqual(again, { opened: 0, updated: 1 });
  assert.equal(store.tables.Recertification[0].to_version, 'v3');
  assert.ok(store.tables.Recertification[0].changed_chapters.includes('Runbooks'));

  assert.deepEqual(await openRecertifications(store, { playbook: { ...playbook, recert_on_change: false }, changes: CHANGES }), { opened: 0, updated: 0 });
  assert.deepEqual(await openRecertifications(store, { playbook, changes: { ...CHANGES, significant: false } }), { opened: 0, updated: 0 });
});

test('publishing the updated course starts the clock; passing it renews and supersedes', async () => {
  const store = certWorld();
  const { sent, notify } = recorder();
  await openRecertifications(store, { playbook: store.get('Playbook', 'p1'), fromVersion: 'v1', toVersion: 'v2', changes: CHANGES, today: TODAY });

  const course = store.create('Course', { id: 'new', playbook_id: 'p1', title: 'SRE v2', status: 'published' });
  course.id = 'new';
  const pub = await onCoursePublished(store, course, { today: TODAY, notify });
  assert.deepEqual(pub, { activated: 1, notified: 1 }, 'Ben hears about the course, Ana about recertifying, disabled users nothing');
  const rc = store.tables.Recertification[0];
  assert.deepEqual([rc.status, rc.new_course_id, rc.due_date], ['pending', 'new', addDays(TODAY, 14)]);
  assert.deepEqual(sent.map((s) => `${s.userId}:${s.kind}`).sort(), ['ana:recert_required', 'ben:course_published']);

  const mine = await myRecertifications(store, { id: 'ana' }, { today: TODAY });
  assert.equal(mine[0].state, 'pending');
  assert.equal(mine[0].days_left, 14);
  assert.deepEqual(mine[0].delta_lessons.map((l) => [l.id, l.completed]), [['l-changed', true]]);

  const cert = await issueCertificate(store, { id: 'ana', full_name: 'Ana' }, course, { percentage: 88 }, { today: TODAY, notify });
  assert.equal(cert.status, 'valid');
  assert.equal(cert.playbook_version, 'v1');
  assert.equal(cert.expires_date, '2027-10-30');
  assert.equal(store.get('Certificate', 'cert-a').status, 'superseded');
  assert.equal(store.get('Certificate', 'cert-a').superseded_by, cert.certificate_id);
  assert.equal(rc.status, 'completed');
  assert.equal(rc.new_certificate_id, cert.certificate_id);
  assert.equal(sent.at(-1).kind, 'recert_completed');

  // Passing again returns the same current certificate.
  assert.equal((await issueCertificate(store, { id: 'ana' }, course, { percentage: 95 }, { today: TODAY, notify })).id, cert.id);
});

test('retaking the old course before the update is published does not complete recertification', async () => {
  const store = certWorld();
  store.update('Course', 'old', { status: 'published' });
  await openRecertifications(store, { playbook: store.get('Playbook', 'p1'), changes: CHANGES, today: TODAY });
  await issueCertificate(store, { id: 'ana' }, store.get('Course', 'old'), { percentage: 90 }, { today: TODAY });
  assert.equal(store.tables.Recertification[0].status, 'awaiting_course');
  assert.equal(store.get('Certificate', 'cert-a').status, 'recert_required');
});

test('waiving restores the certificate; expiry opens a recertification on the current course', async () => {
  const store = certWorld();
  await openRecertifications(store, { playbook: store.get('Playbook', 'p1'), changes: CHANGES, today: TODAY });
  const waived = await waiveRecertification(store, store.tables.Recertification[0].id, { reason: 'Role change', today: TODAY });
  assert.equal(waived.status, 'waived');
  assert.equal(store.get('Certificate', 'cert-a').status, 'valid');
  assert.equal(await waiveRecertification(store, waived.id), null, 'only open ones can be waived');

  store.update('Certificate', 'cert-a', { expires_date: '2026-10-01', playbook_id: 'p1' });
  store.tables.Course.push({ id: 'cur', playbook_id: 'p1', status: 'published', title: 'SRE v2', created_date: '2026-09-01T00:00:00Z' });
  store.tables.Certificate.push({ id: 'cert-c', user_id: 'cy', course_id: 'cur', playbook_id: 'p1', status: 'valid', expires_date: addDays(TODAY, 10), course_title: 'SRE v2' });
  const { sent, notify } = recorder();
  const summary = await runComplianceChecks(store, { today: TODAY, notify });
  assert.deepEqual(summary, { expired: 1, expiring: 1, due_soon: 0, overdue: 0 });
  assert.equal(store.get('Certificate', 'cert-a').status, 'expired');
  const rc = store.tables.Recertification.find((r) => r.reason === 'expired');
  assert.deepEqual([rc.status, rc.new_course_id, rc.due_date], ['pending', 'cur', addDays(TODAY, 14)]);
  assert.deepEqual(sent.map((s) => s.kind).sort(), ['certificate_expired', 'certificate_expiring']);

  // Two weeks on it is overdue; the reminder goes out once.
  const later = addDays(TODAY, 20);
  const r2 = recorder();
  await runComplianceChecks(store, { today: later, notify: r2.notify });
  await runComplianceChecks(store, { today: later, notify: r2.notify });
  assert.equal(r2.sent.filter((s) => s.kind === 'recert_overdue').length, 1);
  assert.equal(recertState(rc, later), 'overdue');

  // Passing the current course completes an expiry recertification too.
  await issueCertificate(store, { id: 'ana' }, store.get('Course', 'cur'), { percentage: 80 }, { today: later });
  assert.equal(rc.status, 'completed');
  assert.equal(store.get('Certificate', 'cert-a').status, 'superseded');
});

test('certificateStatus treats legacy rows as valid and past expiry as expired', () => {
  assert.equal(certificateStatus({}, TODAY), 'valid');
  assert.equal(certificateStatus({ expires_date: '2026-10-29' }, TODAY), 'expired');
  assert.equal(certificateStatus({ status: 'superseded', expires_date: '2026-10-29' }, TODAY), 'superseded');
});

test('complianceReport counts each learner’s newest certificate per playbook', async () => {
  const store = certWorld();
  store.tables.Certificate.push({ id: 'cert-b2', user_id: 'ben', course_id: 'old', certificate_id: 'IEA-B2', status: 'valid', created_date: '2026-03-01T00:00:00Z' });
  await openRecertifications(store, { playbook: store.get('Playbook', 'p1'), changes: CHANGES, today: TODAY });
  const r = await complianceReport(store, { today: TODAY });
  assert.equal(r.kpis.certified_learners, 2);
  assert.equal(r.kpis.valid, 0);
  assert.equal(r.kpis.recert_required, 2);
  assert.equal(r.kpis.compliance_rate, 0);
  assert.equal(r.playbooks[0].open_recerts, 2);
  assert.equal(r.recertifications.length, 2);
});

// ---- notifications ------------------------------------------------------------------------------

test('notification copy and email preferences', () => {
  const n = buildNotification('review_due', { count: 1 });
  assert.equal(n.title, '1 flashcard due for review');
  assert.equal(n.link, '/review');
  assert.equal(emailAllowed('review_due', null), true, 'defaults allow');
  assert.equal(emailAllowed('review_due', { review_reminders: false }), false);
  assert.equal(emailAllowed('certificate_issued', { email_enabled: false }), false);
  assert.throws(() => buildNotification('nope'));
});
