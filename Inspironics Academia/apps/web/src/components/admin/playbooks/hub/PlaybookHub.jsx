import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, Library, Loader2, Megaphone, X } from 'lucide-react';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';
import usePlaybookActions from '@/components/admin/playbooks/usePlaybookActions';
import { useDropboxStatus, useSyncLogs, useSyncStatus } from '@/components/admin/integrations/integrationQueries';
import HubHeader from './HubHeader';
import PlaybookHubCard from './PlaybookHubCard';
import ActivityFeed from './ActivityFeed';
import { FILTERS, activityEvents, isStalled, sortForHub, variantOf } from './hubData';

const BANNER_KEY = 'playbook-hub-banner-dismissed';

// System notice built from live counts; dismissing hides it until the counts change.
function StatusBanner({ counts }) {
  const parts = [];
  if (counts.error) parts.push(`${counts.error} failed`);
  if (counts.stalled) parts.push(`${counts.stalled} stalled`);
  if (counts.processing - (counts.stalled || 0)) parts.push(`${counts.processing - (counts.stalled || 0)} processing`);
  if (counts.queued) parts.push(`${counts.queued} waiting to be processed`);
  const signature = parts.join('|');
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(BANNER_KEY); } catch { return null; }
  });
  const show = parts.length > 0 && dismissed !== signature;
  const dismiss = () => {
    setDismissed(signature);
    try { sessionStorage.setItem(BANNER_KEY, signature); } catch { /* per-session only */ }
  };
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
          className="glass tone-idle glass-glow mx-auto w-fit max-w-full flex items-center gap-2.5 pl-3 pr-1.5 py-1.5 text-sm"
          role="status"
        >
          <Megaphone className="w-4 h-4 neon-text shrink-0" />
          <span className="min-w-0">Playbooks: {parts.join(' · ')}</span>
          <button type="button" onClick={dismiss} aria-label="Dismiss" className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/60">
            <X className="w-4 h-4" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ErrorLogDialog({ playbook, onClose }) {
  return (
    <Dialog open={!!playbook} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><AlertTriangle className="w-5 h-5 text-rose-500" /> Error log</DialogTitle>
          <DialogDescription className="break-words">{playbook?.title}</DialogDescription>
        </DialogHeader>
        {playbook && (
          <div className="space-y-3 text-sm">
            <pre className="whitespace-pre-wrap break-words rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-rose-700 dark:text-rose-200 font-mono text-xs">
              {playbook.error || 'No error message was recorded.'}
            </pre>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
              <dt className="text-muted-foreground">File</dt><dd className="break-all">{playbook.file_name || '—'}</dd>
              {playbook.dropbox_path && (<><dt className="text-muted-foreground">Dropbox path</dt><dd className="break-all">{playbook.dropbox_path}</dd></>)}
              <dt className="text-muted-foreground">Size</dt><dd>{playbook.file_size ? `${(playbook.file_size / 1048576).toFixed(1)} MB` : '—'}</dd>
              <dt className="text-muted-foreground">Stopped at</dt><dd>{playbook.progress || 0}%</dd>
              <dt className="text-muted-foreground">Last updated</dt><dd>{playbook.updated_date ? new Date(playbook.updated_date).toLocaleString() : '—'}</dd>
            </dl>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function PlaybookHub() {
  const actions = usePlaybookActions();
  const [filter, setFilter] = useState('all');
  const [errorTarget, setErrorTarget] = useState(null);

  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => api.entities.Playbook.list('-created_date', 200),
    refetchInterval: (query) => (query.state.data?.some((p) => p.status === 'processing') ? 3000 : false),
  });
  const ids = playbooks.map((p) => p.id);
  const { data: courses = [] } = useQuery({
    queryKey: ['hub-courses', ids.join(',')],
    enabled: ids.length > 0,
    queryFn: () => api.entities.Course.filter({ playbook_id: { $in: ids } }, '-updated_date', 500),
  });
  const dropbox = useDropboxStatus();
  const connected = !!(dropbox.data?.configured && dropbox.data?.connected);
  const sync = useSyncStatus(connected);
  const logs = useSyncLogs(connected, !!sync.data?.running);

  const items = sortForHub(playbooks.map((p) => ({ playbook: p, variant: variantOf(p, actions.busyIds.includes(p.id)) })));
  const counts = items.reduce((acc, { variant }) => ({ ...acc, [variant]: (acc[variant] || 0) + 1 }), {});
  counts.stalled = playbooks.filter((p) => isStalled(p, actions.busyIds.includes(p.id))).length;
  const active = FILTERS.find((f) => f.key === filter);
  const shown = items.filter(({ variant }) => active.match(variant));
  // The live course for a playbook (archived ones are old versions).
  const courseFor = (id) => courses.find((c) => c.playbook_id === id && c.status !== 'archived');

  return (
    <div className="hub relative min-h-[calc(100vh-4rem)] bg-[linear-gradient(180deg,hsl(var(--hub-bg-1)),hsl(var(--hub-bg-2)))]">
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 left-1/4 w-[40rem] h-[40rem] rounded-full bg-violet-600/10 blur-3xl" />
        <div className="absolute top-60 -right-40 w-[32rem] h-[32rem] rounded-full bg-sky-500/10 blur-3xl" />
      </div>
      <div className="relative max-w-[1600px] mx-auto px-4 sm:px-6 py-5 sm:py-6 space-y-6">
        <StatusBanner counts={counts} />
        <HubHeader dropbox={dropbox.data} syncRunning={!!sync.data?.running} />

        <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_320px] items-start">
          <section className="glass tone-idle p-4 sm:p-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <h2 className="text-lg font-semibold">Playbook Hub</h2>
              <div role="tablist" aria-label="Filter playbooks" className="flex flex-wrap gap-1.5">
                {FILTERS.map((f) => {
                  const n = items.filter(({ variant }) => f.match(variant)).length;
                  return (
                    <button
                      key={f.key}
                      type="button"
                      role="tab"
                      aria-selected={filter === f.key}
                      onClick={() => setFilter(f.key)}
                      className={cn(
                        'rounded-full px-3 h-8 text-xs font-medium border transition-all duration-200 hover:-translate-y-0.5',
                        filter === f.key
                          ? 'bg-primary text-primary-foreground border-primary shadow-[0_0_18px_-4px_hsl(var(--primary))]'
                          : 'border-[hsl(var(--glass-line))] text-muted-foreground hover:text-foreground hover:bg-muted/40',
                      )}
                    >
                      {f.label} <span className="tabular-nums opacity-75">{n}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--glass-line))] py-16 text-center flex flex-col items-center gap-2">
                <Library className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">{playbooks.length ? 'Nothing in this view' : 'No playbooks yet'}</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {playbooks.length ? 'Try another filter.' : 'Upload a PDF or DOCX playbook above, or sync one from Dropbox.'}
                </p>
              </div>
            ) : (
              <motion.div layout className="grid gap-6 md:grid-cols-2 2xl:grid-cols-3">
                <AnimatePresence initial={false}>
                  {shown.map(({ playbook, variant }, i) => (
                    <motion.div
                      key={playbook.id}
                      layout
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 8) * 0.04 } }}
                      exit={{ opacity: 0, scale: 0.97 }}
                      className="min-w-0 pb-3"
                    >
                      <PlaybookHubCard
                        playbook={playbook}
                        variant={variant}
                        course={courseFor(playbook.id)}
                        busy={actions.busyIds.includes(playbook.id)}
                        onProcess={actions.onProcess}
                        onDownload={actions.onDownload}
                        onDelete={actions.onDelete}
                        onShowError={setErrorTarget}
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </motion.div>
            )}
          </section>

          <ActivityFeed events={activityEvents(playbooks, logs.data || [])} />
        </div>
      </div>

      <ErrorLogDialog playbook={errorTarget} onClose={() => setErrorTarget(null)} />
      <ConfirmDialog
        open={!!actions.reprocessTarget}
        onOpenChange={(o) => !o && actions.setReprocessTarget(null)}
        title="Re-process playbook?"
        description="A new course version will be generated. The current course will be archived and unpublished (learner progress and certificates are preserved)."
        confirmLabel="Re-process"
        onConfirm={actions.confirmReprocess}
      />
      <ConfirmDialog
        open={!!actions.deleteTarget}
        onOpenChange={(o) => !o && actions.setDeleteTarget(null)}
        title="Delete playbook?"
        description={`“${actions.deleteTarget?.title || ''}” will be permanently removed. This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={actions.confirmDelete}
      />
    </div>
  );
}
