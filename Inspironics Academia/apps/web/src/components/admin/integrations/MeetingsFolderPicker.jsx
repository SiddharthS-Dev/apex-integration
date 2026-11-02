import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FolderOpen, Presentation } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import FolderBrowser from './FolderBrowser';
import { useRefreshIntegrations } from './integrationQueries';

// The Dropbox folder Teams transcripts are saved to. Files there become Meetings (not playbooks)
// and are analysed on sync; '' turns meeting sync off. With a meetings app of its own (`ownApp`) the
// folders listed are that app's, and its top level can be chosen ('/'): an App folder app only sees
// its own folder.
export default function MeetingsFolderPicker({ meetingsPath = '', ownApp = false }) {
  const [browsing, setBrowsing] = useState(false);
  const refresh = useRefreshIntegrations();
  const mutation = useMutation({
    mutationFn: (meetings_path) => api.dropbox.updateSettings({ meetings_path }),
    onSuccess: (_d, path) => {
      toast.success(path ? 'Meetings folder saved — transcripts are picked up on the next sync' : 'Meeting sync turned off');
      setBrowsing(false);
      refresh();
    },
    onError: (err) => toast.error(err?.message || 'Could not save the meetings folder'),
  });
  const choose = (path) => {
    if (!path && ownApp) {
      mutation.mutate('/');
      return;
    }
    if (!path) {
      toast.error('Choose a folder for transcripts, not the whole Dropbox');
      return;
    }
    mutation.mutate(path);
  };

  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><Presentation className="h-4 w-4 text-primary" /> Meetings folder</h2>
          <p className="text-sm text-muted-foreground">Teams transcripts (.docx, .vtt, .txt) saved here become meeting notes, analysed for decisions, requirements and action items. They are kept out of the playbook library.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setBrowsing((b) => !b)}><FolderOpen /> {browsing ? 'Close' : meetingsPath ? 'Change' : 'Choose'}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 rounded-lg bg-muted px-3 py-2 font-mono text-sm">{meetingsPath === '/' ? '/ (the whole meetings app folder)' : meetingsPath || 'Not set — meeting sync is off'}</code>
        {meetingsPath && (
          <Button size="sm" variant="ghost" disabled={mutation.isPending} onClick={() => mutation.mutate('')}>Turn off</Button>
        )}
      </div>
      {browsing && (
        <FolderBrowser
          initialPath={meetingsPath === '/' ? '' : meetingsPath}
          onSelect={choose}
          saving={mutation.isPending}
          source={ownApp ? 'meetings' : 'playbooks'}
          rootLabel={ownApp ? '/ (the meetings app — choose this for an App folder app)' : '/ (entire Dropbox)'}
        />
      )}
    </section>
  );
}
