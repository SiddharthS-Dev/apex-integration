import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { formatDistanceToNow } from 'date-fns';
import { ArrowRight, BookMarked, FileText, FolderOpen, Layers, Loader2, Plug, Settings2 } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/StatusBadge';
import RunSyncButton from '@/components/admin/integrations/RunSyncButton';
import { useDropboxStatus, useSyncStatus } from '@/components/admin/integrations/integrationQueries';
import { DashEmpty, HeaderLink, Panel, SectionHeader } from '@/components/dashboard/DashParts';

function DropboxGlyph({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M6 2 0 6l6 4 6-4-6-4Zm12 0-6 4 6 4 6-4-6-4ZM0 14l6 4 6-4-6-4-6 4Zm18-4-6 4 6 4 6-4-6-4ZM6 19.3l6 4 6-4-6-4-6 4Z" />
    </svg>
  );
}

// Admin-only strip: Dropbox connection state with the one action that fits it.
function DropboxBar({ status, sync }) {
  const tile = (
    <div className="w-10 h-10 rounded-xl bg-[#0061FE]/10 text-[#0061FE] dark:text-[#4d94ff] ring-1 ring-inset ring-[#0061FE]/25 flex items-center justify-center shrink-0">
      <DropboxGlyph className="w-5 h-5" />
    </div>
  );
  const manage = (
    <Button asChild size="sm" variant="outline"><Link to="/admin/integrations"><Settings2 /> Manage</Link></Button>
  );

  let title;
  let detail;
  let actions;
  if (!status.configured) {
    title = 'Dropbox is not set up yet';
    detail = 'Add the Dropbox app credentials on the API server to enable playbook sync.';
    actions = <Button asChild size="sm"><Link to="/admin/integrations"><Settings2 /> Set up Dropbox</Link></Button>;
  } else if (!status.connected) {
    title = 'Connect Dropbox';
    detail = 'Approve read access in Dropbox, then pick the folder that holds your playbooks.';
    actions = <Button size="sm" onClick={() => api.dropbox.connect()} className="shadow-lg shadow-primary/25"><Plug /> Connect Dropbox</Button>;
  } else {
    const last = status.last_sync;
    title = status.account_email ? `Connected as ${status.account_email}` : 'Dropbox connected';
    detail = (
      <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span className="inline-flex items-center gap-1"><FolderOpen className="w-3.5 h-3.5" />{status.root_path || 'Entire Dropbox'}</span>
        {sync?.running
          ? <span className="inline-flex items-center gap-1 text-primary"><Loader2 className="w-3.5 h-3.5 animate-spin" />Syncing…</span>
          : last?.started_at && <span>Last sync {formatDistanceToNow(new Date(last.started_at), { addSuffix: true })}</span>}
      </span>
    );
    actions = status.needs_reconnect ? (
      <>
        <Button size="sm" onClick={() => api.dropbox.connect()}><Plug /> Reconnect</Button>
        {manage}
      </>
    ) : (
      <>
        <RunSyncButton running={!!sync?.running} />
        {manage}
      </>
    );
  }

  return (
    <div className="dash-panel p-3.5 mb-4 flex flex-col sm:flex-row sm:items-center gap-3">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        {tile}
        <div className="min-w-0">
          <div className="text-sm font-semibold truncate">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{detail}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">{actions}</div>
    </div>
  );
}

function PlaybookRow({ playbook, courses, isAdmin }) {
  const course = courses.find((c) => c.playbook_id === playbook.id);
  const to = course ? `/courses/${course.id}` : isAdmin ? `/admin/studio/${playbook.id}` : '/playbooks';
  return (
    <li>
      <Link to={to} className="group dash-panel dash-hover p-3 flex items-center gap-3 min-w-0">
        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
          {playbook.source === 'dropbox' ? <DropboxGlyph className="w-4 h-4" /> : <FileText className="w-4 h-4" />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium truncate group-hover:text-primary transition-colors">{playbook.title || playbook.file_name}</div>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
            <span className="inline-flex items-center gap-1"><Layers className="w-3 h-3" />{playbook.chapter_count || 0} chapters</span>
            <span className="truncate">{course ? course.title : 'No published course yet'}</span>
          </div>
        </div>
        {isAdmin && <StatusBadge status={playbook.status} />}
        <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

export default function PlaybookLibrary({ isAdmin, courses }) {
  const dropbox = useDropboxStatus({ enabled: isAdmin });
  const connected = !!(dropbox.data?.configured && dropbox.data?.connected);
  const sync = useSyncStatus(isAdmin && connected);
  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks-learner'],
    queryFn: () => api.entities.Playbook.list('-created_date', 100),
    // Newly synced playbooks appear while a Dropbox run is in progress.
    refetchInterval: sync.data?.running ? 5000 : false,
  });
  const visible = (isAdmin ? playbooks.filter((p) => p.status !== 'archived') : playbooks.filter((p) => p.status === 'published')).slice(0, 6);

  return (
    <Panel>
      <SectionHeader
        icon={BookMarked}
        title="Playbook Library"
        subtitle={isAdmin ? 'Synced from Dropbox or uploaded' : 'The engineering playbooks behind every course'}
        action={<HeaderLink to={isAdmin ? '/admin/playbooks' : '/playbooks'}>View all</HeaderLink>}
      />
      {isAdmin && dropbox.data && <DropboxBar status={dropbox.data} sync={sync.data} />}
      {isLoading ? (
        <div className="h-24 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : visible.length === 0 ? (
        <DashEmpty
          icon={BookMarked}
          title="No playbooks yet"
          description={isAdmin
            ? (connected ? 'Run a sync to pull PDF and DOCX playbooks from your Dropbox folder.' : 'Connect Dropbox or upload a playbook to get started.')
            : 'Published playbooks and their courses will appear here.'}
          action={isAdmin && !connected && <Button asChild size="sm" variant="outline"><Link to="/admin/playbooks">Upload a playbook</Link></Button>}
          className="py-6"
        />
      ) : (
        <ul className="grid gap-3 md:grid-cols-2">
          {visible.map((p) => <PlaybookRow key={p.id} playbook={p} courses={courses} isAdmin={isAdmin} />)}
        </ul>
      )}
    </Panel>
  );
}
