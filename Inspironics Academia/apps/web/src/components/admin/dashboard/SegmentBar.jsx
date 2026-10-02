import { cn } from '@/lib/utils';
import { LESSON_SEGMENTS } from '@/components/admin/dashboard/lessonStatus';

// Horizontal stacked bar of lesson status counts.
export default function SegmentBar({ counts = {}, total = 0, className }) {
  return (
    <div className={cn('flex h-3 w-full overflow-hidden rounded-full bg-muted', className)}>
      {total > 0 &&
        LESSON_SEGMENTS.map((s) => {
          const value = counts[s.key] || 0;
          if (!value) return null;
          return (
            <div
              key={s.key}
              className={cn('h-full transition-all', s.bar)}
              style={{ width: `${(value / total) * 100}%` }}
              title={`${s.label}: ${value}`}
            />
          );
        })}
    </div>
  );
}
