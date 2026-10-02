import { CheckCircle2, Circle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { correctIndex } from '@/components/admin/questions/questionData';

export default function QuestionOptions({ question }) {
  const correct = correctIndex(question);
  const options = question.options || [];
  if (!options.length) return <p className="text-sm text-muted-foreground">No options.</p>;
  return (
    <ul className="grid gap-2 sm:grid-cols-2">
      {options.map((option, i) => {
        const isCorrect = i === correct;
        const Icon = isCorrect ? CheckCircle2 : Circle;
        return (
          <li
            key={i}
            className={cn(
              'flex items-start gap-2 rounded-lg border px-3 py-2 text-sm',
              isCorrect
                ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200'
                : 'border-border',
            )}
          >
            <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', isCorrect ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')} />
            <span>
              <span className="font-medium mr-1">{String.fromCharCode(65 + i)}.</span>
              {option}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
