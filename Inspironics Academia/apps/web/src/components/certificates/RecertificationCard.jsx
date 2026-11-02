import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { CheckCircle2, Circle, ClipboardCheck, Hourglass, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const fmt = (iso) => (iso ? format(new Date(`${iso}T12:00:00`), 'MMM d, yyyy') : '');

const STATE = {
  awaiting_course: { label: 'Awaiting updated course', className: 'bg-muted text-muted-foreground' },
  pending: { label: 'Due', className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  overdue: { label: 'Overdue', className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  completed: { label: 'Completed', className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  waived: { label: 'Waived', className: 'bg-muted text-muted-foreground' },
};

function stateText(r) {
  if (r.state === 'awaiting_course') return 'The updated course is being prepared. You will be notified when it is published.';
  if (r.state === 'overdue') return `Was due ${fmt(r.due_date)} (${-r.days_left} day${r.days_left === -1 ? '' : 's'} ago).`;
  if (r.state === 'pending') return r.days_left === 0 ? 'Due today.' : `Due ${fmt(r.due_date)} — ${r.days_left} day${r.days_left === 1 ? '' : 's'} left.`;
  if (r.state === 'completed') return `Recertified ${fmt(r.completed_date)}${r.new_certificate_id ? ` · ${r.new_certificate_id}` : ''}.`;
  return `Waived ${fmt(r.completed_date)}${r.waived_reason ? ` — ${r.waived_reason}` : ''}.`;
}

// One recertification: why it's needed, what changed, the lessons to revisit and the test to pass.
export default function RecertificationCard({ recert: r }) {
  const s = STATE[r.state] || STATE.pending;
  const open = ['pending', 'overdue'].includes(r.state);
  const courseId = r.course?.id;
  const lessons = r.delta_lessons || [];
  return (
    <div className={cn('rounded-2xl border bg-card p-5 flex flex-col gap-4', r.state === 'overdue' ? 'border-rose-300 dark:border-rose-500/40' : 'border-border')}>
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 flex items-center justify-center shrink-0">
          {r.state === 'awaiting_course' ? <Hourglass className="w-5 h-5" /> : <RefreshCw className="w-5 h-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold leading-snug">{r.playbook_title || 'Playbook'}</h3>
            <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', s.className)}>{s.label}</span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {r.reason === 'expired'
              ? 'Your certificate reached the end of its validity period.'
              : `Updated ${r.from_version ? `from ${r.from_version} ` : ''}${r.to_version ? `to ${r.to_version}` : ''}`.trim()}
          </p>
          <p className="text-sm mt-1.5">{stateText(r)}</p>
        </div>
      </div>

      {(r.changed_chapters?.length > 0 || r.removed_chapters?.length > 0) && (
        <div className="text-sm">
          <div className="text-xs font-medium text-muted-foreground mb-1.5">What changed</div>
          <div className="flex flex-wrap gap-1.5">
            {r.changed_chapters.map((c) => <span key={c} className="rounded-md bg-primary/10 text-primary px-2 py-0.5 text-xs">{c}</span>)}
            {(r.removed_chapters || []).map((c) => <span key={c} className="rounded-md bg-muted text-muted-foreground px-2 py-0.5 text-xs line-through">{c}</span>)}
          </div>
        </div>
      )}

      {open && courseId && lessons.length > 0 && (
        <div>
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
            <span className="font-medium">Lessons to revisit</span>
            <span className="tabular-nums">{r.delta_completed}/{lessons.length} done</span>
          </div>
          <ul className="space-y-1">
            {lessons.map((l) => (
              <li key={l.id}>
                <Link to={`/learn/${courseId}/${l.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted">
                  {l.completed ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
                  <span className={cn('truncate', l.completed && 'text-muted-foreground')}>{l.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open && courseId && (
        <div className="flex flex-wrap gap-2 mt-auto">
          <Button asChild size="sm"><Link to={`/test/final/${courseId}`}><ClipboardCheck /> Take the final test</Link></Button>
          <Button asChild size="sm" variant="outline"><Link to={`/courses/${courseId}`}>Open {r.course?.title ? 'course' : 'updated course'}</Link></Button>
        </div>
      )}
    </div>
  );
}
