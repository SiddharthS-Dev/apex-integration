import { AlertTriangle, CalendarClock, Info } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import {
  ACTION_LABEL, PRIORITY_STYLE, STATUS_LABEL, STATUS_STYLE, dueState, formatDay, initials,
} from '@/lib/meetings';

const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap';

export function MeetingStatus({ status }) {
  return <span className={cn(pill, STATUS_STYLE[status] || STATUS_STYLE.uploaded)}>{STATUS_LABEL[status] || status}</span>;
}

export function PriorityChip({ priority = 'medium' }) {
  return <span className={cn(pill, 'capitalize', PRIORITY_STYLE[priority] || PRIORITY_STYLE.medium)}>{priority}</span>;
}

/** The due date, flagged when overdue or due within a day. */
export function DueLabel({ item }) {
  const state = dueState(item);
  if (!item.due_date) return <span className="text-muted-foreground">{item.due_text || '—'}</span>;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 tabular-nums',
        state === 'overdue' && 'font-medium text-rose-600 dark:text-rose-400',
        state === 'soon' && 'font-medium text-amber-700 dark:text-amber-300',
      )}
      title={item.due_text ? `Said in the meeting: “${item.due_text}”` : undefined}
    >
      {state === 'overdue' && <AlertTriangle className="h-3.5 w-3.5" />}
      {state === 'soon' && <CalendarClock className="h-3.5 w-3.5" />}
      {formatDay(item.due_date)}
      {state === 'overdue' && <span className="sr-only">(overdue)</span>}
    </span>
  );
}

// Fixed hue per position in the participant list, so a speaker keeps one colour on every tab.
export const SPEAKER_COLORS = [
  'bg-indigo-500', 'bg-teal-500', 'bg-amber-500', 'bg-rose-500', 'bg-sky-500', 'bg-violet-500', 'bg-emerald-500', 'bg-orange-500',
];
export const speakerColor = (participants, name) => SPEAKER_COLORS[Math.max(0, participants.indexOf(name)) % SPEAKER_COLORS.length];

export function Avatar({ name, participants = [], size = 'h-7 w-7 text-[11px]' }) {
  return (
    <span title={name} className={cn('inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-2 ring-background', size, speakerColor(participants, name))}>
      {initials(name)}
    </span>
  );
}

export function AvatarStack({ names = [], max = 5 }) {
  const shown = names.slice(0, max);
  return (
    <span className="inline-flex items-center -space-x-1.5">
      {shown.map((n) => <Avatar key={n} name={n} participants={names} />)}
      {names.length > max && (
        <span className="inline-grid h-7 w-7 place-items-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-background">+{names.length - max}</span>
      )}
    </span>
  );
}

/** Shown when the analysis came from keyword rules because AI was off. */
export function AnalysisNote({ method }) {
  if (method !== 'heuristic') return null;
  return (
    <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      Basic analysis by keyword rules — turn on AI for a written summary, key ideas and cleaner action items.
    </p>
  );
}

export function ActionStatusSelect({ value, onChange, disabled, id }) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="h-8 w-[132px] text-xs" aria-label="Status"><SelectValue /></SelectTrigger>
      <SelectContent>
        {Object.entries(ACTION_LABEL).map(([k, label]) => <SelectItem key={k} value={k}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
