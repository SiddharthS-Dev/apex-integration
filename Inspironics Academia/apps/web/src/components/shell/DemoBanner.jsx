import { useState } from 'react';
import { FlaskConical, RotateCcw } from 'lucide-react';
import { api, backendKind } from '@/api/client';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';

// Thin strip shown only with the in-browser demo backend (VITE_BACKEND=demo).
export default function DemoBanner() {
  const [confirming, setConfirming] = useState(false);
  if (backendKind !== 'demo') return null;
  const reset = async () => {
    await api.demo.reset();
    window.location.reload();
  };
  return (
    <div className="bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-200 text-xs no-print">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-8 flex items-center justify-center gap-3">
        <FlaskConical className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate">Demo mode — data is stored in this browser</span>
        <button type="button" onClick={() => setConfirming(true)} className="inline-flex items-center gap-1 font-semibold hover:underline">
          <RotateCcw className="w-3 h-3" /> Reset
        </button>
      </div>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Reset demo data?"
        description="All changes made in this browser are discarded and the sample academy is restored. You will be signed out."
        confirmLabel="Reset"
        destructive
        onConfirm={reset}
      />
    </div>
  );
}
