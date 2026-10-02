// Shared helpers for admin dashboard coverage calculations.

export const LESSON_SEGMENTS = [
  { key: 'approved', label: 'Approved', bar: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  { key: 'pending_review', label: 'Pending review', bar: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  { key: 'generating', label: 'Generating', bar: 'bg-blue-500', text: 'text-blue-600 dark:text-blue-400' },
  { key: 'pending', label: 'Pending', bar: 'bg-slate-400 dark:bg-slate-500', text: 'text-slate-600 dark:text-slate-400' },
  { key: 'rejected', label: 'Rejected', bar: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
];

export function countByStatus(items = [], fallback = 'pending') {
  return items.reduce((acc, item) => {
    const key = item.status || fallback;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function pct(n, d) {
  return d ? Math.round((n / d) * 100) : 0;
}

const COURSE_PRIORITY = { pending_review: 0, published: 1, draft: 2, archived: 3 };

// Picks the most relevant course for a playbook (non-archived preferred).
export function pickCourse(courses = []) {
  return [...courses].sort(
    (a, b) => (COURSE_PRIORITY[a.status] ?? 9) - (COURSE_PRIORITY[b.status] ?? 9),
  )[0] || null;
}

// Joins Lesson → Module → Course → Playbook into one row per playbook.
export function buildPlaybookRows({ playbooks = [], courses = [], modules = [], lessons = [] }) {
  return playbooks
    .map((playbook) => {
      const course = pickCourse(courses.filter((c) => c.playbook_id === playbook.id));
      const moduleIds = new Set(modules.filter((m) => course && m.course_id === course.id).map((m) => m.id));
      const courseLessons = lessons.filter((l) => moduleIds.has(l.module_id));
      const counts = countByStatus(courseLessons);
      const total = courseLessons.length;
      return { playbook, course, counts, total, coverage: pct(counts.approved || 0, total) };
    })
    .sort((a, b) => a.coverage - b.coverage);
}
