import { useState } from 'react';
import { motion } from 'framer-motion';
import { ClipboardCheck, FileQuestion, GraduationCap, Layers, Loader2, CheckCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import ConfirmDialog from '@/components/admin/playbooks/ConfirmDialog';
import { pendingCategories } from './controlData';

const ICONS = { lessons: GraduationCap, questions: FileQuestion, assessments: ClipboardCheck, flashcards: Layers };

export default function PendingSidebar({ data, actions, onOpenQueue }) {
  const cats = pendingCategories(data);
  const [selected, setSelected] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const total = cats.reduce((s, c) => s + c.items.length, 0);
  const selectedCount = cats.filter((c) => selected.includes(c.key)).reduce((s, c) => s + c.items.length, 0);
  const toggle = (key) => setSelected((s) => (s.includes(key) ? s.filter((k) => k !== key) : [...s, key]));

  return (
    <section className="glass tone-idle p-4 sm:p-5">
      <h2 className="font-semibold">Pending review</h2>
      <p className="text-xs text-muted-foreground">AI content awaiting approval</p>
      <ul className="mt-4 space-y-1.5">
        {cats.map((c) => {
          const Icon = ICONS[c.key];
          const n = c.items.length;
          return (
            <motion.li key={c.key} whileHover={{ scale: 1.01 }} className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/40 transition-colors">
              <input
                type="checkbox" aria-label={`Select ${c.label}`} checked={selected.includes(c.key)} disabled={!n} onChange={() => toggle(c.key)}
                className="w-4 h-4 rounded accent-violet-500 disabled:opacity-40"
              />
              <span className="w-8 h-8 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-300 ring-1 ring-amber-400/30 flex items-center justify-center shrink-0"><Icon className="w-4 h-4" /></span>
              <span className="text-sm">{c.label}</span>
              <span className="ml-auto flex items-center gap-3">
                {c.queueKind ? (
                  <button type="button" onClick={() => onOpenQueue(c.queueKind)} className="text-xs text-violet-600 dark:text-violet-300 hover:underline">Go to queue</button>
                ) : (
                  <Link to="/admin/courses" className="text-xs text-violet-600 dark:text-violet-300 hover:underline">Open courses</Link>
                )}
                <span className={cn(
                  'min-w-7 h-7 px-2 rounded-lg text-xs font-bold tabular-nums flex items-center justify-center',
                  n ? 'bg-amber-500/15 text-amber-600 dark:text-amber-300 shadow-[0_0_14px_-3px_rgb(251_191_36/0.8)]' : 'bg-muted/60 text-muted-foreground',
                )}
                >
                  {n}
                </span>
              </span>
            </motion.li>
          );
        })}
      </ul>
      <div className="mt-4 pt-4 border-t border-[hsl(var(--glass-line))] flex items-center justify-between gap-3">
        <div className="text-sm"><span className="text-muted-foreground">Total</span> <span className="font-bold text-lg tabular-nums ml-1">{total}</span></div>
        <motion.button
          type="button" whileTap={{ scale: 0.97 }} disabled={!selectedCount || actions.bulkBusy} onClick={() => setConfirm(true)}
          className="inline-flex items-center gap-1.5 h-9 px-3 rounded-xl bg-violet-600 text-white text-xs font-medium shadow-[0_0_18px_-4px_rgb(139_92_246/0.9)] hover:bg-violet-500 disabled:opacity-40 disabled:shadow-none"
        >
          {actions.bulkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
          Approve selected{selectedCount ? ` (${selectedCount})` : ''}
        </motion.button>
      </div>
      <ConfirmDialog
        open={confirm} onOpenChange={setConfirm}
        title={`Approve ${selectedCount} item${selectedCount === 1 ? '' : 's'}?`}
        description="Everything awaiting review in the selected categories is approved without opening it. Rejected items are left alone."
        confirmLabel="Approve"
        onConfirm={async () => { setConfirm(false); await actions.bulkApprove(selected); setSelected([]); }}
      />
    </section>
  );
}
