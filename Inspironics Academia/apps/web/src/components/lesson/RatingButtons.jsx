import { Button } from '@/components/ui/button';

const RATINGS = [
  { label: 'Again', quality: 1, className: 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10' },
  { label: 'Hard', quality: 3, className: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10' },
  { label: 'Good', quality: 4, className: 'border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10' },
  { label: 'Easy', quality: 5, className: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10' },
];

export default function RatingButtons({ onRate, disabled }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {RATINGS.map((r) => (
        <Button key={r.label} type="button" variant="outline" disabled={disabled} className={r.className} onClick={() => onRate(r.quality)}>
          {r.label}
        </Button>
      ))}
    </div>
  );
}
