import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import LoadingState from '@/components/LoadingState';
import QuizRunner from '@/components/QuizRunner';

export default function LessonQuizTab({ lesson }) {
  const queryClient = useQueryClient();
  const { data: questions = [], isLoading } = useQuery({
    queryKey: ['lesson-questions', lesson.id],
    queryFn: async () =>
      (await api.entities.Question.filter({ lesson_id: lesson.id }, 'created_date', 100)).filter(
        (q) => q.status === 'approved' && !q.assessment_id,
      ),
  });

  // The server grades the answers and records the attempt; the questions arrive without answers.
  const grade = async (answers) => (await api.functions.invoke('submitQuiz', { type: 'lesson', lesson_id: lesson.id, answers })).data;
  const handleComplete = () => queryClient.invalidateQueries({ queryKey: ['attempts'] });

  if (isLoading) return <LoadingState label="Loading quiz…" />;
  return <QuizRunner questions={questions} title="Lesson quiz" grade={grade} onComplete={handleComplete} />;
}
