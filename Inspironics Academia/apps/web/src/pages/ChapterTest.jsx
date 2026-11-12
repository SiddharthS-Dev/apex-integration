import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import QuizRunner from '@/components/QuizRunner';
import TestIntroCard from '@/components/quiz/TestIntroCard';
import TestPageHeader from '@/components/quiz/TestPageHeader';
import loadTestQuestions from '@/components/quiz/loadTestQuestions';

async function loadChapterTest(moduleId) {
  const module = await api.entities.Module.get(moduleId);
  const [course, assessments, lessons] = await Promise.all([
    api.entities.Course.get(module.course_id).catch(() => null),
    api.entities.Assessment.filter({ module_id: moduleId, type: 'module_test' }, '-created_date', 20),
    api.entities.Lesson.filter({ module_id: moduleId }, 'order', 500),
  ]);
  const { assessment, questions } = await loadTestQuestions({
    assessments: assessments.filter((a) => a.status === 'published'),
    lessonIds: lessons.filter((l) => l.status === 'approved').map((l) => l.id),
  });
  return { module, course: course?.status === 'published' ? course : null, assessment, questions };
}

export default function ChapterTest() {
  const { moduleId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [started, setStarted] = useState(false);

  const testQ = useQuery({ queryKey: ['chapter-test', moduleId], queryFn: () => loadChapterTest(moduleId), staleTime: Infinity });
  const attemptsQ = useQuery({
    queryKey: ['attempts', user?.id, 'chapter', moduleId],
    queryFn: () => api.entities.QuizAttempt.filter({ user_id: user.id, module_id: moduleId, type: 'chapter' }, '-created_date', 20),
    enabled: !!user,
  });

  if (testQ.isLoading) return <LoadingState label="Preparing chapter test…" />;
  const data = testQ.data;
  if (!data?.course) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={ClipboardX} title="Chapter test unavailable" description="This chapter or its course isn't available." />
      </div>
    );
  }
  const { module, course, assessment, questions } = data;
  const passingScore = assessment?.passing_score ?? 70;
  const duration = assessment?.duration_minutes || undefined;

  // The server grades the answers, records the attempt and, on a pass, marks the chapter complete.
  const grade = async (answers) => (await api.functions.invoke('submitQuiz', { type: 'chapter', module_id: module.id, answers })).data;
  const handleComplete = (r) => {
    if (r.passed) toast.success('Chapter test passed!');
    queryClient.invalidateQueries({ queryKey: ['progress'] });
    queryClient.invalidateQueries({ queryKey: ['attempts'] });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <TestPageHeader courseId={course.id} courseTitle={course.title} kicker="Chapter test" title={module.title} />
        {started ? (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <QuizRunner questions={questions} title={assessment?.title || module.title} passingScore={passingScore} durationMinutes={duration} grade={grade} onComplete={handleComplete} />
          </div>
        ) : (
          <TestIntroCard
            title={assessment?.title || `${module.title} — chapter test`}
            description="Pass this test to mark the chapter as mastered."
            count={questions.length} durationMinutes={duration} passingScore={passingScore}
            attempts={attemptsQ.data || []} onStart={() => setStarted(true)}
          />
        )}
      </div>
    </div>
  );
}
