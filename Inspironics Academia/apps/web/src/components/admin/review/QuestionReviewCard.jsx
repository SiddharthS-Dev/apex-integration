import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import StatusBadge from '@/components/admin/StatusBadge';
import ReviewDecisionButtons from '@/components/admin/review/ReviewDecisionButtons';
import useEntityUpdate from '@/components/admin/review/useEntityUpdate';

export default function QuestionReviewCard({ question, index }) {
  const update = useEntityUpdate('Question');
  const setStatus = (status) => update.mutate({ id: question.id, data: { status } });
  const options = Array.isArray(question.options) ? question.options : [];

  return (
    <div className="rounded-xl border border-border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm font-medium">{index + 1}. {question.question_text}</div>
        <StatusBadge status={question.status} />
      </div>
      <ul className="space-y-1.5">
        {options.map((opt, i) => {
          const correct = opt === question.correct_answer;
          const Icon = correct ? CheckCircle2 : Circle;
          return (
            <li
              key={i}
              className={cn(
                'flex items-start gap-2 rounded-lg px-3 py-1.5 text-sm',
                correct ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300 font-medium' : 'text-muted-foreground',
              )}
            >
              <Icon className="w-4 h-4 mt-0.5 shrink-0" />
              {opt}
            </li>
          );
        })}
      </ul>
      {question.explanation && <p className="text-xs text-muted-foreground">{question.explanation}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1.5 text-xs text-muted-foreground capitalize">
          {question.difficulty && <span>{question.difficulty}</span>}
          {question.cognitive_level && <span>· {question.cognitive_level}</span>}
        </div>
        <ReviewDecisionButtons
          status={question.status}
          disabled={update.isPending}
          onApprove={() => setStatus('approved')}
          onReject={() => setStatus('rejected')}
        />
      </div>
    </div>
  );
}
