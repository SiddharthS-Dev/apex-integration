// Pure derivations for the admin control center — everything comes from records the dashboard
// already loads. Nothing here is invented when the data is missing.
import { format, startOfMonth, subDays, subMonths } from 'date-fns';

export const STATUS_META = {
  // playbooks
  uploaded: { label: 'Uploaded', color: '#94a3b8' },
  processing: { label: 'Processing', color: '#38bdf8' },
  processed: { label: 'Chapters extracted', color: '#a78bfa' },
  needs_review: { label: 'Needs review', color: '#fbbf24' },
  failed: { label: 'Failed', color: '#fb7185' },
  // shared
  draft: { label: 'Draft', color: '#94a3b8' },
  pending: { label: 'Not generated', color: '#64748b' },
  generating: { label: 'Generating', color: '#38bdf8' },
  pending_review: { label: 'Needs review', color: '#fbbf24' },
  approved: { label: 'Approved', color: '#34d399' },
  published: { label: 'Published', color: '#a78bfa' },
  rejected: { label: 'Rejected', color: '#fb7185' },
  archived: { label: 'Archived', color: '#475569' },
  // learners
  active: { label: 'Learning', color: '#34d399' },
  idle: { label: 'Not started', color: '#64748b' },
};

export const KINDS = ['playbooks', 'courses', 'lessons', 'questions', 'learners', 'certificates'];

const byStatus = (items, fallback = 'pending') => items.reduce((acc, i) => {
  const k = i.status || fallback;
  acc[k] = (acc[k] || 0) + 1;
  return acc;
}, {});

const toSlices = (counts) => Object.entries(counts)
  .filter(([, n]) => n > 0)
  .map(([key, value]) => ({ key, value, label: STATUS_META[key]?.label || key, color: STATUS_META[key]?.color || '#94a3b8' }))
  .sort((a, b) => b.value - a.value);

export function learnersOf(data) {
  return data.users.filter((u) => u.role !== 'admin');
}

// Items + labels + status breakdown for each KPI card / deep-dive panel.
export function kindInfo(kind, data) {
  switch (kind) {
    case 'playbooks': {
      const items = data.playbooks;
      return { label: 'Playbooks', items, total: items.length, hint: `${items.filter((p) => p.status === 'published').length} published`, slices: toSlices(byStatus(items, 'uploaded')) };
    }
    case 'courses': {
      const items = data.courses;
      return { label: 'Courses', items, total: items.length, hint: `${items.filter((c) => c.status === 'published').length} published`, slices: toSlices(byStatus(items, 'draft')) };
    }
    case 'lessons': {
      const items = data.lessons;
      return { label: 'Lessons', items, total: items.length, hint: `${items.filter((l) => l.status === 'approved').length} approved`, slices: toSlices(byStatus(items)) };
    }
    case 'questions': {
      const items = data.questions;
      return { label: 'Questions', items, total: items.length, hint: `${items.filter((q) => q.status === 'pending_review').length} awaiting review`, slices: toSlices(byStatus(items, 'pending_review')) };
    }
    case 'learners': {
      const items = learnersOf(data);
      const activeIds = new Set(data.progress.map((p) => p.user_id));
      const counts = items.reduce((acc, u) => ({ ...acc, [activeIds.has(u.id) ? 'active' : 'idle']: (acc[activeIds.has(u.id) ? 'active' : 'idle'] || 0) + 1 }), {});
      return { label: 'Learners', items, total: items.length, hint: `${data.users.length} users in total`, slices: toSlices(counts) };
    }
    case 'certificates': {
      const items = data.certificates;
      const counts = items.reduce((acc, c) => ({ ...acc, [c.course_title || 'Course']: (acc[c.course_title || 'Course'] || 0) + 1 }), {});
      const palette = ['#a78bfa', '#34d399', '#38bdf8', '#fbbf24', '#fb7185'];
      const slices = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5)
        .map(([label, value], i) => ({ key: label, label, value, color: palette[i] }));
      return { label: 'Certificates', items, total: items.length, hint: 'issued', slices };
    }
    default: return { label: kind, items: [], total: 0, hint: '', slices: [] };
  }
}

// Items created per month over the last 12 months.
export function monthlyCreated(items = [], now = new Date()) {
  const months = Array.from({ length: 12 }, (_, i) => startOfMonth(subMonths(now, 11 - i)));
  const keyOf = (d) => format(d, 'yyyy-MM');
  const counts = Object.fromEntries(months.map((m) => [keyOf(m), 0]));
  for (const it of items) {
    if (!it.created_date) continue;
    const k = keyOf(new Date(it.created_date));
    if (k in counts) counts[k] += 1;
  }
  return months.map((m) => ({ month: format(m, 'MMM'), count: counts[keyOf(m)] }));
}

// Lesson coverage over the last 30 days: cumulative lessons by the day they were created, split
// by current status and placed on the day they last changed (approval / review both set updated_date).
export function coverageSeries(lessons = [], days = 30, now = new Date()) {
  const dayKey = (d) => format(d, 'yyyy-MM-dd');
  const points = Array.from({ length: days }, (_, i) => subDays(now, days - 1 - i));
  return points.map((d) => {
    const end = `${dayKey(d)}T23:59:59.999Z`;
    let created = 0; let approved = 0; let review = 0; let generating = 0;
    for (const l of lessons) {
      if (!l.created_date || l.created_date > end) continue;
      created += 1;
      const changed = (l.updated_date || l.created_date) <= end;
      if (!changed) continue;
      if (l.status === 'approved') approved += 1;
      else if (l.status === 'pending_review') review += 1;
      else if (l.status === 'generating') generating += 1;
    }
    return { day: format(d, 'MMM d'), approved, review, generating, pending: created - approved - review - generating };
  });
}

// Pipeline stage counts; `active` marks stages with work running right now.
export function pipelineStages(data) {
  const pb = byStatus(data.playbooks, 'uploaded');
  const ls = byStatus(data.lessons);
  const reviewCount = [data.lessons, data.questions, data.flashcards, data.assessments]
    .reduce((s, list) => s + list.filter((x) => x.status === 'pending_review').length, 0);
  return [
    { key: 'upload', label: 'Playbook upload', value: data.playbooks.length, sub: 'playbooks', tone: 'violet' },
    { key: 'extract', label: 'Chapter extract', value: data.playbooks.filter((p) => (p.chapter_count || 0) > 0).length, sub: `${pb.processing || 0} processing · ${pb.failed || 0} failed`, tone: pb.failed ? 'rose' : 'sky', active: (pb.processing || 0) > 0 },
    { key: 'course', label: 'Course build', value: data.courses.length, sub: `${data.modules.length} modules`, tone: 'sky' },
    { key: 'ai', label: 'AI generation', value: data.lessons.length - (ls.pending || 0), sub: `${ls.pending || 0} of ${data.lessons.length} lessons left`, tone: 'sky', active: (ls.generating || 0) > 0 },
    { key: 'review', label: 'Human review', value: reviewCount, sub: 'items waiting', tone: 'amber', active: reviewCount > 0 },
    { key: 'approved', label: 'Approved', value: ls.approved || 0, sub: `${data.courses.filter((c) => c.status === 'published').length} courses live`, tone: 'emerald' },
  ];
}

// Review queue for a KPI kind: items awaiting a decision, newest first.
export function queueFor(kind, data) {
  const courseOfModule = Object.fromEntries(data.modules.map((m) => [m.id, m.course_id]));
  const playbookOfCourse = Object.fromEntries(data.courses.map((c) => [c.id, c.playbook_id]));
  const titleOfLesson = Object.fromEntries(data.lessons.map((l) => [l.id, l.title]));
  const newest = (a, b) => String(b.updated_date || '').localeCompare(String(a.updated_date || ''));
  switch (kind) {
    case 'lessons':
      return data.lessons.filter((l) => l.status === 'pending_review').sort(newest).map((l) => {
        const playbookId = playbookOfCourse[courseOfModule[l.module_id]];
        return { id: l.id, entity: 'Lesson', record: l, title: l.title, meta: l.video_title || l.source_chapter || 'Lesson', status: l.status, reviewTo: playbookId ? `/admin/studio/${playbookId}` : '/admin/courses', quick: true };
      });
    case 'questions':
      return data.questions.filter((q) => q.status === 'pending_review').sort(newest).map((q) => ({
        id: q.id, entity: 'Question', record: q, title: q.question_text, meta: q.lesson_id ? `Lesson: ${titleOfLesson[q.lesson_id] || '—'}` : 'Assessment question', status: q.status, reviewTo: '/admin/questions', quick: true,
      }));
    case 'courses':
      return data.courses.filter((c) => c.status === 'pending_review' || c.status === 'draft').sort(newest).map((c) => ({
        id: c.id, entity: 'Course', record: c, title: c.title, meta: `${c.module_count || 0} modules · ${c.lesson_count || 0} lessons`, status: c.status, reviewTo: c.playbook_id ? `/admin/studio/${c.playbook_id}` : `/admin/courses/${c.id}/edit`, quick: false,
      }));
    case 'playbooks':
      return data.playbooks.filter((p) => ['failed', 'uploaded', 'needs_review', 'processed'].includes(p.status)).sort(newest).map((p) => ({
        id: p.id, entity: 'Playbook', record: p, title: p.title, meta: p.error || `${p.chapter_count || 0} chapters`, status: p.status, reviewTo: p.status === 'failed' || p.status === 'uploaded' ? '/admin/playbooks' : `/admin/studio/${p.id}`, quick: false,
      }));
    default:
      return [];
  }
}

export function pendingCategories(data) {
  const pending = (list) => list.filter((x) => x.status === 'pending_review');
  return [
    { key: 'lessons', label: 'Lessons', items: pending(data.lessons), queueKind: 'lessons' },
    { key: 'questions', label: 'Questions', items: pending(data.questions), queueKind: 'questions' },
    { key: 'assessments', label: 'Assessments', items: pending(data.assessments), queueKind: null },
    { key: 'flashcards', label: 'Flashcards', items: pending(data.flashcards), queueKind: null },
  ];
}

// System activity from existing records, newest first.
export function activityFeed(data, syncLogs = []) {
  const users = Object.fromEntries(data.users.map((u) => [u.id, u]));
  const courses = Object.fromEntries(data.courses.map((c) => [c.id, c]));
  const name = (id) => users[id]?.full_name || users[id]?.email || 'A learner';
  const ev = [];
  for (const p of data.playbooks) {
    ev.push({ id: `pb-${p.id}`, at: p.created_date, kind: 'upload', text: `${p.source === 'dropbox' ? 'Dropbox imported' : 'Uploaded'} “${p.title}”` });
    if (p.status === 'failed') ev.push({ id: `pbf-${p.id}`, at: p.updated_date, kind: 'error', text: `Processing failed for “${p.title}”` });
    if (p.status === 'needs_review') ev.push({ id: `pbr-${p.id}`, at: p.updated_date, kind: 'ai', text: `AI built a course from “${p.title}” — ready for review` });
  }
  for (const c of data.courses) {
    if (c.status === 'published') ev.push({ id: `cp-${c.id}`, at: c.updated_date, kind: 'success', text: `Published “${c.title}”` });
  }
  for (const l of data.lessons) {
    if (l.status === 'pending_review') ev.push({ id: `lg-${l.id}`, at: l.updated_date, kind: 'ai', text: `AI generated lesson “${l.title}”` });
    if (l.status === 'approved') ev.push({ id: `la-${l.id}`, at: l.updated_date, kind: 'success', text: `Approved lesson “${l.title}”` });
  }
  for (const u of data.users) ev.push({ id: `u-${u.id}`, at: u.created_date, kind: 'user', who: u.full_name || u.email, text: `${u.full_name || u.email} joined as ${u.role}` });
  for (const a of data.attempts) {
    ev.push({ id: `qa-${a.id}`, at: a.created_date, kind: a.passed ? 'user' : 'warn', who: name(a.user_id), text: `${name(a.user_id)} scored ${Math.round(a.percentage || 0)}% on a ${a.type === 'final' ? 'final test' : a.type === 'chapter' ? 'chapter test' : 'lesson quiz'} in “${courses[a.course_id]?.title || 'a course'}”` });
  }
  for (const c of data.certificates) ev.push({ id: `ce-${c.id}`, at: c.created_date, kind: 'success', who: c.user_name, text: `${c.user_name || 'A learner'} earned a certificate for “${c.course_title}”` });
  for (const s of syncLogs) {
    if (s.status === 'running') continue;
    ev.push({ id: `sy-${s.id}`, at: s.finished_at || s.started_at, kind: s.status === 'failed' ? 'error' : 'sync', text: `Dropbox sync ${s.status}: ${s.added || 0} added, ${s.updated || 0} updated` });
  }
  return ev.filter((e) => e.at).sort((a, b) => String(b.at).localeCompare(String(a.at)));
}
