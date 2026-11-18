import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

const DIFFICULTY = {
  beginner: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  advanced: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};
const pill = 'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium capitalize';

// access_level 'premium' gates nothing and there is no payment anywhere in the app, so learners see it
// as "Featured" rather than a paid tier; 'free' (every other course) gets no badge at all.
export default function CourseBadges({ course, className }) {
  const difficulty = course?.difficulty || 'beginner';
  const featured = course?.access_level === 'premium';
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <span className={cn(pill, DIFFICULTY[difficulty] || DIFFICULTY.beginner)}>{difficulty}</span>
      {featured && (
        <span className={cn(pill, 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300')}>
          <Star className="w-3 h-3" />
          Featured
        </span>
      )}
    </div>
  );
}
