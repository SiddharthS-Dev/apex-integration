import { ListTree } from 'lucide-react';
import { sortByOrder } from '@/lib/progress';
import CourseTreeModule from '@/components/admin/studio/CourseTreeModule';

export default function CourseTree({ modules = [], lessons = [], selectedId, onSelect }) {
  const ordered = sortByOrder(modules);
  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold flex items-center gap-2">
          <ListTree className="w-4 h-4 text-primary" />
          Course outline
        </h2>
        <span className="text-xs text-muted-foreground">{ordered.length} modules · {lessons.length} lessons</span>
      </div>
      <div className="space-y-1 max-h-[70vh] overflow-y-auto -mx-2 px-2">
        {ordered.map((m, i) => (
          <CourseTreeModule
            key={m.id}
            module={m}
            index={i}
            lessons={sortByOrder(lessons.filter((l) => l.module_id === m.id))}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
        {!ordered.length && <p className="text-sm text-muted-foreground py-4 text-center">No modules yet</p>}
      </div>
    </div>
  );
}
