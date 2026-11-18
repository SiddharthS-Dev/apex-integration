import { Fragment, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Eraser, Loader2, RefreshCw, Save, ScanSearch } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { STUDIO_KEY, fmtBytes, fmtDate, fmtInt, fmtUsd, useStorage, useStorageOverview } from '@/lib/studio';
import { Choice, Field, Notice } from './StudioFields';

// Storage & Dropbox: every number here is measured on the server (object store, temp folder,
// database file, Dropbox space usage, the generation log). Nothing is estimated or simulated, and
// clean-up always starts with a dry run the admin reviews before anything is deleted.

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const sumCats = (cats, names) => cats.filter((c) => names.includes(c.category)).reduce((a, c) => ({ count: a.count + c.count, bytes: a.bytes + c.bytes }), { count: 0, bytes: 0 });
const MEDIA = ['audio', 'audio-superseded', 'tts-cache', 'video', 'video-superseded', 'thumbnail', 'thumbnail-superseded', 'subtitles', 'subtitles-superseded', 'studio-image', 'studio-image-unused', 'media-other', 'media-other-unreferenced'];
const CACHES = ['scene-cache', 'ai-cache', 'extract-cache'];

function CleanupPanel({ report, onDone }) {
  const [includeSuperseded, setIncludeSuperseded] = useState(false);
  const [plan, setPlan] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  const preview = async () => {
    setBusy(true);
    try {
      setPlan(await api.studio.cleanupStorage({ dry_run: true, include_superseded: includeSuperseded }));
    } catch (e) {
      toast.error(e?.message || 'Could not prepare the clean-up');
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await api.studio.cleanupStorage({ dry_run: false, include_superseded: includeSuperseded });
      toast.success(`Removed ${fmtInt(r.objects.removed)} files (${fmtBytes(r.objects.bytes)}) and ${fmtInt(r.temp.removed)} temporary folders`);
      if (r.objects.failed) toast.warning(`${r.objects.failed} files could not be removed — see the server log`);
      setPlan(null);
      onDone();
    } catch (e) {
      toast.error(e?.message || 'Clean-up failed');
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  const total = plan ? plan.objects.bytes + (plan.temp.bytes || 0) : 0;

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="font-semibold">Clean-up</h2>
        <p className="text-sm text-muted-foreground">
          Removes only what can be fetched or rebuilt again: copies of Dropbox files (the originals stay in Dropbox), caches past their retention, abandoned temporary folders and leftover partial writes.
          Uploaded originals and media used by a lesson, meeting or video are never removed.
        </p>
      </div>
      <p className="text-sm">Safe to remove now: <strong>{fmtBytes(report.reclaimable.safe.bytes)}</strong> in {fmtInt(report.reclaimable.safe.count)} files, plus {fmtBytes(report.reclaimable.temp.bytes)} in {fmtInt(report.reclaimable.temp.dirs)} abandoned temporary folders.</p>
      <label className="flex items-center justify-between gap-3 text-sm">
        <span>Also remove generated media no record uses any more (older renders and narration) — {fmtBytes(report.reclaimable.including_superseded_media.bytes - report.reclaimable.safe.bytes)} more</span>
        <Switch checked={includeSuperseded} onCheckedChange={(v) => { setIncludeSuperseded(v); setPlan(null); }} />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={preview} disabled={busy}>{busy && !confirm ? <Loader2 className="animate-spin" /> : <ScanSearch />} Preview clean-up</Button>
        <Button onClick={() => setConfirm(true)} disabled={!plan || busy || (!plan.objects.count && !plan.temp.removed)}><Eraser /> Clean up…</Button>
      </div>
      {plan && (
        <div className="rounded-xl border border-border">
          <Table>
            <TableHeader><TableRow><TableHead>Would remove</TableHead><TableHead className="text-right">Files</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader>
            <TableBody>
              {plan.by_category.map((c) => <TableRow key={c.category}><TableCell>{c.label}</TableCell><TableCell className="text-right tabular-nums">{fmtInt(c.count)}</TableCell><TableCell className="text-right tabular-nums">{fmtBytes(c.bytes)}</TableCell></TableRow>)}
              <TableRow><TableCell>Abandoned temporary folders</TableCell><TableCell className="text-right tabular-nums">{fmtInt(plan.temp.removed)}</TableCell><TableCell className="text-right tabular-nums">{fmtBytes(plan.temp.bytes || 0)}</TableCell></TableRow>
              <TableRow className="font-medium"><TableCell>Total</TableCell><TableCell className="text-right tabular-nums">{fmtInt(plan.objects.count + plan.temp.removed)}</TableCell><TableCell className="text-right tabular-nums">{fmtBytes(total)}</TableCell></TableRow>
            </TableBody>
          </Table>
        </div>
      )}
      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {fmtBytes(total)} from APEX storage?</AlertDialogTitle>
            <AlertDialogDescription>
              {fmtInt(plan?.objects.count)} files and {fmtInt(plan?.temp.removed)} temporary folders will be deleted from this server. Nothing in Dropbox is touched; source documents are read from Dropbox again when they are next processed or viewed.
              {includeSuperseded && ' Older renders and narration no record uses will also go and cannot be restored except by generating them again.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={(e) => { e.preventDefault(); run(); }} disabled={busy}>{busy ? <Loader2 className="animate-spin" /> : <Eraser />} Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function OutputSettings({ output, onSaved }) {
  const [form, setForm] = useState(output);
  const [busy, setBusy] = useState(false);
  useEffect(() => setForm(output), [output]);
  const save = async () => {
    setBusy(true);
    try {
      await api.studio.setOutput(form);
      toast.success('Saved — applies to the next rendered video');
      onSaved();
    } catch (e) {
      toast.error(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
      <div>
        <h2 className="font-semibold">Where rendered videos go</h2>
        <p className="text-sm text-muted-foreground">Keep them on the APEX server, or upload each finished video to the Playbooks Dropbox (one file per lesson, briefing or project, replaced when it is rendered again). Uploading needs the Dropbox app permission <code>files.content.write</code>; after adding it in the Dropbox App Console, reconnect Dropbox.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Destination" htmlFor="out-dest"><Choice id="out-dest" value={form.destination} onChange={(v) => setForm((f) => ({ ...f, destination: v }))} options={[{ value: 'apex', label: 'APEX server' }, { value: 'dropbox', label: 'Dropbox' }]} /></Field>
        <Field label="Dropbox folder" htmlFor="out-folder" hint="Inside the Playbooks Dropbox"><Input id="out-folder" value={form.folder} disabled={form.destination !== 'dropbox'} onChange={(e) => setForm((f) => ({ ...f, folder: e.target.value }))} /></Field>
        <label className="flex items-center justify-between gap-3 self-end pb-2 text-sm">
          <span>Keep a copy on APEX too</span>
          <Switch checked={form.keep_local} disabled={form.destination !== 'dropbox'} onCheckedChange={(v) => setForm((f) => ({ ...f, keep_local: v }))} />
        </label>
      </div>
      <Button onClick={save} disabled={busy}><Save /> Save</Button>
    </section>
  );
}

function DropboxOverview({ o }) {
  const d = o.dropbox;
  const p = o.processing;
  const pb = p.playbooks || {};
  const mt = p.meetings || {};
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Dropbox</h2>
        {!d.accounts.length && <Notice tone="warn">No Dropbox account is connected.</Notice>}
        <ul className="space-y-2 text-sm">
          {d.accounts.map((a) => {
            const s = d.space[a.account] || {};
            return (
              <li key={a.account} className="flex flex-wrap justify-between gap-2">
                <span><strong>{a.label}</strong>{a.account_name ? ` · ${a.account_name}` : ''}</span>
                <span className="tabular-nums text-muted-foreground">{s.error ? `space unavailable (${s.error})` : `${fmtBytes(s.used)} used${s.allocated ? ` of ${fmtBytes(s.allocated)}` : ''}`}</span>
              </li>
            );
          })}
        </ul>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Playbooks folder</dt><dd className="truncate">{d.folders.root_path || '—'}</dd>
          <dt className="text-muted-foreground">Meetings folder</dt><dd className="truncate">{d.folders.meetings_path || '—'}</dd>
          {Object.entries(d.folders.sources || {}).filter(([, v]) => v).map(([k, v]) => <Fragment key={k}><dt className="text-muted-foreground capitalize">{k} folder</dt><dd className="truncate">{v}</dd></Fragment>)}
          <dt className="text-muted-foreground">Last sync</dt>
          <dd>{d.last_sync ? `${fmtDate(d.last_sync.started_at)} · ${d.last_sync.status} · ${fmtInt(d.last_sync.added)} added, ${fmtInt(d.last_sync.updated)} updated, ${fmtInt(d.last_sync.failed)} failed` : 'Never'}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">Sync reads file metadata only. A document's bytes are fetched from Dropbox when it is processed or opened, and are not kept on the server.</p>
      </div>
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Processing</h2>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-muted-foreground">Playbooks</p><p className="tabular-nums">{fmtInt(pb.total)} total · {fmtInt(pb.from_dropbox)} from Dropbox</p><p className="tabular-nums">{fmtInt(pb.extracted)} extracted · {fmtInt(pb.pending)} waiting · {fmtInt(pb.failed)} failed</p><p className="text-xs text-muted-foreground">Last extracted {fmtDate(pb.last_extracted)}</p></div>
          <div><p className="text-muted-foreground">Meetings</p><p className="tabular-nums">{fmtInt(mt.total)} total</p><p className="tabular-nums">{fmtInt(mt.pending)} waiting · {fmtInt(mt.failed)} failed</p></div>
          <div><p className="text-muted-foreground">Documents processed</p><p className="tabular-nums">{fmtInt(p.documents_processed)}</p><p className="text-xs text-muted-foreground">Last {fmtDate(p.last_processed_at)}</p></div>
          <div><p className="text-muted-foreground">Repeat processing avoided</p><p className="tabular-nums">{fmtInt(p.duplicate_processing_prevented)}</p><p className="text-xs text-muted-foreground">Same file revision already done</p></div>
          <div><p className="text-muted-foreground">AI requests for Dropbox documents</p><p className="tabular-nums">{fmtInt(p.ai_requests_for_dropbox_documents)} · {fmtUsd(p.ai_cost_for_dropbox_documents_usd)}</p></div>
          <div><p className="text-muted-foreground">Jobs</p><p className="tabular-nums">{Object.entries(p.jobs || {}).map(([k, v]) => `${fmtInt(v)} ${k}`).join(' · ') || 'None'}</p></div>
        </div>
      </div>
    </section>
  );
}

export default function StorageDashboard() {
  const qc = useQueryClient();
  const storage = useStorage();
  const overview = useStorageOverview();
  const [refreshing, setRefreshing] = useState(false);
  const r = storage.data;
  const refresh = async () => {
    setRefreshing(true);
    try {
      qc.setQueryData([...STUDIO_KEY, 'storage'], await api.studio.storage(true));
      await qc.invalidateQueries({ queryKey: [...STUDIO_KEY, 'storage-overview'] });
    } catch (e) {
      toast.error(e?.message || 'Could not measure storage');
    } finally {
      setRefreshing(false);
    }
  };

  if (storage.isLoading) return <p className="text-sm text-muted-foreground">Measuring storage…</p>;
  if (storage.error) return <Notice tone="error">Could not load storage: {storage.error.message}</Notice>;
  if (!r) return <Notice>Storage reporting needs the API server.</Notice>;
  const dbxCopies = sumCats(r.categories, ['dropbox-current', 'dropbox-orphan']);
  const media = sumCats(r.categories, MEDIA);
  const caches = sumCats(r.categories, CACHES);
  const uploads = sumCats(r.categories, ['upload', 'upload-unreferenced']);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <span>Measured {fmtDate(r.measured_at)}</span>
        <Button size="sm" variant="ghost" onClick={refresh} disabled={refreshing}>{refreshing ? <Loader2 className="animate-spin" /> : <RefreshCw />} Measure again</Button>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="APEX file storage" value={fmtBytes(r.object_store.bytes)} sub={`${fmtInt(r.object_store.count)} files`} />
        <Stat label="Copies of Dropbox files" value={fmtBytes(dbxCopies.bytes)} sub={`${fmtInt(dbxCopies.count)} files · policy: ${r.policy.dropbox_source_cache === 'temporary' ? 'not kept' : 'kept'}`} />
        <Stat label="Generated media" value={fmtBytes(media.bytes)} sub={`${fmtInt(media.count)} files (narration, videos, images)`} />
        <Stat label="Database" value={fmtBytes(r.database.bytes)} sub={r.database.dialect} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Uploaded originals" value={fmtBytes(uploads.bytes)} sub={`${fmtInt(uploads.count)} files — the only copy, never cleaned`} />
        <Stat label="Caches" value={fmtBytes(caches.bytes)} sub={`${fmtInt(caches.count)} files (scenes, AI answers, extracted text)`} />
        <Stat label="Temporary processing" value={fmtBytes(r.temp.bytes)} sub={`${fmtInt(r.temp.dirs)} folders · ${fmtInt(r.temp.in_use)} in use · ${fmtInt(r.temp.abandoned)} abandoned`} />
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">By category</h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Category</TableHead><TableHead className="text-right">Files</TableHead><TableHead className="text-right">Size</TableHead></TableRow></TableHeader>
            <TableBody>
              {r.categories.map((c) => <TableRow key={c.category}><TableCell>{c.label}</TableCell><TableCell className="text-right tabular-nums">{fmtInt(c.count)}</TableCell><TableCell className="text-right tabular-nums">{fmtBytes(c.bytes)}</TableCell></TableRow>)}
              {!r.categories.length && <TableRow><TableCell colSpan={3} className="py-6 text-center text-sm text-muted-foreground">No files stored.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          Retention: AI cache {r.policy.retention_days['ai-cache']} days · voice-over cache {r.policy.retention_days['tts-cache']} days · scene cache {r.policy.retention_days['scene-cache']} days · extracted text {r.policy.retention_days['extract-cache']} days · abandoned temporary folders after {r.policy.temp_max_age_hours} hours.
          Automatic clean-up: {r.policy.auto_cleanup ? 'on (daily)' : 'off — abandoned temporary folders only'}.
        </p>
      </section>

      <CleanupPanel report={r} onDone={refresh} />
      <OutputSettings output={r.output} onSaved={() => qc.invalidateQueries({ queryKey: [...STUDIO_KEY, 'storage'] })} />
      {overview.data && <DropboxOverview o={overview.data} />}
      {overview.error && <Notice tone="error">Could not load the Dropbox overview: {overview.error.message}</Notice>}
    </div>
  );
}
