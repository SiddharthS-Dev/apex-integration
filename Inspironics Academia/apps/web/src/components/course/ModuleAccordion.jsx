import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { isLessonComplete, sortByOrder } from '@/lib/progress';
import ModuleLessonRow from '@/components/course/ModuleLessonRow';
import ChapterTestLink from '@/components/course/ChapterTestLink';

export default function ModuleAccordion({ modules, lessons, progress, courseId }) {
  const passed = progress?.completed_chapters || [];
  return (
    <Accordion type="multiple" defaultValue={modules.slice(0, 1).map((m) => m.id)} className="rounded-2xl border border-border bg-card px-5">
      {modules.map((m, i) => {
        const moduleLessons = sortByOrder(lessons.filter((l) => l.module_id === m.id));
        const done = moduleLessons.filter((l) => isLessonComplete(progress, l.id)).length;
        return (
          <AccordionItem key={m.id} value={m.id} className="last:border-b-0">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="font-semibold truncate">{m.title}</div>
                  <div className="text-xs text-muted-foreground font-normal">
                    {done}/{moduleLessons.length} lessons complete
                  </div>
                </div>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              {m.description && <p className="text-muted-foreground mb-2 px-3">{m.description}</p>}
              {moduleLessons.length === 0 && <p className="text-muted-foreground px-3 py-2">No lessons available yet.</p>}
              {moduleLessons.map((l, idx) => (
                <ModuleLessonRow key={l.id} lesson={l} index={idx} courseId={courseId} completed={isLessonComplete(progress, l.id)} />
              ))}
              <ChapterTestLink moduleId={m.id} passed={passed.includes(m.id)} />
            </AccordionContent>
          </AccordionItem>
        );
      })}
    </Accordion>
  );
}
