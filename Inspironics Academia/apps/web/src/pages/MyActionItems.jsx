import { Link } from 'react-router-dom';
import { CheckSquare, Presentation } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import { ActionStatusSelect, DueLabel, PriorityChip } from '@/components/meetings/MeetingBits';
import { ACTION_LABEL, dueState, formatDay, isOpen, useInvalidateMeetings, useMyActionItems } from '@/lib/meetings';
import { cn } from '@/lib/utils';

const GROUPS = [
  ['overdue', 'Overdue', 'text-rose-600 dark:text-rose-400'],
  ['soon', 'Due today or tomorrow', 'text-amber-700 dark:text-amber-300'],
  ['open', 'Open', ''],
  ['closed', 'Done', 'text-muted-foreground'],
];

const groupOf = (a) => {
  if (!isOpen(a)) return 'closed';
  const s = dueState(a);
  return s === 'overdue' || s === 'soon' ? s : 'open';
};

export default function MyActionItems() {
  const { data: items = [], isLoading } = useMyActionItems();
  const refresh = useInvalidateMeetings();

  const setStatus = async (item, status) => {
    try {
      await api.entities.ActionItem.update(item.id, { status });
      toast.success(`Marked ${ACTION_LABEL[status].toLowerCase()}`);
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not update the status');
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
      <PageHeader
        icon={CheckSquare}
        title="My action items"
        description="What you agreed to do in meetings. Update the status as you go; the meeting notes show it to everyone."
        actions={<Button asChild size="sm" variant="outline"><Link to="/meetings"><Presentation /> All meetings</Link></Button>}
      />
      {isLoading ? <LoadingState label="Loading your action items…" />
        : items.length === 0 ? (
          <EmptyState icon={CheckSquare} title="Nothing assigned to you" description="Action items from published meetings that name you appear here." />
        ) : GROUPS.map(([key, label, tone]) => {
          const list = items.filter((a) => groupOf(a) === key).sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
          if (!list.length) return null;
          return (
            <section key={key} className="space-y-2">
              <h2 className={cn('text-sm font-semibold', tone)}>{label} <span className="font-normal text-muted-foreground tabular-nums">{list.length}</span></h2>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {list.map((a) => (
                  <li key={a.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className={cn('font-medium', !isOpen(a) && 'text-muted-foreground line-through decoration-1')}>{a.task}</p>
                      <p className="text-xs text-muted-foreground">
                        <Link to={`/meetings/${a.meeting_id}`} className="hover:text-foreground hover:underline">{a.meeting_title}</Link>
                        {a.meeting_date && ` · ${formatDay(a.meeting_date)}`}
                        {a.completed_date && ` · done ${formatDay(a.completed_date)}`}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-sm">
                      <DueLabel item={a} />
                      <PriorityChip priority={a.priority} />
                      <ActionStatusSelect id={`my-status-${a.id}`} value={a.status} onChange={(v) => setStatus(a, v)} />
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
    </div>
  );
}
