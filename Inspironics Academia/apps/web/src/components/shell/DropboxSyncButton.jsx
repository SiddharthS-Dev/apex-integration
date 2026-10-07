import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { SYNC_STATUS_KEY, useSyncStatus } from '@/components/admin/integrations/integrationQueries';

// The header's "Sync Dropbox" button, for administrators. Starts the same run as Integrations →
// "Run sync now" and spins while any run is in progress. The run starts in the background, so the
// button watches for a sync log newer than the one it saw at the start, then says what changed and
// refetches everything on screen.
export default function DropboxSyncButton() {
  const qc = useQueryClient();
  const status = useSyncStatus();
  const running = !!status.data?.running;
  const last = status.data?.last;
  const [watchingFrom, setWatchingFrom] = useState(null); // the last log id before our run, or ''
  const watching = watchingFrom !== null;

  const mutation = useMutation({
    mutationFn: () => api.sync.runNow(),
    onMutate: () => setWatchingFrom(last?.id || ''),
    onSuccess: () => toast.info('Dropbox sync started'),
    onError: (err) => {
      // 409 is either "already running" (follow that run) or "not connected" (nothing to follow)
      if (err?.status === 409 && !/not connected/i.test(err.message || '')) {
        toast.info(err.message);
      } else {
        setWatchingFrom(null);
        toast.error(err?.message || 'Could not start the sync');
      }
    },
  });

  // While watching, poll quickly whatever the query's own interval says.
  const poll = useRef(null);
  useEffect(() => {
    if (!watching) return undefined;
    poll.current = setInterval(() => qc.invalidateQueries({ queryKey: SYNC_STATUS_KEY }), 2000);
    return () => clearInterval(poll.current);
  }, [watching, qc]);

  // Our run (or the one we joined) has finished: report it and refresh the page's data.
  useEffect(() => {
    if (!watching || running || mutation.isPending || !last || last.id === watchingFrom) return;
    setWatchingFrom(null);
    if (last.status !== 'success') {
      toast.error('Dropbox sync failed — see Admin → Integrations');
    } else {
      const parts = [
        last.added ? `${last.added} new` : '',
        last.updated ? `${last.updated} updated` : '',
        last.archived ? `${last.archived} archived` : '',
      ].filter(Boolean);
      toast.success(parts.length ? `Dropbox synced · ${parts.join(' · ')}` : 'Dropbox synced · no changes');
    }
    qc.invalidateQueries();
  }, [watching, watchingFrom, running, mutation.isPending, last, qc]);

  const busy = running || mutation.isPending || watching;
  return (
    <Button
      variant="outline"
      size="sm"
      className="hidden min-[1440px]:inline-flex h-9 w-9 rounded-full px-0"
      disabled={busy}
      onClick={() => mutation.mutate()}
      title="Sync Dropbox — pull the latest playbooks now"
      aria-label="Sync Dropbox"
    >
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />}
      {/* icon-only: the main nav already fills the header; the tooltip and label say what it does */}
      <span className="sr-only">{busy ? 'Syncing…' : 'Sync Dropbox'}</span>
    </Button>
  );
}
