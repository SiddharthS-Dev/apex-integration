import { Clock, HelpCircle, PlayCircle, Target } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '@/components/ui/button';

function Fact({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl bg-muted/60 p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</div>
      <div className="font-semibold mt-1">{value}</div>
    </div>
  );
}

export default function TestIntroCard({ title, description, count, durationMinutes, passingScore, attempts = [], onStart }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 sm:p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <Fact icon={HelpCircle} label="Questions" value={count} />
        <Fact icon={Clock} label="Duration" value={durationMinutes ? `${durationMinutes} min` : 'Untimed'} />
        <Fact icon={Target} label="Pass mark" value={`${passingScore}%`} />
      </div>
      {attempts.length > 0 && (
        <div>
          <h3 className="text-sm font-medium mb-2">Previous attempts</h3>
          <ul className="divide-y divide-border rounded-xl border border-border text-sm">
            {attempts.slice(0, 5).map((a) => (
              <li key={a.id} className="flex items-center justify-between px-3 py-2">
                <span className="text-muted-foreground">{a.created_date ? format(new Date(a.created_date), 'PP p') : '—'}</span>
                <span className={a.passed ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-rose-600 dark:text-rose-400'}>
                  {a.percentage}% {a.passed ? 'passed' : 'failed'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Button size="lg" onClick={onStart} disabled={!count} className="w-full sm:w-auto">
        <PlayCircle /> {count ? 'Start test' : 'No questions available'}
      </Button>
    </div>
  );
}
