import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import LessonStatusDot from '@/components/admin/studio/LessonStatusDot';

export default function CourseTreeModule({ module, index, lessons, selectedId, onSelect }) {
  const [open, setOpen] = useState(true);
  const approved = lessons.filter((l) => l.status === 'approved').length;
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left hover:bg-muted"
      >
        <Chevron className="w-4 h-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1 min-w-0 truncate">{index + 1}. {module.title}</span>
        <span className="text-xs text-muted-foreground tabular-nums">{approved}/{lessons.length}</span>
      </button>
      {open && (
        <ul className="ml-6 border-l border-border pl-2 space-y-0.5 py-1">
          {lessons.map((lesson) => (
            <li key={lesson.id}>
              <button
                type="button"
                onClick={() => onSelect(lesson.id)}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left text-sm',
                  lesson.id === selectedId ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                )}
              >
                <LessonStatusDot status={lesson.status} />
                <span className="truncate">{lesson.title}</span>
              </button>
            </li>
          ))}
          {!lessons.length && <li className="px-2 py-1.5 text-xs text-muted-foreground">No lessons</li>}
        </ul>
      )}
    </div>
  );
}
