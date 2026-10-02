import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, ClipboardX } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { generateCertificateId } from '@/lib/progress';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import QuizRunner from '@/components/QuizRunner';
import TestIntroCard from '@/components/quiz/TestIntroCard';
import TestPageHeader from '@/components/quiz/TestPageHeader';
import loadTestQuestions from '@/components/quiz/loadTestQuestions';
import upsertProgress from '@/components/quiz/upsertProgress';

async function loadFinalTest(courseId) {
  const course = await api.entities.Course.get(courseId);
  const [assessments, modules] = await Promise.all([
    api.entities.Assessment.filter({ course_id: courseId }, '-created_date', 100),
    api.entities.Module.filter({ course_id: courseId }, 'order', 200),
  ]);
  const published = assessments.filter((a) => a.status === 'published');
  const preferred = [
    ...published.filter((a) => a.type === 'certification'),
    ...published.filter((a) => a.type === 'course_assessment'),
  ];
  const lessons = modules.length
    ? await api.entities.Lesson.filter({ module_id: { $in: modules.map((m) => m.id) } }, 'order', 1000)
    : [];
  const { assessment, questions } = await loadTestQuestions({
    assessments: preferred,
    lessonIds: lessons.filter((l) => l.status === 'approved').map((l) => l.id),
    limit: 30,
  });
  return { course: course?.status === 'published' ? course : null, assessment, questions };
}

async function issueCertificate(user, course, score) {
  const existing = await api.entities.Certificate.filter({ user_id: user.id, course_id: course.id });
  if (existing.length) return existing[0];
  return api.entities.Certificate.create({
    user_id: user.id, course_id: course.id, course_title: course.title,
    user_name: user.full_name || user.email, score,
    completion_date: new Date().toISOString().slice(0, 10), certificate_id: generateCertificateId(),
  });
}

export default function FinalTest() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [started, setStarted] = useState(false);
  const [certified, setCertified] = useState(false);

  const testQ = useQuery({ queryKey: ['final-test', courseId], queryFn: () => loadFinalTest(courseId), staleTime: Infinity });
  const attemptsQ = useQuery({
    queryKey: ['attempts', user?.id, 'final', courseId],
    queryFn: () => api.entities.QuizAttempt.filter({ user_id: user.id, course_id: courseId, type: 'final' }, '-created_date', 20),
    enabled: !!user,
  });

  if (testQ.isLoading) return <LoadingState label="Preparing final test…" />;
  const data = testQ.data;
  if (!data?.course) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState icon={ClipboardX} title="Final test unavailable" description="This course isn't available." />
      </div>
    );
  }
  const { course, assessment, questions } = data;
  const passingScore = assessment?.passing_score ?? 70;
  const duration = assessment?.duration_minutes || 60;

  const handleComplete = async (r) => {
    try {
      await api.entities.QuizAttempt.create({
        user_id: user.id, course_id: course.id, assessment_id: assessment?.id,
        type: 'final', score: r.score, total: r.total, percentage: r.percentage, passed: r.passed,
      });
      await upsertProgress({
        userId: user.id, courseId: course.id,
        patch: (p) => ({
          final_score: Math.max(p?.final_score || 0, r.percentage),
          final_passed: !!p?.final_passed || r.passed,
        }),
      });
      if (r.passed) {
        await issueCertificate(user, course, r.percentage);
        setCertified(true);
        toast.success('Congratulations — your certificate is ready!');
      }
      ['progress', 'attempts', 'certificates', 'certificate'].forEach((k) => queryClient.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      toast.error(e?.message || 'Could not save your result');
    }
  };

  const certificateAction = certified ? (
    <Button asChild className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90">
      <Link to={`/certificate/${course.id}`}><Award />View certificate</Link>
    </Button>
  ) : null;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <TestPageHeader courseId={course.id} courseTitle={course.title} kicker="Final test" title={assessment?.title || course.title} />
        {started ? (
          <div className="rounded-2xl border border-border bg-card p-5 sm:p-6">
            <QuizRunner
              questions={questions} title="Final test" passingScore={passingScore} durationMinutes={duration}
              onComplete={handleComplete} resultActions={certificateAction}
            />
          </div>
        ) : (
          <TestIntroCard
            title="Final course test"
            description="Pass the final test to earn your verifiable certificate."
            count={questions.length} durationMinutes={duration} passingScore={passingScore}
            attempts={attemptsQ.data || []} onStart={() => setStarted(true)}
          />
        )}
      </div>
    </div>
  );
}
