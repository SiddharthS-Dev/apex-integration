import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Loader2, RefreshCw } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { useRefreshIntegrations } from './integrationQueries';

export default function RunSyncButton({ running, disabled }) {
  const refresh = useRefreshIntegrations();
  const mutation = useMutation({
    mutationFn: () => api.sync.runNow(),
    onSuccess: () => toast.success('Synchronization started'),
    onError: (err) => (err?.status === 409 ? toast.info(err.message) : toast.error(err?.message || 'Could not start the sync')),
    onSettled: () => refresh(),
  });
  const busy = running || mutation.isPending;
  return (
    <Button size="sm" disabled={busy || disabled} onClick={() => mutation.mutate()}>
      {busy ? <Loader2 className="animate-spin" /> : <RefreshCw />} Run sync now
    </Button>
  );
}
