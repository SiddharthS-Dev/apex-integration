import { BookOpen, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { cn } from '@/lib/utils';

// Traceability badge row: "Playbook › Chapter › Section".
export default function SourceRef({ playbook, chapter, section, className }) {
  const parts = [playbook, chapter, section].filter((p) => p && String(p).trim());
  if (!parts.length) return null;
  return (
    <div
      className={cn(
        'inline-flex flex-wrap items-center gap-1 rounded-lg bg-muted px-2 py-1 text-xs text-muted-foreground',
        className,
      )}
    >
      <BookOpen className="w-3.5 h-3.5 shrink-0" />
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <ChevronRight className="w-3 h-3 shrink-0 opacity-60" />}
          <span className="truncate max-w-[16rem]">{part}</span>
        </Fragment>
      ))}
    </div>
  );
}
