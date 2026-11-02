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

// The learner's own calendar day (YYYY-MM-DD). Review queues and due dates follow their midnight,
// so functions that schedule are sent this rather than the UTC date.
export function localDay(date = new Date()) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}
