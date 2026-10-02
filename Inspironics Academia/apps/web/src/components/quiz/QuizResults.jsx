import { Award, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import QuestionReview from '@/components/quiz/QuestionReview';

export default function QuizResults({ result, questions, passingScore, onRetry, children }) {
  const Icon = result.passed ? Award : XCircle;
  return (
    <div className="space-y-5">
      <div
        className={cn(
          'rounded-2xl p-6 text-center',
          result.passed
            ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-500/10 dark:text-emerald-200'
            : 'bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200',
        )}
      >
        <Icon className="w-10 h-10 mx-auto mb-2" />
        <div className="text-4xl font-bold">{result.percentage}%</div>
        <p className="mt-1 text-sm">
          {result.score} / {result.total} marks · {result.passed ? 'Passed' : `Passing score is ${passingScore}%`}
        </p>
        <div className="flex flex-wrap justify-center gap-2 mt-4">
          <Button variant="outline" onClick={onRetry}>
            <RotateCcw /> Retry
          </Button>
          {children}
        </div>
      </div>
      <h4 className="font-semibold">Review answers</h4>
      <div className="space-y-3">
        {questions.map((q, i) => (
          <QuestionReview key={q.id} question={q} index={i} answer={result.answers[i]} />
        ))}
      </div>
    </div>
  );
}
