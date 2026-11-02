import { addDays, utcToday } from './review.js';
import { newCertificateId } from './finalTest.js';

// Certificate lifecycle and recertification, shared by the API and the demo driver.
//
// A certificate is tied to a playbook version. Two things make it no longer current:
//   - the playbook changes materially (a re-extract adds, removes or rewrites chapters) → recert_required
//   - its validity window ends (Playbook.cert_validity_months)                         → expired
// Either opens a Recertification for the learner. It waits ('awaiting_course') until a course built
// from the updated playbook is published, then becomes 'pending' with a due date. Passing that
// course's final test issues a new certificate, supersedes the old one and completes it.
//
// `store`: filter(entity, query, sort, limit) · get(entity, id) · create(entity, data, userId) ·
//          update(entity, id, patch) · users() → [{ id, role, disabled, full_name, email }]
// `notify(userId, kind, data, dedupeKey)`: delivers a NOTIFICATION_KINDS notification (may be async).

export const CHANGE_SIMILARITY = 0.85;
export const DUE_SOON_DAYS = 7;
export const EXPIRY_WARNING_DAYS = 30;
const OPEN = ['awaiting_course', 'pending'];

const noop = () => {};

// ---- chapter diffing ----------------------------------------------------------------------------

const normTitle = (t) => String(t || '').toLowerCase()
  .replace(/^\s*(chapter|section|part)\s+/, '')
  .replace(/^\s*[\divxlc]+(\.\d+)*[.):-]?\s+/, '')
  .replace(/[^\p{L}\p{N}]+/gu, ' ')
  .trim();

function wordCounts(text) {
  const counts = new Map();
  for (const w of String(text || '').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || []) counts.set(w, (counts.get(w) || 0) + 1);
  return counts;
}

/** Dice similarity of two texts' word multisets, 0–1 (1 = same words in the same amounts). */
export function textSimilarity(a, b) {
  const ca = wordCounts(a);
  const cb = wordCounts(b);
  let shared = 0;
  let total = 0;
  for (const [w, n] of ca) { shared += Math.min(n, cb.get(w) || 0); total += n; }
  for (const n of cb.values()) total += n;
  return total ? (2 * shared) / total : 1;
}

/**
 * What changed between two chapter lists ([{ number, title, content }]). Chapters pair up by title
 * (numbering ignored), then by number. A paired chapter whose text similarity drops below
 * CHANGE_SIMILARITY counts as modified — rewording a sentence doesn't, rewriting a procedure does.
 */
export function chapterChanges(prev = [], next = []) {
  const unmatchedPrev = [...prev];
  const pairs = [];
  const added = [];
  for (const ch of next) {
    let i = unmatchedPrev.findIndex((p) => normTitle(p.title) && normTitle(p.title) === normTitle(ch.title));
    if (i < 0 && ch.number) i = unmatchedPrev.findIndex((p) => String(p.number || '') === String(ch.number));
    if (i < 0) { added.push(ch.title); continue; }
    pairs.push([unmatchedPrev[i], ch]);
    unmatchedPrev.splice(i, 1);
  }
  const modified = [];
  let unchanged = 0;
  for (const [p, n] of pairs) {
    const similarity = textSimilarity(p.content, n.content);
    if (similarity < CHANGE_SIMILARITY) modified.push({ title: n.title, similarity: Number(similarity.toFixed(2)) });
    else unchanged += 1;
  }
  const removed = unmatchedPrev.map((p) => p.title);
  return { added, removed, modified, unchanged, significant: added.length + removed.length + modified.length > 0 };
}

/** Chapter titles whose lessons a recertifying learner should revisit. */
export const changedChapterTitles = (changes) => [...changes.added, ...changes.modified.map((m) => m.title)];

// ---- standing -----------------------------------------------------------------------------------

export function addMonths(day, months) {
  const d = new Date(`${day}T00:00:00Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d.getUTCDate(), lastDay));
  return target.toISOString().slice(0, 10);
}

/** A certificate's effective status: rows from before recertification existed have none (= valid). */
export function certificateStatus(cert, today = utcToday()) {
  const status = cert?.status || 'valid';
  if (status === 'valid' && cert?.expires_date && cert.expires_date < today) return 'expired';
  return status;
}

/** 'overdue' for a pending recertification past its due date, otherwise its stored status. */
export function recertState(r, today = utcToday()) {
  return r.status === 'pending' && r.due_date && r.due_date < today ? 'overdue' : r.status;
}

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

async function latestVersionLabel(store, playbookId) {
  if (!playbookId) return '';
  const [v] = await store.filter('PlaybookVersion', { playbook_id: playbookId }, '-created_date', 1);
  return v?.version_label || '';
}

async function publishedCourseFor(store, playbookId) {
  const [course] = await store.filter('Course', { playbook_id: playbookId, status: 'published' }, '-created_date', 1);
  return course || null;
}

// Certificates covering a playbook: by playbook_id, or (older rows) through the course they were issued for.
async function certificatesFor(store, playbookId) {
  const courses = await store.filter('Course', { playbook_id: playbookId }, null, 1000);
  const ids = courses.map((c) => c.id);
  const certs = await store.filter('Certificate', {
    $or: [{ playbook_id: playbookId }, ...(ids.length ? [{ course_id: { $in: ids } }] : [])],
  }, '-created_date', 100000);
  return certs;
}

// One open recertification per learner and playbook.
async function openRecertFor(store, userId, playbookId) {
  const [r] = await store.filter('Recertification', { user_id: userId, playbook_id: playbookId, status: { $in: OPEN } }, '-created_date', 1);
  return r || null;
}

const merge = (a = [], b = []) => [...new Set([...a, ...b])];

// ---- lifecycle ----------------------------------------------------------------------------------

/**
 * A new playbook version changed the content: every learner holding a valid certificate for it must
 * recertify. Their newest valid certificate becomes recert_required and a Recertification opens
 * (or an open one absorbs the new changes). Returns { opened, updated }.
 */
export async function openRecertifications(store, { playbook, fromVersion = '', toVersion = '', changes, today = utcToday() }) {
  if (!changes?.significant || playbook?.recert_on_change === false) return { opened: 0, updated: 0 };
  const changed = changedChapterTitles(changes);
  const latestByUser = new Map();
  for (const cert of await certificatesFor(store, playbook.id)) {
    if (certificateStatus(cert, today) !== 'valid') continue;
    if (!latestByUser.has(cert.user_id)) latestByUser.set(cert.user_id, cert); // sorted newest first
  }

  let opened = 0;
  let updated = 0;
  for (const cert of latestByUser.values()) {
    await store.update('Certificate', cert.id, { status: 'recert_required', playbook_id: playbook.id });
    const open = await openRecertFor(store, cert.user_id, playbook.id);
    if (open) {
      await store.update('Recertification', open.id, {
        to_version: toVersion,
        changed_chapters: merge(open.changed_chapters, changed),
        removed_chapters: merge(open.removed_chapters, changes.removed),
      });
      updated += 1;
      continue;
    }
    await store.create('Recertification', {
      user_id: cert.user_id,
      user_name: cert.user_name || '',
      playbook_id: playbook.id,
      playbook_title: playbook.title || cert.course_title || '',
      certificate_id: cert.certificate_id,
      old_course_id: cert.course_id,
      reason: 'playbook_changed',
      from_version: cert.playbook_version || fromVersion,
      to_version: toVersion,
      changed_chapters: changed,
      removed_chapters: changes.removed,
      status: 'awaiting_course',
    });
    opened += 1;
  }
  return { opened, updated };
}

/**
 * A course was just published. Recertifications for its playbook that were waiting for updated
 * content point at it and start their clock; every active learner hears about the new course.
 */
export async function onCoursePublished(store, course, { today = utcToday(), notify = noop } = {}) {
  if (!course?.playbook_id) return { activated: 0, notified: 0 };
  const playbook = await store.get('Playbook', course.playbook_id);
  const grace = Number(playbook?.recert_grace_days ?? 30) || 30;
  const recerts = await store.filter('Recertification', { playbook_id: course.playbook_id, status: { $in: OPEN } }, null, 100000);

  const recertifying = new Set();
  let activated = 0;
  for (const r of recerts) {
    // Republishing the very course a learner was certified on is not new content for them.
    if (r.reason === 'playbook_changed' && r.old_course_id === course.id) continue;
    if (r.new_course_id === course.id && r.status === 'pending') { recertifying.add(r.user_id); continue; }
    const dueDate = r.status === 'pending' && r.due_date ? r.due_date : addDays(today, grace);
    await store.update('Recertification', r.id, { new_course_id: course.id, status: 'pending', due_date: dueDate });
    await notify(r.user_id, 'recert_required', {
      playbook_title: r.playbook_title || playbook?.title || course.title,
      reason: r.reason,
      due_date: dueDate,
      changed_count: (r.changed_chapters || []).length,
    }, `recert_required:${r.id}:${course.id}`);
    recertifying.add(r.user_id);
    activated += 1;
  }

  let notified = 0;
  for (const u of await store.users()) {
    if (u.disabled || u.role === 'admin' || recertifying.has(u.id)) continue;
    await notify(u.id, 'course_published', {
      course_id: course.id, course_title: course.title, description: course.description,
    }, `course_published:${course.id}:${u.id}`);
    notified += 1;
  }
  return { activated, notified };
}

/**
 * Issues the certificate for a passed final test (or returns the learner's current valid one for this
 * course). A new certificate completes any open recertification for the playbook and supersedes the
 * certificates it replaces. Returns the certificate row.
 */
export async function issueCertificate(store, user, course, result, { today = utcToday(), notify = noop } = {}) {
  const mine = await store.filter('Certificate', { user_id: user.id, course_id: course.id }, '-created_date', 100);
  const current = mine.find((c) => certificateStatus(c, today) === 'valid');
  if (current) return current;

  const playbook = course.playbook_id ? await store.get('Playbook', course.playbook_id) : null;
  const months = Number(playbook?.cert_validity_months) || 0;
  const cert = await store.create('Certificate', {
    user_id: user.id,
    course_id: course.id,
    course_title: course.title,
    user_name: user.full_name || user.email,
    score: result.percentage,
    completion_date: today,
    certificate_id: newCertificateId(),
    playbook_id: course.playbook_id || '',
    playbook_version: await latestVersionLabel(store, course.playbook_id),
    status: 'valid',
    expires_date: months > 0 ? addMonths(today, months) : '',
  }, user.id);

  // Only the course a recertification points at completes it (an expired one with no course yet takes
  // any course of its playbook). Retaking the old course before the update is published does not.
  let renewed = false;
  if (course.playbook_id) {
    const open = await store.filter('Recertification', { user_id: user.id, playbook_id: course.playbook_id, status: { $in: OPEN } }, null, 100);
    for (const r of open) {
      if (r.new_course_id !== course.id && !(r.reason === 'expired' && !r.new_course_id)) continue;
      await store.update('Recertification', r.id, { status: 'completed', completed_date: today, new_certificate_id: cert.certificate_id, new_course_id: course.id });
      renewed = true;
    }
    if (renewed) {
      for (const old of await certificatesFor(store, course.playbook_id)) {
        if (old.id === cert.id || old.user_id !== user.id) continue;
        if (!['recert_required', 'expired'].includes(certificateStatus(old, today))) continue;
        await store.update('Certificate', old.id, { status: 'superseded', superseded_by: cert.certificate_id });
      }
    }
  }

  if (renewed) {
    await notify(user.id, 'recert_completed', { playbook_title: playbook?.title || course.title, certificate_id: cert.certificate_id }, `recert_completed:${cert.id}`);
  } else {
    await notify(user.id, 'certificate_issued', {
      course_id: course.id, course_title: course.title, score: result.percentage,
      certificate_id: cert.certificate_id, expires_date: cert.expires_date,
    }, `certificate_issued:${cert.id}`);
  }
  return cert;
}

/** Waives an open recertification: the learner's certificate counts as current again. */
export async function waiveRecertification(store, id, { reason = '', today = utcToday() } = {}) {
  const r = await store.get('Recertification', id);
  if (!r || !OPEN.includes(r.status)) return null;
  const updated = await store.update('Recertification', id, { status: 'waived', completed_date: today, waived_reason: String(reason || '').slice(0, 500) });
  const [cert] = r.certificate_id ? await store.filter('Certificate', { certificate_id: r.certificate_id }, null, 1) : [];
  if (cert && ['recert_required', 'expired'].includes(certificateStatus(cert, today))) {
    // An expired certificate gets a fresh window from today; a changed-playbook one just stands.
    const playbook = await store.get('Playbook', r.playbook_id);
    const months = Number(playbook?.cert_validity_months) || 0;
    await store.update('Certificate', cert.id, {
      status: 'valid',
      ...(r.reason === 'expired' ? { expires_date: months > 0 ? addMonths(today, months) : '' } : {}),
    });
  }
  return updated;
}

/**
 * The daily compliance pass: expire certificates whose window ended (opening recertifications),
 * warn before expiry, and remind about recertifications that are due soon or overdue.
 * Every notification carries a dedupe key, so running it more often than daily is harmless.
 */
export async function runComplianceChecks(store, { today = utcToday(), notify = noop } = {}) {
  const summary = { expired: 0, expiring: 0, due_soon: 0, overdue: 0 };
  const playbooks = new Map();
  const playbookOf = async (id) => {
    if (!playbooks.has(id)) playbooks.set(id, id ? await store.get('Playbook', id) : null);
    return playbooks.get(id);
  };

  const dated = (await store.filter('Certificate', { expires_date: { $lte: addDays(today, EXPIRY_WARNING_DAYS) } }, null, 100000))
    .filter((c) => c.expires_date && (c.status || 'valid') === 'valid');
  for (const cert of dated) {
    if (cert.expires_date >= today) {
      await notify(cert.user_id, 'certificate_expiring', {
        course_title: cert.course_title, expires_date: cert.expires_date, days_left: daysBetween(today, cert.expires_date),
      }, `certificate_expiring:${cert.id}`);
      summary.expiring += 1;
      continue;
    }
    await store.update('Certificate', cert.id, { status: 'expired' });
    summary.expired += 1;
    const playbookId = cert.playbook_id || (await store.get('Course', cert.course_id))?.playbook_id;
    if (!playbookId) continue;
    const playbook = await playbookOf(playbookId);
    const grace = Number(playbook?.recert_grace_days ?? 30) || 30;
    const course = await publishedCourseFor(store, playbookId);
    const dueDate = addDays(today, grace);
    const open = await openRecertFor(store, cert.user_id, playbookId);
    if (!open) {
      await store.create('Recertification', {
        user_id: cert.user_id,
        user_name: cert.user_name || '',
        playbook_id: playbookId,
        playbook_title: playbook?.title || cert.course_title || '',
        certificate_id: cert.certificate_id,
        old_course_id: cert.course_id,
        new_course_id: course?.id || '',
        reason: 'expired',
        from_version: cert.playbook_version || '',
        to_version: await latestVersionLabel(store, playbookId),
        changed_chapters: [],
        removed_chapters: [],
        status: course ? 'pending' : 'awaiting_course',
        due_date: course ? dueDate : '',
      });
    }
    await notify(cert.user_id, 'certificate_expired', {
      course_title: cert.course_title, expires_date: cert.expires_date, due_date: open?.due_date || dueDate,
    }, `certificate_expired:${cert.id}`);
  }

  for (const r of await store.filter('Recertification', { status: 'pending' }, null, 100000)) {
    if (!r.due_date) continue;
    const daysLeft = daysBetween(today, r.due_date);
    if (daysLeft < 0) {
      await notify(r.user_id, 'recert_overdue', { playbook_title: r.playbook_title, due_date: r.due_date }, `recert_overdue:${r.id}`);
      summary.overdue += 1;
    } else if (daysLeft <= DUE_SOON_DAYS) {
      await notify(r.user_id, 'recert_due_soon', { playbook_title: r.playbook_title, due_date: r.due_date, days_left: daysLeft }, `recert_due_soon:${r.id}`);
      summary.due_soon += 1;
    }
  }
  return summary;
}

// ---- read models --------------------------------------------------------------------------------

/**
 * A learner's recertifications, newest first, each with what to do: the course to recertify on,
 * its lessons drawn from changed chapters (with completion), and whether the final test is next.
 */
export async function myRecertifications(store, user, { today = utcToday() } = {}) {
  const recerts = await store.filter('Recertification', { user_id: user.id }, '-created_date', 500);
  const courseIds = [...new Set(recerts.map((r) => r.new_course_id).filter(Boolean))];
  const [courses, modules, progress] = await Promise.all([
    courseIds.length ? store.filter('Course', { id: { $in: courseIds } }, null, 500) : [],
    courseIds.length ? store.filter('Module', { course_id: { $in: courseIds } }, 'order', 5000) : [],
    courseIds.length ? store.filter('CourseProgress', { user_id: user.id, course_id: { $in: courseIds } }, null, 500) : [],
  ]);
  const lessons = modules.length
    ? (await store.filter('Lesson', { module_id: { $in: modules.map((m) => m.id) } }, 'order', 20000)).filter((l) => l.status === 'approved')
    : [];
  const moduleCourse = new Map(modules.map((m) => [m.id, m.course_id]));

  return recerts.map((r) => {
    const course = courses.find((c) => c.id === r.new_course_id) || null;
    const done = new Set(progress.find((p) => p.course_id === r.new_course_id)?.completed_lessons || []);
    const changed = new Set((r.changed_chapters || []).map(normTitle));
    const deltaLessons = lessons
      .filter((l) => moduleCourse.get(l.module_id) === r.new_course_id && changed.has(normTitle(l.source_chapter)))
      .map((l) => ({ id: l.id, title: l.title, source_chapter: l.source_chapter, completed: done.has(l.id) }));
    return {
      ...r,
      state: recertState(r, today),
      days_left: r.due_date ? daysBetween(today, r.due_date) : null,
      course: course ? { id: course.id, title: course.title, status: course.status } : null,
      delta_lessons: deltaLessons,
      delta_completed: deltaLessons.filter((l) => l.completed).length,
    };
  });
}

/** Organisation-wide certification compliance for the admin dashboard. */
export async function complianceReport(store, { today = utcToday() } = {}) {
  const [playbooks, certs, recerts, users] = await Promise.all([
    store.filter('Playbook', {}, 'title', 5000),
    store.filter('Certificate', {}, '-created_date', 100000),
    store.filter('Recertification', {}, '-created_date', 100000),
    store.users(),
  ]);
  const courses = await store.filter('Course', {}, null, 10000);
  const coursePlaybook = new Map(courses.map((c) => [c.id, c.playbook_id]));
  const userName = new Map(users.map((u) => [u.id, u.full_name || u.email]));
  const playbookOf = (c) => c.playbook_id || coursePlaybook.get(c.course_id) || '';

  const certRows = certs.map((c) => ({ ...c, playbook_id: playbookOf(c), standing: certificateStatus(c, today), user_name: c.user_name || userName.get(c.user_id) || '' }));
  const recertRows = recerts.map((r) => ({
    ...r, state: recertState(r, today), user_name: r.user_name || userName.get(r.user_id) || '',
    days_left: r.due_date ? daysBetween(today, r.due_date) : null,
  }));

  // A learner is compliant for a playbook when their newest certificate for it is valid.
  const holders = new Map(); // `${playbook}:${user}` → newest certificate
  for (const c of certRows) {
    const key = `${c.playbook_id}:${c.user_id}`;
    if (!holders.has(key)) holders.set(key, c);
  }
  const newest = [...holders.values()];
  const count = (rows, pred) => rows.filter(pred).length;
  const since30 = addDays(today, -30);

  const perPlaybook = playbooks.filter((p) => p.status !== 'archived' || newest.some((c) => c.playbook_id === p.id)).map((p) => {
    const mine = newest.filter((c) => c.playbook_id === p.id);
    const open = recertRows.filter((r) => r.playbook_id === p.id && ['awaiting_course', 'pending', 'overdue'].includes(r.state));
    const valid = count(mine, (c) => c.standing === 'valid');
    return {
      id: p.id,
      title: p.title,
      version: p.version || '',
      recert_on_change: p.recert_on_change !== false,
      cert_validity_months: Number(p.cert_validity_months) || 0,
      recert_grace_days: Number(p.recert_grace_days ?? 30),
      certified: mine.length,
      valid,
      open_recerts: open.length,
      overdue: count(open, (r) => r.state === 'overdue'),
      compliance_rate: mine.length ? Math.round((valid / mine.length) * 100) : null,
    };
  });

  const valid = count(newest, (c) => c.standing === 'valid');
  return {
    today,
    kpis: {
      certified_learners: new Set(newest.map((c) => c.user_id)).size,
      certificates: newest.length,
      valid,
      recert_required: count(newest, (c) => c.standing === 'recert_required'),
      expired: count(newest, (c) => c.standing === 'expired'),
      open_recerts: count(recertRows, (r) => ['awaiting_course', 'pending', 'overdue'].includes(r.state)),
      overdue: count(recertRows, (r) => r.state === 'overdue'),
      completed_30d: count(recertRows, (r) => r.status === 'completed' && (r.completed_date || '') >= since30),
      compliance_rate: newest.length ? Math.round((valid / newest.length) * 100) : null,
    },
    playbooks: perPlaybook,
    recertifications: recertRows,
    expiring: certRows
      .filter((c) => c.standing === 'valid' && c.expires_date && c.expires_date <= addDays(today, EXPIRY_WARNING_DAYS))
      .map((c) => ({ id: c.id, user_id: c.user_id, user_name: c.user_name, course_title: c.course_title, certificate_id: c.certificate_id, expires_date: c.expires_date, days_left: daysBetween(today, c.expires_date) })),
  };
}
