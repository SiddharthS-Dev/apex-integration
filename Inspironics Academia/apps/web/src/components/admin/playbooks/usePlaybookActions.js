import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { runPlaybookPipeline } from '@/lib/pipeline';

// Process / re-process / download / delete handlers for the playbook repository. Deleting goes through
// deletePlaybooks, which removes chapters and courses too and can keep Dropbox files out of future syncs.
export default function usePlaybookActions() {
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState([]);
  const [reprocessTarget, setReprocessTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null); // one playbook, or { bulk: [...playbooks], label }
  const [keepOutOfSync, setKeepOutOfSync] = useState(true);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['playbooks'] });
  const setBusy = (id, on) => setBusyIds((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

  const run = async (playbook, opts) => {
    setBusy(playbook.id, true);
    const toastId = toast.loading(opts?.force ? `Re-processing “${playbook.title}”…` : `Processing “${playbook.title}”…`);
    refresh();
    const result = await runPlaybookPipeline(playbook.id, opts);
    setBusy(playbook.id, false);
    refresh();
    if (result.ok) {
      const s = result.structure || {};
      toast.success(`Built ${s.module_count ?? 0} modules / ${s.lesson_count ?? 0} lessons`, { id: toastId });
    } else if (result.skipped) {
      toast.info('An active course already exists — structure step skipped', {
        id: toastId,
        action: { label: 'Re-process', onClick: () => setReprocessTarget(playbook) },
      });
    } else {
      toast.error(`Processing failed: ${result.error}`, { id: toastId });
    }
  };

  const onProcess = (playbook) => run(playbook);
  const confirmReprocess = () => {
    const target = reprocessTarget;
    setReprocessTarget(null);
    if (target) run(target, { force: true, skipExtract: true });
  };

  // The API streams the source file (upload store or Dropbox) through its own content proxy.
  const onDownload = (playbook) => {
    window.open(api.files.playbookContentUrl(playbook.id, { download: true }), '_blank', 'noopener');
  };

  const confirmDelete = async () => {
    const target = deleteTarget;
    setDeleteTarget(null);
    if (!target) return;
    const list = target.bulk || [target];
    const toastId = toast.loading(`Deleting ${list.length === 1 ? `“${list[0].title}”` : `${list.length} playbooks`}…`);
    try {
      const { data } = await api.functions.invoke('deletePlaybooks', { playbook_ids: list.map((p) => p.id), keep_out_of_sync: keepOutOfSync });
      const kept = data.kept_out_of_sync ? ` · ${data.kept_out_of_sync} kept out of future syncs` : '';
      toast.success(`Deleted ${data.deleted === 1 ? `“${list[0].title}”` : `${data.deleted} playbooks`}${kept}`, { id: toastId });
    } catch (err) {
      toast.error(`Delete failed: ${err?.message || 'Unknown error'}`, { id: toastId });
    } finally {
      refresh();
      queryClient.invalidateQueries({ queryKey: ['hub-courses'] });
    }
  };

  const onDelete = (playbook) => { setKeepOutOfSync(true); setDeleteTarget(playbook); };
  const onDeleteMany = (playbooks, label) => { if (playbooks.length) { setKeepOutOfSync(true); setDeleteTarget({ bulk: playbooks, label }); } };

  return {
    busyIds, onProcess, onDownload, onDelete, onDeleteMany,
    reprocessTarget, setReprocessTarget, confirmReprocess,
    deleteTarget, setDeleteTarget, confirmDelete, keepOutOfSync, setKeepOutOfSync,
  };
}
