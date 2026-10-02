import { HelpCircle } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import QuestionReviewCard from '@/components/admin/review/QuestionReviewCard';

export default function QuizTab({ questions = [] }) {
  if (!questions.length) {
    return <EmptyState icon={HelpCircle} title="No quiz questions" description="Generate lesson content to create quiz questions." />;
  }
  return (
    <div className="space-y-3">
      {questions.map((q, i) => (
        <QuestionReviewCard key={q.id} question={q} index={i} />
      ))}
    </div>
  );
}
