import { cn } from '@/lib/utils';

export const STATUS_COLORS = {
  uploaded: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  processing: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  processed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  needs_review: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  failed: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  published: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  draft: 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
  pending: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-300',
  generating: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  pending_review: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  approved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rejected: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  archived: 'bg-slate-100 text-slate-500 dark:bg-slate-500/15 dark:text-slate-300',
  open: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  reviewed: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  resolved: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  running: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  success: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  partial: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
};

export function statusLabel(status = '') {
  return status.replace(/_/g, ' ');
}

export default function StatusBadge({ status, className }) {
  if (!status) return null;
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap',
        STATUS_COLORS[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300',
        className,
      )}
    >
      {statusLabel(status)}
    </span>
  );
}
