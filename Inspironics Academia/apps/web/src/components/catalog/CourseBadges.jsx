import { Crown, Gift } from 'lucide-react';
import { cn } from '@/lib/utils';

const DIFFICULTY = {
  beginner: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  advanced: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};
const ACCESS = {
  free: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  premium: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
};
const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize';

export default function CourseBadges({ course, className }) {
  const difficulty = course?.difficulty || 'beginner';
  const access = course?.access_level || 'free';
  const AccessIcon = access === 'premium' ? Crown : Gift;
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className={cn(pill, DIFFICULTY[difficulty] || DIFFICULTY.beginner)}>{difficulty}</span>
      <span className={cn(pill, ACCESS[access] || ACCESS.free)}>
        <AccessIcon className="w-3 h-3" />
        {access}
      </span>
    </div>
  );
}
