import { Cloud, Plug } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import DropboxNotConfigured from './DropboxNotConfigured';
import DropboxAccountDetails from './DropboxAccountDetails';
import DropboxDisconnectButton from './DropboxDisconnectButton';
import DropboxRedirectUri from './DropboxRedirectUri';

export default function DropboxConnectionCard({ status }) {
  const connected = status.configured && status.connected;
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300 flex items-center justify-center">
            <Cloud className="w-5 h-5" />
          </div>
          <div>
            <h2 className="font-semibold">Dropbox</h2>
            <p className="text-sm text-muted-foreground">Playbooks (PDF, DOCX) are indexed from a Dropbox folder.</p>
          </div>
        </div>
        {connected && (
          <div className="flex gap-2">
            {status.needs_reconnect && <Button size="sm" onClick={() => api.dropbox.connect()}><Plug /> Reconnect</Button>}
            <DropboxDisconnectButton />
          </div>
        )}
      </div>
      {!status.configured && <DropboxNotConfigured message={status.message} />}
      {status.configured && !status.connected && (
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <p className="text-sm text-muted-foreground">Not connected. You will be sent to Dropbox to approve read access, then returned here.</p>
          <Button size="sm" onClick={() => api.dropbox.connect()}><Plug /> Connect Dropbox</Button>
        </div>
      )}
      {connected && <DropboxAccountDetails status={status} />}
      {status.redirect_uri && <DropboxRedirectUri uri={status.redirect_uri} />}
    </section>
  );
}
