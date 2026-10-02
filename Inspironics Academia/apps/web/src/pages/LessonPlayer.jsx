import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { BookX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { isLessonComplete, markLessonComplete } from '@/lib/progress';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import AiVideoPlayer from '@/components/AiVideoPlayer';
import { parseScenes } from '@/components/lesson/scenes';
import useCourseData from '@/components/course/useCourseData';
import LessonSidebar from '@/components/lesson/LessonSidebar';
import LessonTitleBar from '@/components/lesson/LessonTitleBar';
import LessonContentCard from '@/components/lesson/LessonContentCard';
import LessonNav from '@/components/lesson/LessonNav';

export default function LessonPlayer() {
  const { courseId, lessonId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const { user, course, modules, lessons, ordered, progress, isLoading } = useCourseData(courseId, { allLessons: isAdmin });
  const [busy, setBusy] = useState(false);

  if (isLoading) return <LoadingState label="Loading lesson…" />;
  const idx = ordered.findIndex((l) => l.id === lessonId);
  const lesson = ordered[idx];
  if (!course || !lesson) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={BookX} title="Lesson not available" description="This lesson doesn't exist or hasn't been published yet." />
      </div>
    );
  }
  const prev = ordered[idx - 1] || null;
  const next = ordered[idx + 1] || null;
  const completed = isLessonComplete(progress, lesson.id);
  const totalLessons = lessons.filter((l) => l.status === 'approved').length || ordered.length;

  const handleComplete = async () => {
    setBusy(true);
    try {
      if (!completed) {
        await markLessonComplete(api, { user, courseId, lessonId: lesson.id, totalLessons, progress });
        await queryClient.invalidateQueries({ queryKey: ['progress'] });
      }
      if (next) navigate(`/learn/${courseId}/${next.id}`);
      else {
        if (!completed) toast.success('You finished the last lesson — time for the tests!');
        navigate(`/courses/${courseId}`);
      }
    } catch (e) {
      toast.error(e?.message || 'Could not update progress');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px] items-start">
        <div className="space-y-5 min-w-0">
          <AiVideoPlayer
            key={`video-${lesson.id}`}
            videoUrl={lesson.video_url}
            audioUrl={lesson.audio_url}
            title={lesson.video_title || lesson.title}
            narrationText={lesson.teaching_script || lesson.summary}
            scenes={parseScenes(lesson)}
            context={{ course: course.title, module: modules.find((m) => m.id === lesson.module_id)?.title }}
          />
          <LessonTitleBar lesson={lesson} course={course} previewStatus={lesson.status !== 'approved' ? lesson.status || 'pending' : null} />
          <LessonContentCard key={`content-${lesson.id}`} lesson={lesson} courseId={courseId} />
          <LessonNav courseId={courseId} prev={prev} next={next} completed={completed} busy={busy} onComplete={handleComplete} />
        </div>
        <LessonSidebar courseId={courseId} modules={modules} lessons={lessons} progress={progress} currentId={lesson.id} />
      </div>
    </div>
  );
}
