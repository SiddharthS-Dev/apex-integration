import { Progress } from '@/components/ui/progress';
import QuizTimer from '@/components/quiz/QuizTimer';

export default function QuizProgressHeader({ title, index, count, answered, durationMinutes, onExpire }) {
  return (
    <div className="space-y-3 mb-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          {title && <h3 className="font-semibold truncate">{title}</h3>}
          <p className="text-xs text-muted-foreground">
            Question {index + 1} of {count} · {answered} answered
          </p>
        </div>
        {durationMinutes > 0 && <QuizTimer minutes={durationMinutes} onExpire={onExpire} />}
      </div>
      <Progress value={((index + 1) / count) * 100} />
    </div>
  );
}
