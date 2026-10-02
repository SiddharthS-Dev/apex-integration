import { Droppable } from '@hello-pangea/dnd';
import { cn } from '@/lib/utils';
import LessonRow from '@/components/admin/editor/LessonRow';

export default function LessonList({ moduleId, lessons, actions }) {
  return (
    <Droppable droppableId={moduleId} type="LESSON">
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.droppableProps}
          className={cn('space-y-1.5 rounded-xl min-h-[2.5rem] p-1 transition-colors', snapshot.isDraggingOver && 'bg-primary/5')}
        >
          {lessons.length === 0 && !snapshot.isDraggingOver && (
            <p className="text-sm text-muted-foreground px-2 py-2">No lessons in this module yet.</p>
          )}
          {lessons.map((lesson, index) => (
            <LessonRow key={lesson.id} lesson={lesson} index={index} actions={actions} />
          ))}
          {provided.placeholder}
        </div>
      )}
    </Droppable>
  );
}
