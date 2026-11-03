import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, ArrowRightLeft, Library, Loader2, Megaphone, Settings2, Trash2, X } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { api } from '@/api/client';
import { cn } from '@/lib/utils';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';
import ClassifyDialog from '@/components/admin/playbooks/ClassifyDialog';
import ManageCategoriesDialog from '@/components/admin/playbooks/ManageCategoriesDialog';
import CategoryTiles from '@/components/categories/CategoryTiles';
import PlaybookFilters, { DEFAULT_FILTERS } from '@/components/categories/PlaybookFilters';
import {
  UNCLASSIFIED, UNCLASSIFIED_CATEGORY, categoryKey, categoryStats, filterOptions, filterPlaybooks, findCategory, useCategories,
} from '@/lib/categories';
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

// The repository is organised by audience: three (or more) categories, each a tab with its counts,
// plus Unclassified for documents awaiting an admin. Within a category the existing status filters,
// cards, Build Course in Studio, versions and deletion work as before.
export default function PlaybookHub() {
  const actions = usePlaybookActions();
  const [filter, setFilter] = useState('all');
  const [errorTarget, setErrorTarget] = useState(null);
  const { categories } = useCategories();
  const [category, setCategory] = useState('corporate');
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [classifyTarget, setClassifyTarget] = useState(null);
  const [managing, setManaging] = useState(false);

  // Enough for every count on the category tiles.
  const { data: playbooks = [], isLoading } = useQuery({
    queryKey: ['playbooks'],
    queryFn: () => api.entities.Playbook.list('-created_date', 5000),
    refetchInterval: (query) => (query.state.data?.some((p) => p.status === 'processing') ? 3000 : false),
  });
  const { data: courses = [] } = useQuery({
    queryKey: ['hub-courses', playbooks.length],
    enabled: playbooks.length > 0,
    queryFn: () => api.entities.Course.list('-updated_date', 5000),
  });
  const dropbox = useDropboxStatus();
  const connected = !!(dropbox.data?.configured && dropbox.data?.connected);
  const sync = useSyncStatus(connected);
  const logs = useSyncLogs(connected, !!sync.data?.running);

  // Category tiles: each category's playbooks and counts. Unclassified gets a tile only while there are
  // documents waiting for review (e.g. an upload marked "Not sure"), so none is ever out of sight.
  const byCategory = useMemo(() => {
    const m = new Map();
    for (const p of playbooks) m.set(categoryKey(p), [...(m.get(categoryKey(p)) || []), p]);
    return m;
  }, [playbooks]);
  const known = new Set(categories.map((c) => c.key));
  // A playbook whose category was deleted or never existed is shown as unclassified.
  const orphans = [...byCategory].filter(([k]) => k !== UNCLASSIFIED && !known.has(k)).flatMap(([, list]) => list);
  const inCategoryOf = (key) => (key === UNCLASSIFIED ? [...(byCategory.get(UNCLASSIFIED) || []), ...orphans] : byCategory.get(key) || []);
  const unclassifiedStats = categoryStats(inCategoryOf(UNCLASSIFIED), courses);
  const tiles = [
    ...categories.map((c) => ({ category: c, stats: categoryStats(inCategoryOf(c.key), courses) })),
    ...(unclassifiedStats.playbooks > 0 ? [{ category: UNCLASSIFIED_CATEGORY, stats: unclassifiedStats }] : []),
  ];
  const selectedCategory = category === 'all' ? null : findCategory(categories, category);
  const inScope = category === 'all' ? playbooks : inCategoryOf(category);
  const options = filterOptions(playbooks);
  const filtered = filterPlaybooks(inScope, filters);

  const withVariant = filtered.map((p) => ({ playbook: p, variant: variantOf(p, actions.busyIds.includes(p.id)) }));
  // "Recently updated" keeps the hub's own order (cards needing action first); other sorts as chosen.
  const items = filters.sort === 'updated' ? sortForHub(withVariant) : withVariant;
  const counts = items.reduce((acc, { variant }) => ({ ...acc, [variant]: (acc[variant] || 0) + 1 }), {});
  counts.stalled = filtered.filter((p) => isStalled(p, actions.busyIds.includes(p.id))).length;
  const active = FILTERS.find((f) => f.key === filter);
  const shown = items.filter(({ variant }) => active.match(variant));
  const viewLabel = `${selectedCategory ? selectedCategory.label : 'All categories'} · ${active.label}`;
  const categoryCounts = Object.fromEntries(categories.map((c) => [c.key, inCategoryOf(c.key).length]));
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

        <section aria-label="Categories" className="space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="text-lg font-semibold">Knowledge by audience</h2>
              <p className="text-sm text-muted-foreground">Interns come here to learn, employees to execute, leadership to lead.</p>
            </div>
            <button type="button" onClick={() => setManaging(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-[hsl(var(--glass-line))] px-3 h-9 text-sm font-medium hover:bg-muted/40">
              <Settings2 className="w-4 h-4" /> Manage categories
            </button>
          </div>
          <CategoryTiles
            tiles={tiles}
            selected={category}
            onSelect={(k) => { setCategory(k); setFilter('all'); }}
            allTile={category === 'all' ? null : `Show all ${playbooks.length} playbooks`}
          />
        </section>

        <div className="grid gap-5 grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_320px] items-start">
          <section className="glass tone-idle p-4 sm:p-5 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold">{selectedCategory ? selectedCategory.label : 'All playbooks'}</h2>
                {selectedCategory?.audience_label && <p className="text-xs text-muted-foreground">{selectedCategory.audience_label}</p>}
              </div>
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
                {shown.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setClassifyTarget({ bulk: shown.map((i) => i.playbook), label: viewLabel })}
                    className="rounded-full px-3 h-8 text-xs font-medium border border-[hsl(var(--glass-line))] text-muted-foreground hover:text-foreground hover:bg-muted/40 inline-flex items-center gap-1.5 transition-colors"
                    title="Move every playbook in this view to another category"
                  >
                    <ArrowRightLeft className="w-3.5 h-3.5" /> Move these to…
                  </button>
                )}
                {shown.length > 0 && (
                  <button
                    type="button"
                    onClick={() => actions.onDeleteMany(shown.map((i) => i.playbook), viewLabel)}
                    className="rounded-full px-3 h-8 text-xs font-medium border border-rose-500/40 text-rose-600 dark:text-rose-300 hover:bg-rose-500/10 inline-flex items-center gap-1.5 transition-colors"
                    title={`Delete every playbook in “${active.label}”`}
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete {active.key === 'all' ? 'all' : 'these'}…
                  </button>
                )}
              </div>
            </div>

            <div className="mb-5"><PlaybookFilters value={filters} onChange={setFilters} options={options} idPrefix="hub" /></div>

            {isLoading ? (
              <div className="h-64 flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin" /></div>
            ) : shown.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[hsl(var(--glass-line))] py-16 text-center flex flex-col items-center gap-2">
                <Library className="w-8 h-8 text-muted-foreground" />
                <p className="font-medium">{playbooks.length ? 'Nothing in this view' : 'No playbooks yet'}</p>
                <p className="text-sm text-muted-foreground max-w-sm">
                  {!playbooks.length ? 'Upload a PDF or DOCX playbook above, or sync one from Dropbox.'
                    : category === UNCLASSIFIED ? 'Nothing is waiting for review: every document has a category.'
                      : 'Try another category, filter or search.'}
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
                        category={findCategory(categories, known.has(categoryKey(playbook)) ? categoryKey(playbook) : UNCLASSIFIED)}
                        onClassify={setClassifyTarget}
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
      <ClassifyDialog target={classifyTarget} onOpenChange={(o) => !o && setClassifyTarget(null)} suggestions={options} />
      <ManageCategoriesDialog open={managing} onOpenChange={setManaging} counts={categoryCounts} />
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
        title={actions.deleteTarget?.bulk ? `Delete ${actions.deleteTarget.bulk.length} playbooks?` : 'Delete playbook?'}
        description={actions.deleteTarget?.bulk
          ? `Every playbook in “${actions.deleteTarget.label}” will be permanently removed, with its chapters and courses. Learner progress and certificates are kept. Files in Dropbox are not touched.`
          : `“${actions.deleteTarget?.title || ''}” will be permanently removed, with its chapters and courses. Learner progress and certificates are kept. The file in Dropbox is not touched.`}
        confirmLabel={actions.deleteTarget?.bulk ? `Delete ${actions.deleteTarget.bulk.length}` : 'Delete'}
        destructive
        onConfirm={actions.confirmDelete}
      >
        {(actions.deleteTarget?.bulk || [actions.deleteTarget]).some((p) => p?.source === 'dropbox') && (
          <div className="flex items-start gap-2.5 rounded-lg border border-border p-3">
            <Checkbox id="keep-out-of-sync" checked={actions.keepOutOfSync} onCheckedChange={(v) => actions.setKeepOutOfSync(v === true)} className="mt-0.5" />
            <Label htmlFor="keep-out-of-sync" className="text-sm font-normal leading-snug">
              Keep out of future Dropbox syncs
              <span className="block text-xs text-muted-foreground">Untick to let the next sync bring it back if the file is still in the playbooks folder.</span>
            </Label>
          </div>
        )}
      </ConfirmDialog>
    </div>
  );
}
