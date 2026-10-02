import { Loader2 } from 'lucide-react';
import { Progress } from '@/components/ui/progress';

export default function GenerationProgress({ job }) {
  if (!job) return null;
  const pct = job.total ? Math.round((job.done / job.total) * 100) : 0;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 mb-6">
      <div className="flex items-center justify-between gap-3 mb-2 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          {job.label}…
        </div>
        {job.total > 0 && (
          <span className="text-muted-foreground tabular-nums">{job.done} / {job.total} {job.unit}</span>
        )}
      </div>
      <Progress value={job.total ? pct : 100} className={job.total ? 'h-2' : 'h-2 animate-pulse'} />
    </div>
  );
}
