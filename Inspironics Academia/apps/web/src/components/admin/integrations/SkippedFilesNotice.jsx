import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { EyeOff } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useRefreshIntegrations } from './integrationQueries';

// Files deleted in Academia with "keep out of future syncs" are skipped by every sync. Without this
// notice a sync that skips them all just reports "0 files", which looks like a broken connection.
export default function SkippedFilesNotice({ count = 0 }) {
  const refresh = useRefreshIntegrations();
  const mutation = useMutation({
    mutationFn: () => api.dropbox.clearIgnored(),
    onSuccess: ({ cleared }) => {
      toast.success(`${cleared} file${cleared === 1 ? '' : 's'} can sync again — run a sync to bring them in`);
      refresh();
    },
    onError: (err) => toast.error(err?.message || 'Could not update the skip list'),
  });
  if (!count) return null;
  return (
    <div className="rounded-xl border border-amber-300/60 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-4 flex flex-wrap items-center gap-3">
      <EyeOff className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{count} Dropbox file{count === 1 ? ' is' : 's are'} kept out of syncs</p>
        <p className="text-muted-foreground">
          They were deleted here with “Keep out of future Dropbox syncs” ticked, so every sync skips them — even inside the playbooks folder.
        </p>
      </div>
      <Button size="sm" variant="outline" disabled={mutation.isPending} onClick={() => mutation.mutate()}>
        Let them sync again
      </Button>
    </div>
  );
}
