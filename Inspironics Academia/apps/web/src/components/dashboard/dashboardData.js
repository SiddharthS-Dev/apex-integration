// Pure derivations for the learner dashboard. Everything here is computed from records
// the dashboard already loads — nothing is invented when a value is missing.
import { isCourseComplete, todayIso } from '@/components/dashboard/useLearnerData';

const DAY_MS = 86_400_000;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

// Local calendar day (YYYY-MM-DD) — streaks follow the learner's own midnight.
export const dayKey = (d) => {
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString('en-CA');
};

// Days on which the learner did something we have a record of.
export function activityDays({ attempts = [], rows = [], schedules = [], certificates = [] }) {
  const days = new Set();
  const add = (v) => { const k = v && dayKey(v); if (k) days.add(k); };
  attempts.forEach((a) => add(a.created_date));
  rows.forEach((r) => add(r.progress?.updated_date));
  schedules.forEach((s) => add(s.last_reviewed && `${s.last_reviewed.slice(0, 10)}T12:00:00`));
  certificates.forEach((c) => add(c.created_date));
  return days;
}

// Consecutive active days ending today — or yesterday, so the streak survives until
// the learner has had a chance to study today.
export function currentStreak(days, now = new Date()) {
  let cursor = new Date(now);
  if (!days.has(dayKey(cursor))) cursor = new Date(cursor.getTime() - DAY_MS);
  let streak = 0;
  while (days.has(dayKey(cursor))) {
    streak += 1;
    cursor = new Date(cursor.getTime() - DAY_MS);
  }
  return streak;
}

// Monday-to-Sunday of the current week, each flagged active/today/future.
export function currentWeek(days, now = new Date()) {
  const monday = new Date(now);
  monday.setHours(12, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const today = dayKey(now);
  return WEEKDAYS.map((label, i) => {
    const key = dayKey(new Date(monday.getTime() + i * DAY_MS));
    return { label, key, active: days.has(key), isToday: key === today, isFuture: key > today };
  });
}

// Quiz attempts and average score per day over the last `span` days.
export function attemptSeries(attempts = [], span = 7, now = new Date()) {
  const buckets = [];
  for (let i = span - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * DAY_MS);
    buckets.push({
      key: dayKey(date),
      label: span <= 7 ? WEEKDAYS[(date.getDay() + 6) % 7] : `${date.getDate()}/${date.getMonth() + 1}`,
      attempts: 0,
      total: 0,
    });
  }
  const byKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const a of attempts) {
    const b = byKey[dayKey(a.created_date)];
    if (!b) continue;
    b.attempts += 1;
    b.total += a.percentage || 0;
  }
  return buckets.map(({ key, label, attempts: n, total }) => ({ key, label, attempts: n, score: n ? Math.round(total / n) : null }));
}

// "8-12 minutes" → 10, "15 min" → 15, "1 hour" → 60. Unparseable targets are skipped.
export function parseMinutes(target) {
  if (!target) return null;
  const nums = String(target).match(/\d+(\.\d+)?/g)?.map(Number);
  if (!nums?.length) return null;
  const mid = nums.length > 1 ? (nums[0] + nums[1]) / 2 : nums[0];
  return /hour|hr/i.test(target) ? mid * 60 : mid;
}

// Estimated remaining time for a course from its lessons' duration targets.
export function estimateMinutes(lessons = [], completed = []) {
  const done = new Set(completed);
  let minutes = 0;
  let known = 0;
  for (const l of lessons) {
    if (done.has(l.id)) continue;
    const m = parseMinutes(l.duration_target);
    if (m != null) { minutes += m; known += 1; }
  }
  return known ? Math.round(minutes) : null;
}

export function formatMinutes(minutes) {
  if (minutes == null) return null;
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function learnerStats({ rows = [], attempts = [], certificates = [] }) {
  const completedRows = rows.filter((r) => isCourseComplete(r.progress));
  const inProgressRows = rows.filter((r) => !isCourseComplete(r.progress));
  const avgScore = attempts.length
    ? Math.round(attempts.reduce((s, a) => s + (a.percentage || 0), 0) / attempts.length)
    : null;
  const avgProgress = inProgressRows.length
    ? Math.round(inProgressRows.reduce((s, r) => s + (r.progress?.percentage || 0), 0) / inProgressRows.length)
    : 0;
  return {
    started: rows.length,
    inProgress: inProgressRows.length,
    completed: completedRows.length,
    avgScore,
    avgProgress,
    attempts: attempts.length,
    certificates: certificates.length,
  };
}

// Milestones computed from the learner's real numbers. `value`/`goal` drive progress.
export function milestones(stats, streak) {
  return [
    { key: 'starter', label: 'First Steps', hint: 'Start a course', value: stats.started, goal: 1, tone: 'cyan' },
    { key: 'quiz', label: 'Quiz Master', hint: '80%+ average over 3 attempts', value: stats.attempts >= 3 ? stats.avgScore ?? 0 : 0, goal: 80, tone: 'violet', display: stats.attempts >= 3 && stats.avgScore != null ? `${stats.avgScore}%` : `${stats.attempts}/3` },
    { key: 'hero', label: 'Course Hero', hint: 'Complete 5 courses', value: stats.completed, goal: 5, tone: 'green' },
    { key: 'consistent', label: 'Consistent', hint: 'Keep a 7-day streak', value: streak, goal: 7, tone: 'orange' },
  ].map((m) => ({ ...m, unlocked: m.value >= m.goal, display: m.display ?? `${Math.min(m.value, m.goal)}/${m.goal}` }));
}

// Things with a date or a next step: final tests that are ready, and flashcard reviews.
export function upcomingItems({ rows = [], schedules = [], courses = [] }) {
  const items = [];
  for (const { course, progress } of rows) {
    if ((progress?.percentage ?? 0) >= 100 && !progress?.final_passed) {
      items.push({ key: `final-${course.id}`, kind: 'final', title: `${course.title} — Final test`, when: 'Ready to take', sort: '0', to: `/test/final/${course.id}` });
    }
  }
  const today = todayIso();
  const byCourse = {};
  for (const s of schedules) {
    if (!s.due_date || !s.course_id) continue;
    const due = s.due_date.slice(0, 10);
    const entry = byCourse[s.course_id] || { due, count: 0 };
    if (due < entry.due) entry.due = due;
    if (due <= today) entry.count += 1;
    byCourse[s.course_id] = entry;
  }
  for (const [courseId, { due, count }] of Object.entries(byCourse)) {
    const course = courses.find((c) => c.id === courseId);
    if (!course) continue;
    items.push({
      key: `review-${courseId}`,
      kind: 'review',
      title: `${course.title} — Flashcard review`,
      when: due <= today ? `${count} card${count === 1 ? '' : 's'} due today` : `Next review ${formatDay(due)}`,
      due: due <= today,
      sort: `1${due}`,
      to: `/courses/${courseId}`,
    });
  }
  return items.sort((a, b) => a.sort.localeCompare(b.sort));
}

function formatDay(iso) {
  const tomorrow = new Date(Date.now() + DAY_MS).toISOString().slice(0, 10);
  if (iso === tomorrow) return 'tomorrow';
  return new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}
