import { AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import LessonStatusDot from '@/components/admin/studio/LessonStatusDot';

export default function CoverageChapterRow({ chapter, lessons, onSelectLesson }) {
  const uncovered = lessons.length === 0;
  return (
    <div
      className={cn(
        'rounded-xl border p-3',
        uncovered ? 'border-rose-200 bg-rose-50 dark:border-rose-900 dark:bg-rose-950/40' : 'border-border',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-medium min-w-0">
          {chapter.number != null && chapter.number !== '' && <span className="text-muted-foreground mr-1">{chapter.number}.</span>}
          {chapter.title}
        </div>
        {uncovered ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400 shrink-0">
            <AlertTriangle className="w-3.5 h-3.5" /> No lessons
          </span>
        ) : (
          <span className="text-xs text-muted-foreground shrink-0">{lessons.length} lessons</span>
        )}
      </div>
      {!uncovered && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {lessons.map((l) => (
            <button
              key={l.id}
              type="button"
              onClick={() => onSelectLesson?.(l.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2 py-0.5 text-xs hover:bg-muted max-w-[14rem]"
            >
              <LessonStatusDot status={l.status} />
              <span className="truncate">{l.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
