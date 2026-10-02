import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { flattenLessons, nextLesson, sortByOrder } from '@/lib/progress';

// Shared learner-side data hooks. Admins receive every record through RLS, so all
// content queries are filtered client-side to learner-visible statuses.

export const isCourseComplete = (p) => !!p && (!!p.final_passed || (p.percentage ?? 0) >= 100);

export const todayIso = () => new Date().toISOString().slice(0, 10);

export function usePublishedCourses() {
  return useQuery({
    queryKey: ['published-courses'],
    queryFn: async () => {
      const list = await api.entities.Course.filter({ status: 'published' }, '-updated_date', 200);
      return list.filter((c) => c.status === 'published');
    },
  });
}

function useOwned(entity, key, sort, limit = 200) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [key, user?.id, 'mine'],
    enabled: !!user?.id,
    queryFn: () => api.entities[entity].filter({ user_id: user.id }, sort, limit),
  });
}

export const useMyProgress = () => useOwned('CourseProgress', 'progress', '-updated_date');
export const useMyAttempts = () => useOwned('QuizAttempt', 'attempts', '-created_date');
export const useMyCertificates = () => useOwned('Certificate', 'certificates', '-created_date', 100);
export const useMyReviewSchedules = () => useOwned('ReviewSchedule', 'review-schedules', 'due_date', 1000);
export const useMyBookmarks = () => useOwned('Bookmark', 'bookmarks', '-created_date');

// Joins the learner's progress records with published courses (one row per course).
export function useMyCourseRows() {
  const courses = usePublishedCourses();
  const progress = useMyProgress();
  const seen = new Set();
  const rows = [];
  for (const p of progress.data || []) {
    const course = (courses.data || []).find((c) => c.id === p.course_id);
    if (!course || seen.has(course.id)) continue;
    seen.add(course.id);
    rows.push({ course, progress: p });
  }
  return { rows, courses: courses.data || [], isLoading: courses.isLoading || progress.isLoading };
}

// Loads modules + approved lessons for the given courses: { [courseId]: { modules, lessons } }.
export function useCourseOutlines(courseIds = []) {
  const ids = [...new Set(courseIds)].sort();
  return useQuery({
    queryKey: ['course-outlines', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      const modules = await api.entities.Module.filter({ course_id: { $in: ids } }, 'order', 1000);
      const moduleIds = modules.map((m) => m.id);
      const lessons = moduleIds.length
        ? (await api.entities.Lesson.filter({ module_id: { $in: moduleIds } }, 'order', 5000)).filter((l) => l.status === 'approved')
        : [];
      return Object.fromEntries(ids.map((id) => {
        const mods = sortByOrder(modules.filter((m) => m.course_id === id));
        return [id, { modules: mods, lessons: flattenLessons(mods, lessons) }];
      }));
    },
  });
}

export function continueHref(courseId, outline, progress) {
  const lesson = nextLesson(outline?.lessons || [], progress);
  return lesson ? `/learn/${courseId}/${lesson.id}` : `/courses/${courseId}`;
}
