import { Link } from 'react-router-dom';
import { BrainCircuit, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CountUp, Panel, SectionHeader } from '@/components/dashboard/DashParts';
import { useReviewQueue } from '@/lib/retention';

export default function DailyReviewCard() {
  const { data, isLoading } = useReviewQueue();
  const due = data?.due.length ?? 0;
  const fresh = data?.new.length ?? 0;
  const stats = data?.stats;

  return (
    <Panel>
      <SectionHeader icon={BrainCircuit} tone="orange" title="Daily Review" subtitle="Spaced repetition keeps lessons from fading" />
      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="text-3xl font-bold leading-none tracking-tight">{isLoading ? '—' : <CountUp value={due + fresh} />}</div>
          <div className="text-xs text-muted-foreground mt-1.5">
            {isLoading ? 'Checking your cards…' : due + fresh ? `${due} due · ${fresh} new` : 'All caught up for today'}
          </div>
        </div>
        {stats?.retention_30d != null && (
          <div className="text-right">
            <div className="text-lg font-semibold tabular-nums">{stats.retention_30d}%</div>
            <div className="text-[11px] text-muted-foreground">30-day retention</div>
          </div>
        )}
      </div>
      <Button asChild size="sm" className="w-full mt-4" variant={due + fresh ? 'default' : 'outline'}>
        <Link to="/review"><Play /> {due + fresh ? 'Start review' : 'Open review'}</Link>
      </Button>
    </Panel>
  );
}
