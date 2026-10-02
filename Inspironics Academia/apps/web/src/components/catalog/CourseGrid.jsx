import { Skeleton } from '@/components/ui/skeleton';
import CourseCard from '@/components/catalog/CourseCard';

export default function CourseGrid({ courses, progressByCourse, loading }) {
  if (loading) {
    return (
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {[0, 1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-60 rounded-2xl" />)}
      </div>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
      {courses.map((c) => <CourseCard key={c.id} course={c} progress={progressByCourse[c.id]} />)}
    </div>
  );
}
