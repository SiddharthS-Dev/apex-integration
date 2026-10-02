import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BookX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { nextLesson } from '@/lib/progress';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import useCourseData from '@/components/course/useCourseData';
import CourseHero from '@/components/course/CourseHero';
import ModuleAccordion from '@/components/course/ModuleAccordion';
import FinalTestCard from '@/components/course/FinalTestCard';

export default function CourseView() {
  const { courseId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, course, modules, lessons, ordered, progress, isLoading } = useCourseData(courseId);
  const [starting, setStarting] = useState(false);

  const handleStart = async () => {
    const target = nextLesson(ordered, progress);
    if (!target) return;
    setStarting(true);
    try {
      if (!progress) {
        await api.entities.CourseProgress.create({
          user_id: user.id, course_id: courseId, started: true, completed_lessons: [], completed_chapters: [],
        });
      } else if (!progress.started) {
        await api.entities.CourseProgress.update(progress.id, { started: true });
      }
      queryClient.invalidateQueries({ queryKey: ['progress'] });
      navigate(`/learn/${courseId}/${target.id}`);
    } catch (e) {
      toast.error(e?.message || 'Could not start the course');
    } finally {
      setStarting(false);
    }
  };

  if (isLoading) return <LoadingState label="Loading course…" />;
  if (!course) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={BookX} title="Course not available" description="This course doesn't exist or hasn't been published yet." />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <CourseHero
        course={course} moduleCount={modules.length} lessonCount={ordered.length}
        progress={progress} onStart={handleStart} starting={starting} canStart={ordered.length > 0}
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div>
          <h2 className="text-lg font-semibold mb-3">Course content</h2>
          {modules.length === 0 ? (
            <EmptyState title="No modules yet" description="Content for this course is on its way." />
          ) : (
            <ModuleAccordion modules={modules} lessons={lessons} progress={progress} courseId={courseId} />
          )}
        </div>
        <div className="lg:sticky lg:top-24">
          <FinalTestCard courseId={courseId} progress={progress} />
        </div>
      </div>
    </div>
  );
}
