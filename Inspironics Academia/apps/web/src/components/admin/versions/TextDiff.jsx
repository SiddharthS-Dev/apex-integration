import { useMemo } from 'react';
import { diffStats, diffWords } from '@/lib/diff';

const PART_CLASSES = {
  added: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-900/60 dark:text-emerald-100 rounded-sm',
  removed: 'bg-rose-100 text-rose-900 line-through dark:bg-rose-900/60 dark:text-rose-100 rounded-sm',
  equal: '',
};

function Pane({ label, parts }) {
  return (
    <div className="min-w-0">
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">{label}</div>
      <div className="rounded-xl border border-border bg-background p-3 text-sm leading-relaxed whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
        {parts.length ? parts.map((p, i) => <span key={i} className={PART_CLASSES[p.type]}>{p.value}</span>) : <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

// Side-by-side word-level diff: left shows removals, right shows additions.
export default function TextDiff({ title, oldText, newText, oldLabel = 'Before', newLabel = 'After' }) {
  const parts = useMemo(() => diffWords(oldText || '', newText || ''), [oldText, newText]);
  const stats = diffStats(parts);
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold">{title}</h2>
        <div className="flex gap-3 text-xs font-medium">
          <span className="text-emerald-600 dark:text-emerald-400">+{stats.added} words</span>
          <span className="text-rose-600 dark:text-rose-400">−{stats.removed} words</span>
        </div>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        <Pane label={oldLabel} parts={parts.filter((p) => p.type !== 'added')} />
        <Pane label={newLabel} parts={parts.filter((p) => p.type !== 'removed')} />
      </div>
    </div>
  );
}
