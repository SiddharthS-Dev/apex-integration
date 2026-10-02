import { cn } from '@/lib/utils';

const TYPE_COLORS = {
  concept: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
  deep_dive: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  example: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  architecture: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  demonstration: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  revision: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

export default function VideoTypeBadge({ type = 'concept', className }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize whitespace-nowrap',
        TYPE_COLORS[type] || TYPE_COLORS.concept,
        className,
      )}
    >
      {(type || 'concept').replace(/_/g, ' ')}
    </span>
  );
}
