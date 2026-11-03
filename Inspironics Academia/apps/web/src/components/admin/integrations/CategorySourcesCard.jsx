import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, CircleSlash, FolderOpen, Link2, Unlink } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { colorOf, iconOf, useCategories } from '@/lib/categories';
import DropboxRedirectUri from './DropboxRedirectUri';
import FolderBrowser from './FolderBrowser';
import { useRefreshIntegrations } from './integrationQueries';

// Category sources: a playbook category with a Dropbox folder of its own — e.g. Learning & Development
// synced from the interns' folder. With its own Dropbox app (DROPBOX_<CATEGORY>_APP_KEY/SECRET on the
// server) it connects separately; otherwise its folder is read through the main playbooks app.
// Documents synced from it land in that category; an admin's manual category is never overridden.

export const SOURCES_KEY = ['dropbox-sources'];

function SourceRow({ source, category }) {
  const [browsing, setBrowsing] = useState(false);
  const queryClient = useQueryClient();
  const refresh = useRefreshIntegrations();
  const done = () => { queryClient.invalidateQueries({ queryKey: SOURCES_KEY }); refresh(); };
  const setFolder = useMutation({
    mutationFn: (path) => api.dropbox.sources.setFolder(source.key, path),
    onSuccess: (s) => {
      toast.success(s.path ? `${category.label} syncs from ${s.path === '/' ? 'its app folder' : s.path} — run a sync to bring documents in` : `${category.label} folder sync turned off`);
      setBrowsing(false);
      done();
    },
    onError: (err) => toast.error(err?.message || 'Could not save the folder'),
  });
  const disconnect = useMutation({
    mutationFn: () => api.dropbox.sources.disconnect(source.key),
    onSuccess: () => { toast.success(`${category.label} Dropbox disconnected`); done(); },
    onError: (err) => toast.error(err?.message || 'Could not disconnect'),
  });

  const c = colorOf(category);
  const Icon = iconOf(category);
  // Without an app of its own the source reads through the main playbooks connection.
  const canBrowse = source.connected;
  const choose = (path) => {
    if (!path && !source.app_folder) {
      toast.error('Choose a folder, not the whole Dropbox');
      return;
    }
    setFolder.mutate(path || '/');
  };

  return (
    <div className={cn('space-y-3 rounded-xl border bg-card p-4', c.border)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', c.gradient)}><Icon className="h-5 w-5" /></span>
          <div className="min-w-0">
            <p className={cn('text-xs font-semibold uppercase tracking-wide', c.text)}>{category.audience_label}</p>
            <h3 className="font-semibold">{category.label}</h3>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {source.own_app && (
            <Button size="sm" variant={source.connected ? 'outline' : 'default'} onClick={() => api.dropbox.sources.connect(source.key)}>
              <Link2 /> {source.connected ? 'Reconnect' : 'Connect Dropbox app'}
            </Button>
          )}
          {source.own_app && source.connected && (
            <Button size="sm" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}><Unlink /> Disconnect</Button>
          )}
          {canBrowse && (
            <Button size="sm" variant="outline" onClick={() => setBrowsing((b) => !b)}><FolderOpen /> {browsing ? 'Close' : source.path ? 'Change folder' : 'Choose folder'}</Button>
          )}
        </div>
      </div>

      <div className="grid gap-1 text-sm">
        <p className="flex items-center gap-2">
          {source.connected
            ? <><CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" /> {source.own_app ? `Own Dropbox app · ${source.account_name || source.account_email || 'connected'}` : 'Through the main playbooks Dropbox app'}</>
            : <><CircleSlash className="h-4 w-4 text-muted-foreground" /> {source.own_app ? 'Its Dropbox app is not connected yet' : 'Connect the main Dropbox above, or give it an app of its own'}</>}
          {source.needs_reconnect && <span className="text-amber-600 dark:text-amber-400"> — reconnect needed</span>}
        </p>
        <p className="text-muted-foreground">
          Folder: <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground">{source.path === '/' ? '/ (the whole app folder)' : source.path || 'not chosen — nothing is synced'}</code>
          {source.path && (
            <Button size="sm" variant="link" className="h-auto px-2 py-0 text-xs" disabled={setFolder.isPending} onClick={() => setFolder.mutate('')}>Turn off</Button>
          )}
        </p>
      </div>

      {browsing && canBrowse && (
        <FolderBrowser
          initialPath={source.path === '/' ? '' : source.path}
          onSelect={choose}
          saving={setFolder.isPending}
          source={`source:${source.key}`}
          rootLabel={source.app_folder ? '/ (the app folder)' : '/ (entire Dropbox — open a folder to choose it)'}
        />
      )}
      {source.own_app && <DropboxRedirectUri uri={source.redirect_uri} />}
    </div>
  );
}

export default function CategorySourcesCard() {
  const { data: sources = [] } = useQuery({ queryKey: SOURCES_KEY, queryFn: () => api.dropbox.sources.list() });
  const { categories } = useCategories();
  const rows = sources
    .map((s) => ({ source: s, category: categories.find((c) => c.key === s.key) }))
    .filter((r) => r.category);
  if (!rows.length) return null;
  return (
    <section className="space-y-4 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="font-semibold">Category sources</h2>
        <p className="text-sm text-muted-foreground">
          Give a category a Dropbox folder of its own. Documents there are added to that category; the Corporate Knowledge Base keeps syncing from the playbooks folder above.
        </p>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {rows.map(({ source, category }) => <SourceRow key={source.key} source={source} category={category} />)}
      </div>
    </section>
  );
}
