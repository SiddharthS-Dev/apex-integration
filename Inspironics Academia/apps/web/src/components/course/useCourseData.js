import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { flattenLessons, sortByOrder } from '@/lib/progress';

// Loads a course with its modules, lessons and the viewer's CourseProgress.
// Lessons are limited to approved ones unless `allLessons` is set (admin preview).
export default function useCourseData(courseId, { allLessons = false } = {}) {
  const { user, isAdmin } = useAuth();

  const courseQ = useQuery({
    queryKey: ['course', courseId],
    queryFn: () => api.entities.Course.get(courseId),
    enabled: !!courseId,
  });
  const modulesQ = useQuery({
    queryKey: ['modules', courseId],
    queryFn: () => api.entities.Module.filter({ course_id: courseId }, 'order', 200),
    enabled: !!courseId,
  });
  const moduleIds = (modulesQ.data || []).map((m) => m.id);
  const lessonsQ = useQuery({
    queryKey: ['lessons', courseId, moduleIds.join(',')],
    queryFn: () => api.entities.Lesson.filter({ module_id: { $in: moduleIds } }, 'order', 1000),
    enabled: moduleIds.length > 0,
  });
  const progressQ = useQuery({
    queryKey: ['progress', user?.id, courseId],
    queryFn: async () =>
      (await api.entities.CourseProgress.filter({ user_id: user.id, course_id: courseId }))[0] || null,
    enabled: !!user && !!courseId,
  });

  const rawLessons = lessonsQ.data || [];
  const lessons = allLessons ? rawLessons : rawLessons.filter((l) => l.status === 'approved');
  const modules = sortByOrder(modulesQ.data || []);
  const course = courseQ.data || null;
  const courseVisible = !!course && (allLessons || course.status === 'published');

  return {
    user,
    isAdmin,
    course: courseVisible ? course : null,
    modules,
    lessons,
    ordered: flattenLessons(modules, lessons),
    progress: progressQ.data || null,
    isLoading:
      courseQ.isLoading ||
      modulesQ.isLoading ||
      (moduleIds.length > 0 && lessonsQ.isLoading) ||
      (!!user && progressQ.isLoading),
    error: courseQ.error,
  };
}
