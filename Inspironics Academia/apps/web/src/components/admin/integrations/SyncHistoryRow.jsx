import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TableCell, TableRow } from '@/components/ui/table';
import StatusBadge from '@/components/admin/StatusBadge';
import { formatDate } from '@/components/admin/adminFormat';

const COUNTS = ['discovered', 'added', 'updated', 'unchanged', 'archived', 'failed'];

function duration(ms) {
  if (ms === null || ms === undefined) return '—';
  return ms < 1000 ? `${ms} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms / 60000)} min`;
}

export default function SyncHistoryRow({ log }) {
  const [open, setOpen] = useState(false);
  const errors = Array.isArray(log.errors) ? log.errors : [];
  return (
    <Fragment>
      <TableRow>
        <TableCell className="whitespace-nowrap">{formatDate(log.started_at, 'MMM d, HH:mm:ss')}</TableCell>
        <TableCell className="capitalize">{log.trigger}</TableCell>
        <TableCell><StatusBadge status={log.status} /></TableCell>
        <TableCell className="whitespace-nowrap">{duration(log.duration_ms)}</TableCell>
        {COUNTS.map((k) => <TableCell key={k} className="text-right tabular-nums">{log[k] ?? 0}</TableCell>)}
        <TableCell>
          {errors.length > 0 && (
            <button type="button" onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1 text-xs text-rose-600 dark:text-rose-400">
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} {errors.length}
            </button>
          )}
        </TableCell>
      </TableRow>
      {open && (
        <TableRow>
          <TableCell colSpan={11} className="bg-muted/40">
            <ul className="space-y-1 font-mono text-xs text-rose-700 dark:text-rose-300">
              {errors.map((e, i) => <li key={i}>{e}</li>)}
            </ul>
          </TableCell>
        </TableRow>
      )}
    </Fragment>
  );
}
