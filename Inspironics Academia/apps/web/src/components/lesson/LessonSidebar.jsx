import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, PlayCircle } from 'lucide-react';
import { isLessonComplete, sortByOrder } from '@/lib/progress';
import { cn } from '@/lib/utils';

export default function LessonSidebar({ courseId, modules, lessons, progress, currentId }) {
  return (
    <aside className="rounded-2xl border border-border bg-card p-3 lg:sticky lg:top-24 lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto">
      <h2 className="text-sm font-semibold px-2 pt-1 pb-2">Course lessons</h2>
      {modules.map((m) => {
        const items = sortByOrder(lessons.filter((l) => l.module_id === m.id));
        if (!items.length) return null;
        return (
          <div key={m.id} className="mb-2">
            <p className="px-2 py-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{m.title}</p>
            {items.map((l) => {
              const current = l.id === currentId;
              const done = isLessonComplete(progress, l.id);
              const Icon = done ? CheckCircle2 : current ? PlayCircle : Circle;
              return (
                <Link
                  key={l.id}
                  to={`/learn/${courseId}/${l.id}`}
                  className={cn(
                    'flex items-start gap-2 rounded-lg px-2 py-2 text-sm transition-colors',
                    current ? 'bg-primary/10 text-primary font-medium' : 'hover:bg-muted',
                  )}
                >
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', done ? 'text-emerald-500' : current ? 'text-primary' : 'text-muted-foreground/50')} />
                  <span className="line-clamp-2">{l.title}</span>
                </Link>
              );
            })}
          </div>
        );
      })}
    </aside>
  );
}
