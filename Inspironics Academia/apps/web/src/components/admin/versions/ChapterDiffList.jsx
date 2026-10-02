import { cn } from '@/lib/utils';

const STATUS_STYLES = {
  added: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
  removed: 'bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300',
  changed: 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300',
  unchanged: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
};

export default function ChapterDiffList({ rows, selectedKey, onSelect, errors = [] }) {
  const counts = rows.reduce((acc, r) => ({ ...acc, [r.status]: (acc[r.status] || 0) + 1 }), {});
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 className="font-semibold">Chapters</h2>
        <div className="flex flex-wrap gap-1.5">
          {['added', 'removed', 'changed'].map((s) => (
            <span key={s} className={cn('rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_STYLES[s])}>{counts[s] || 0} {s}</span>
          ))}
        </div>
      </div>
      {errors.map((e) => <p key={e} className="text-xs text-rose-600 dark:text-rose-400 mb-2">{e}</p>)}
      <ul className="space-y-1 max-h-[28rem] overflow-y-auto">
        {rows.map((r) => {
          const ch = r.newChapter || r.oldChapter;
          return (
            <li key={r.key}>
              <button
                type="button"
                onClick={() => onSelect(r.key)}
                className={cn(
                  'w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm',
                  r.key === selectedKey ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
                )}
              >
                <span className={cn('rounded-full px-2 py-0.5 text-[10px] font-medium uppercase shrink-0', STATUS_STYLES[r.status])}>{r.status}</span>
                <span className={cn('truncate', r.status === 'removed' && 'line-through text-muted-foreground')}>
                  {ch?.number != null && ch.number !== '' ? `${ch.number}. ` : ''}{ch?.title || 'Untitled'}
                </span>
              </button>
            </li>
          );
        })}
        {!rows.length && <li className="text-sm text-muted-foreground py-4 text-center">No chapter snapshots</li>}
      </ul>
    </div>
  );
}
