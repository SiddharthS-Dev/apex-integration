import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, FolderOpen } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import FolderBrowser from './FolderBrowser';
import { useRefreshIntegrations } from './integrationQueries';

export default function SyncFolderPicker({ rootPath = '' }) {
  const [browsing, setBrowsing] = useState(false);
  const refresh = useRefreshIntegrations();
  const mutation = useMutation({
    mutationFn: (root_path) => api.dropbox.updateSettings({ root_path }),
    onSuccess: () => { toast.success('Sync folder saved — applies from the next sync'); setBrowsing(false); refresh(); },
    onError: (err) => toast.error(err?.message || 'Could not save the sync folder'),
  });
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">Sync folder</h2>
          <p className="text-sm text-muted-foreground">PDF and DOCX files in this folder and its subfolders become playbooks.</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setBrowsing((b) => !b)}><FolderOpen /> {browsing ? 'Close' : 'Change'}</Button>
      </div>
      <code className="block rounded-lg bg-muted px-3 py-2 font-mono text-sm">{rootPath || '/ (entire Dropbox)'}</code>
      {browsing && (
        <>
          <p className="flex items-start gap-2 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            Narrowing the folder archives playbooks outside it on the next sync. They are never deleted and return if the folder is widened again.
          </p>
          <FolderBrowser initialPath={rootPath} onSelect={(p) => mutation.mutate(p)} saving={mutation.isPending} />
        </>
      )}
    </section>
  );
}
