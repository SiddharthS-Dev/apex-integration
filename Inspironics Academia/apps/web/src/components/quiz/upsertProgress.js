import { api } from '@/api/client';

// Reads the latest CourseProgress for (user, course) and applies `patch(existing)`,
// creating the record when missing.
export default async function upsertProgress({ userId, courseId, patch }) {
  const existing = (await api.entities.CourseProgress.filter({ user_id: userId, course_id: courseId }))[0] || null;
  const data = patch(existing);
  if (existing) return api.entities.CourseProgress.update(existing.id, data);
  return api.entities.CourseProgress.create({
    user_id: userId,
    course_id: courseId,
    completed_lessons: [],
    completed_chapters: [],
    started: true,
    ...data,
  });
}
