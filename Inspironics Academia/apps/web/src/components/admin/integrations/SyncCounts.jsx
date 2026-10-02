const FIELDS = [
  ['discovered', 'Discovered'],
  ['added', 'Added'],
  ['updated', 'Updated'],
  ['unchanged', 'Unchanged'],
  ['archived', 'Archived'],
  ['failed', 'Failed'],
];

export default function SyncCounts({ log }) {
  return (
    <dl className="grid grid-cols-3 sm:grid-cols-6 gap-3">
      {FIELDS.map(([key, label]) => (
        <div key={key} className="rounded-xl bg-muted/50 px-3 py-2">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className={key === 'failed' && log[key] > 0 ? 'text-lg font-semibold text-rose-600 dark:text-rose-400' : 'text-lg font-semibold'}>
            {log[key] ?? 0}
          </dd>
        </div>
      ))}
    </dl>
  );
}
