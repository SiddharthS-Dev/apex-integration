import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import LoadingState from '@/components/LoadingState';
import QuizRunner from '@/components/QuizRunner';

export default function LessonQuizTab({ lesson, courseId }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['lesson-questions', lesson.id],
    queryFn: async () =>
      (await api.entities.Question.filter({ lesson_id: lesson.id }, 'created_date', 100)).filter(
        (q) => q.status === 'approved' && !q.assessment_id,
      ),
  });

  const handleComplete = async (r) => {
    try {
      await api.entities.QuizAttempt.create({
        user_id: user.id, course_id: courseId, module_id: lesson.module_id, lesson_id: lesson.id,
        type: 'lesson', score: r.score, total: r.total, percentage: r.percentage, passed: r.passed,
      });
      queryClient.invalidateQueries({ queryKey: ['attempts'] });
    } catch (e) {
      toast.error(e?.message || 'Could not save quiz attempt');
    }
  };

  if (isLoading) return <LoadingState label="Loading quiz…" />;
  return <QuizRunner questions={questions} title="Lesson quiz" onComplete={handleComplete} />;
}
