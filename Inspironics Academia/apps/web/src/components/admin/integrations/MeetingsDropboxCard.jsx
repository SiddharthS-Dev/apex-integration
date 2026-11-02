import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleSlash, Link2, Unlink } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import DropboxRedirectUri from './DropboxRedirectUri';
import { useRefreshIntegrations } from './integrationQueries';

// The Dropbox app meeting transcripts come through ("Inspironics Team meetings"), connected on its own:
// its own Connect, its own redirect URI to register on that app, and it can be a different Dropbox
// account from the playbooks one. Without DROPBOX_MEETINGS_APP_KEY/SECRET meetings use the playbooks app.
export default function MeetingsDropboxCard({ status }) {
  const refresh = useRefreshIntegrations();
  const disconnect = useMutation({
    mutationFn: () => api.dropbox.meetings.disconnect(),
    onSuccess: () => { toast.success('Meetings Dropbox disconnected'); refresh(); },
    onError: (err) => toast.error(err?.message || 'Could not disconnect'),
  });
  if (!status) return null;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">Meetings Dropbox</h2>
          <p className="text-sm text-muted-foreground">
            {status.configured
              ? 'Meeting transcripts are read through their own Dropbox app, separate from playbooks.'
              : 'Meeting transcripts use the playbooks connection above. To give them their own Dropbox app, set DROPBOX_MEETINGS_APP_KEY and DROPBOX_MEETINGS_APP_SECRET on the server.'}
          </p>
        </div>
        {status.configured && (
          <div className="flex shrink-0 gap-2">
            <Button size="sm" variant={status.connected ? 'outline' : 'default'} onClick={() => api.dropbox.meetings.connect()}>
              <Link2 /> {status.connected ? 'Reconnect' : 'Connect meetings Dropbox'}
            </Button>
            {status.connected && (
              <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
                <Unlink /> Disconnect
              </Button>
            )}
          </div>
        )}
      </div>
      {status.configured && (
        <p className="flex items-center gap-2 text-sm">
          {status.connected
            ? <><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> Connected as {status.account_name || status.account_email}{status.needs_reconnect ? ' — reconnect needed' : ''}</>
            : <><CircleSlash className="h-4 w-4 text-muted-foreground" /> Not connected</>}
        </p>
      )}
      {status.configured && status.message && <p className="text-sm text-rose-600 dark:text-rose-400">{status.message}</p>}
      <DropboxRedirectUri uri={status.redirect_uri} />
    </section>
  );
}
