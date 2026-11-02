import { Link } from 'react-router-dom';
import { ArrowRight, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountUp, Panel, SectionHeader } from '@/components/dashboard/DashParts';
import { dueState, isOpen, useMyActionItems } from '@/lib/meetings';

// Open action items from meetings assigned to the learner, with the overdue ones called out.
export default function ActionItemsCard() {
  const { data: items = [], isLoading } = useMyActionItems();
  const open = items.filter(isOpen);
  const overdue = open.filter((a) => dueState(a) === 'overdue').length;
  const soon = open.filter((a) => dueState(a) === 'soon').length;

  return (
    <Panel>
      <SectionHeader icon={CheckSquare} tone="violet" title="Action items" subtitle="What you agreed to do in meetings" />
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold leading-none tracking-tight">{isLoading ? '—' : <CountUp value={open.length} />}</div>
          <div className="mt-1.5 text-xs text-muted-foreground">{isLoading ? 'Checking…' : open.length ? 'open' : 'Nothing open'}</div>
        </div>
        <div className="space-y-0.5 text-right text-xs">
          {overdue > 0 && <div className="font-medium text-rose-600 dark:text-rose-400 tabular-nums">{overdue} overdue</div>}
          {soon > 0 && <div className="font-medium text-amber-700 dark:text-amber-300 tabular-nums">{soon} due soon</div>}
        </div>
      </div>
      <Button asChild size="sm" variant="outline" className="mt-4 w-full">
        <Link to="/action-items">See my action items <ArrowRight /></Link>
      </Button>
    </Panel>
  );
}
