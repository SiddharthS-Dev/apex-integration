import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function QuestionReview({ question, answer, index }) {
  const ok = answer?.is_correct;
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <div className="rounded-xl border border-border p-4 space-y-2">
      <div className="flex items-start gap-2">
        <Icon className={cn('w-5 h-5 shrink-0 mt-0.5', ok ? 'text-emerald-500' : 'text-rose-500')} />
        <p className="font-medium">
          {index + 1}. {question.question_text}
        </p>
      </div>
      <div className="pl-7 space-y-1 text-sm">
        {!ok && (
          <p className="text-rose-600 dark:text-rose-400">
            Your answer: {answer?.selected ?? <em>Not answered</em>}
          </p>
        )}
        {/* The answer and explanation come from the server's review of this attempt. */}
        <p className="text-emerald-600 dark:text-emerald-400">Correct answer: {answer?.correct_answer ?? question.correct_answer}</p>
        {(answer?.explanation || question.explanation) && <p className="text-muted-foreground">{answer?.explanation || question.explanation}</p>}
      </div>
    </div>
  );
}
