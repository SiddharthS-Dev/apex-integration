import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function RatingStars({ rating = 0 }) {
  return (
    <div className="flex items-center gap-0.5" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          className={cn(
            'w-4 h-4',
            n <= rating ? 'fill-amber-400 text-amber-400 dark:fill-amber-300 dark:text-amber-300' : 'text-muted-foreground/40',
          )}
        />
      ))}
    </div>
  );
}
