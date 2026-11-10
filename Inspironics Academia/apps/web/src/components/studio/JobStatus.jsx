import { Loader2, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { jobActive, useRefreshStudio } from '@/lib/studio';

// The real status of a render job from the server: progress, message, cancel and retry.
export default function JobStatus({ job, onChange }) {
  const refresh = useRefreshStudio();
  if (!job) return null;
  const act = async (fn, ok) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(e?.message || 'Action failed');
    } finally {
      refresh();
      onChange?.();
    }
  };
  const active = jobActive(job);
  return (
    <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {active && <Loader2 className="h-4 w-4 animate-spin text-primary" />}
        <span className="font-medium capitalize">{job.status}</span>
        <span className="text-muted-foreground">{job.message}</span>
        <span className="ml-auto flex gap-2">
          {active && <Button size="sm" variant="ghost" onClick={() => act(() => api.studio.cancelJob(job.id), 'Cancelling')}><XCircle /> Cancel</Button>}
          {['failed', 'cancelled'].includes(job.status) && <Button size="sm" variant="outline" onClick={() => act(() => api.studio.retryJob(job.id), 'Queued again')}><RotateCcw /> Retry</Button>}
        </span>
      </div>
      {active && <Progress value={job.progress} />}
      {job.status === 'failed' && job.error && <p className="text-sm text-rose-600 dark:text-rose-400">{job.error}</p>}
      {job.status === 'completed' && job.result && (
        <p className="text-xs text-muted-foreground">
          {job.result.scenes} scenes · {job.result.seconds?.toFixed(1)} s · {job.result.scenesRendered} rendered, {job.result.scenesReused} reused from the scene cache
        </p>
      )}
    </div>
  );
}
