import { useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileX } from 'lucide-react';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CourseTree from '@/components/admin/CourseTree';
import LessonReviewPanel from '@/components/admin/LessonReviewPanel';
import CoverageMap from '@/components/admin/CoverageMap';
import ReviewProgress from '@/components/admin/ReviewProgress';
import StudioHeader from '@/components/admin/studio/StudioHeader';
import StudioActions from '@/components/admin/studio/StudioActions';
import GenerationProgress from '@/components/admin/studio/GenerationProgress';
import StudioEmpty from '@/components/admin/studio/StudioEmpty';
import AiDisabledNotice from '@/components/admin/studio/AiDisabledNotice';
import useStudioData from '@/components/admin/studio/useStudioData';
import useStudioActions from '@/components/admin/studio/useStudioActions';
import { flattenLessons } from '@/lib/progress';

export default function ContentStudio() {
  const { playbookId } = useParams();
  const { data, isLoading, error } = useStudioData(playbookId);
  const actions = useStudioActions(data);
  const [selectedId, setSelectedId] = useState(null);

  const ordered = useMemo(() => flattenLessons(data?.modules, data?.lessons), [data]);
  const lesson = ordered.find((l) => l.id === selectedId) || ordered[0] || null;
  const lessonModule = lesson && data.modules.find((m) => m.id === lesson.module_id);
  const lessonQuestions = lesson ? data.questions.filter((q) => q.lesson_id === lesson.id) : [];
  const lessonCards = lesson ? data.flashcards.filter((f) => f.lesson_id === lesson.id) : [];

  if (isLoading) return <LoadingState label="Loading studio…" />;
  if (error || !data?.playbook) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={FileX} title="Playbook not found" description={error?.message} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <AiDisabledNotice />
      <StudioHeader playbook={data.playbook} course={data.course} actions={data.course && <StudioActions actions={actions} />} />
      <GenerationProgress job={actions.job} />
      {!data.course ? (
        <StudioEmpty busy={actions.busy} onBuild={actions.buildStructure} chapterCount={data.chapters.length} />
      ) : (
        <>
          <ReviewProgress lessons={data.lessons} questions={data.questions} flashcards={data.flashcards} />
          <div className="grid lg:grid-cols-12 gap-6">
            <div className="lg:col-span-4">
              <div className="lg:sticky lg:top-6">
                <CourseTree modules={data.modules} lessons={data.lessons} selectedId={lesson?.id} onSelect={setSelectedId} />
              </div>
            </div>
            <div className="lg:col-span-8 space-y-6 min-w-0">
              <LessonReviewPanel lesson={lesson} module={lessonModule} questions={lessonQuestions} flashcards={lessonCards} />
              <CoverageMap chapters={data.chapters} lessons={data.lessons} onSelectLesson={setSelectedId} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
