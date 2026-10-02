// Progress calculation helpers shared by learner pages.

export function lessonPercentage(completedLessons = [], totalLessons = 0) {
  if (!totalLessons) return 0;
  return Math.min(100, Math.round((completedLessons.length / totalLessons) * 100));
}

export function isLessonComplete(progress, lessonId) {
  return !!progress?.completed_lessons?.includes(lessonId);
}

// Returns the next lesson a learner should open, given ordered lessons.
export function nextLesson(orderedLessons = [], progress) {
  return orderedLessons.find((l) => !isLessonComplete(progress, l.id)) || orderedLessons[0] || null;
}

export function sortByOrder(items = []) {
  return [...items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

// Flattens modules → lessons into a single ordered list.
export function flattenLessons(modules = [], lessons = []) {
  return sortByOrder(modules).flatMap((m) =>
    sortByOrder(lessons.filter((l) => l.module_id === m.id)),
  );
}

// Marks a lesson complete, creating the progress record when needed.
export async function markLessonComplete(api, { user, courseId, lessonId, totalLessons, progress }) {
  const completed = Array.from(new Set([...(progress?.completed_lessons || []), lessonId]));
  const data = { completed_lessons: completed, percentage: lessonPercentage(completed, totalLessons), started: true };
  if (progress?.id) return api.entities.CourseProgress.update(progress.id, data);
  return api.entities.CourseProgress.create({ user_id: user.id, course_id: courseId, ...data });
}

export function generateCertificateId() {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `IEA-${Date.now().toString(36).toUpperCase()}-${rand}`;
}

// SM-2 spaced repetition. quality: 0–5.
export function sm2(schedule = {}, quality) {
  let ease = schedule.ease_factor ?? 2.5;
  let reps = schedule.reps ?? 0;
  let interval = schedule.interval_days ?? 0;
  if (quality < 3) {
    reps = 0;
    interval = 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
  }
  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
  const today = new Date();
  const due = new Date(today.getTime() + interval * 86_400_000);
  const iso = (d) => d.toISOString().slice(0, 10);
  return { ease_factor: Number(ease.toFixed(2)), reps, interval_days: interval, due_date: iso(due), last_reviewed: iso(today) };
}
