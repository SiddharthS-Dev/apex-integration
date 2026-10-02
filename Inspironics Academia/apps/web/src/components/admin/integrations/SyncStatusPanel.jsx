import { Loader2 } from 'lucide-react';
import StatusBadge from '@/components/admin/StatusBadge';
import { formatDate, timeAgo } from '@/components/admin/adminFormat';
import RunSyncButton from './RunSyncButton';
import SyncCounts from './SyncCounts';

export default function SyncStatusPanel({ status }) {
  const { running, last, next_run_at: nextRun, interval_minutes: interval, connected } = status || {};
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Synchronization</h2>
          <p className="text-sm text-muted-foreground">
            Every {interval ?? '—'} minutes{nextRun ? ` · next run ${formatDate(nextRun, 'MMM d, HH:mm')}` : ''}
          </p>
        </div>
        <RunSyncButton running={running} disabled={!connected} />
      </div>
      {running && (
        <div className="flex items-center gap-2 rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-500/10 dark:text-blue-300">
          <Loader2 className="w-4 h-4 animate-spin" /> A synchronization is already running
        </div>
      )}
      {last ? (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted-foreground">Last run</span>
            <StatusBadge status={last.status} />
            <span className="text-muted-foreground">{timeAgo(last.started_at)} · {last.trigger}</span>
          </div>
          <SyncCounts log={last} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No synchronization has run yet.</p>
      )}
    </section>
  );
}
