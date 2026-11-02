import { REVIEW_RATINGS } from '@academy/shared';
import { Button } from '@/components/ui/button';
import { intervalLabel } from '@/lib/retention';

const STYLES = {
  again: 'border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10',
  hard: 'border-amber-200 text-amber-700 hover:bg-amber-50 dark:border-amber-500/30 dark:text-amber-300 dark:hover:bg-amber-500/10',
  good: 'border-sky-200 text-sky-700 hover:bg-sky-50 dark:border-sky-500/30 dark:text-sky-300 dark:hover:bg-sky-500/10',
  easy: 'border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/10',
};

// `intervals` ({ again, hard, good, easy } in days) previews when the card comes back for each rating.
export default function RatingButtons({ onRate, disabled, intervals }) {
  return (
    <div className="grid grid-cols-4 gap-2">
      {REVIEW_RATINGS.map((r) => (
        <Button
          key={r.key}
          type="button"
          variant="outline"
          disabled={disabled}
          className={`${STYLES[r.key]} h-auto py-2 flex-col gap-0`}
          onClick={() => onRate(r.quality)}
        >
          <span>{r.label}</span>
          {intervals?.[r.key] != null && <span className="text-[11px] font-normal opacity-75 tabular-nums">{intervalLabel(intervals[r.key])}</span>}
        </Button>
      ))}
    </div>
  );
}
