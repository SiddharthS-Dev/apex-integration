import { ClipboardCheck } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CourseTestCard from '@/components/tests/CourseTestCard';
import AttemptHistory from '@/components/tests/AttemptHistory';
import { useCourseOutlines, useMyAttempts, useMyCourseRows } from '@/components/dashboard/useLearnerData';

export default function Tests() {
  const { rows, courses, isLoading } = useMyCourseRows();
  const { data: attempts = [], isLoading: loadingAttempts } = useMyAttempts();
  // Show started courses; fall back to every published course when nothing is started yet.
  const list = rows.length ? rows : courses.map((course) => ({ course, progress: null }));
  const { data: outlines = {} } = useCourseOutlines(list.map((r) => r.course.id));

  if (isLoading || loadingAttempts) return <LoadingState label="Loading tests…" />;

  const bestFinal = (courseId) => {
    const finals = attempts.filter((a) => a.type === 'final' && a.course_id === courseId);
    return finals.length ? Math.max(...finals.map((a) => Math.round(a.percentage || 0))) : null;
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-10">
      <PageHeader icon={ClipboardCheck} title="Tests" description="Chapter tests, final exams and your attempt history." />
      {list.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No tests available" description="Tests appear once courses are published." />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map(({ course, progress }) => (
            <CourseTestCard
              key={course.id}
              course={course}
              progress={progress}
              modules={outlines[course.id]?.modules}
              bestFinal={bestFinal(course.id)}
            />
          ))}
        </div>
      )}
      <section>
        <h2 className="text-xl font-semibold mb-4">Attempt history</h2>
        <AttemptHistory attempts={attempts} courses={courses} />
      </section>
    </div>
  );
}
