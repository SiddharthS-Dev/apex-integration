import { Draggable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import ModuleHeader from '@/components/admin/editor/ModuleHeader';
import LessonList from '@/components/admin/editor/LessonList';
import InlineAddForm from '@/components/admin/editor/InlineAddForm';

export default function ModuleCard({ module, index, lessons, actions }) {
  return (
    <Draggable draggableId={module.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn('rounded-2xl border border-border bg-card p-5', snapshot.isDragging && 'shadow-lg ring-2 ring-primary/30')}
        >
          <ModuleHeader module={module} index={index} lessons={lessons} actions={actions} dragHandleProps={provided.dragHandleProps} />
          <LessonList moduleId={module.id} lessons={lessons} actions={actions} />
          <div className="mt-3">
            <InlineAddForm
              placeholder="New lesson title"
              buttonLabel="Add lesson"
              pending={actions.addLesson.isPending && actions.addLesson.variables?.moduleId === module.id}
              onAdd={(title) => actions.addLesson.mutate({ moduleId: module.id, title, lessons })}
            />
          </div>
        </div>
      )}
    </Draggable>
  );
}
