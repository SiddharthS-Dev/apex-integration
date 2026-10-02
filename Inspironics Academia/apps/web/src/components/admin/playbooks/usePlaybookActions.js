import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { runPlaybookPipeline } from '@/lib/pipeline';

// Process / re-process / download / delete handlers for the playbook repository.
export default function usePlaybookActions() {
  const queryClient = useQueryClient();
  const [busyIds, setBusyIds] = useState([]);
  const [reprocessTarget, setReprocessTarget] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

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
    try {
      await api.entities.Playbook.delete(target.id);
      toast.success(`Deleted “${target.title}”`);
      refresh();
    } catch (err) {
      toast.error(`Delete failed: ${err?.message || 'Unknown error'}`);
    }
  };

  return {
    busyIds, onProcess, onDownload, onDelete: setDeleteTarget,
    reprocessTarget, setReprocessTarget, confirmReprocess,
    deleteTarget, setDeleteTarget, confirmDelete,
  };
}
