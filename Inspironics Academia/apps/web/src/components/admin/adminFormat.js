import { format, formatDistanceToNow } from 'date-fns';

// Shared formatting helpers and badge color maps for admin pages.

export function timeAgo(date) {
  if (!date) return '—';
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return '—';
  }
}

export function formatDate(date, pattern = 'MMM d, yyyy') {
  if (!date) return '—';
  try {
    return format(new Date(date), pattern);
  } catch {
    return '—';
  }
}

export const DIFFICULTY_COLORS = {
  beginner: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  basic: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  advanced: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

export const COGNITIVE_COLORS = {
  recall: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  understanding: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  application: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  analysis: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300',
};

export const ACCESS_COLORS = {
  free: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  premium: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};

export const PILL = 'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap';
