import { ShieldCheck } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

const countApproved = (items = []) => items.filter((i) => i.status === 'approved').length;

export default function ReviewProgress({ lessons = [], questions = [], flashcards = [] }) {
  const approved = countApproved(lessons);
  const pct = lessons.length ? Math.round((approved / lessons.length) * 100) : 0;
  const stats = [
    { label: 'Lessons', done: approved, total: lessons.length },
    { label: 'Questions', done: countApproved(questions), total: questions.length },
    { label: 'Flashcards', done: countApproved(flashcards), total: flashcards.length },
  ];

  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          Review progress
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {stats.map((s) => (
            <span key={s.label} className="text-muted-foreground">
              {s.label}: <span className="font-medium text-foreground tabular-nums">{s.done} / {s.total}</span>
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Progress value={pct} indicatorClassName="bg-none bg-emerald-500" className="h-2.5" />
        <span className="text-sm font-medium tabular-nums w-12 text-right">{pct}%</span>
      </div>
    </div>
  );
}
