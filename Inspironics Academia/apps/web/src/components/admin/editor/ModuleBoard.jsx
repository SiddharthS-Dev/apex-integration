import { DragDropContext, Droppable } from '@hello-pangea/dnd';
import { toast } from 'sonner';
import { Layers } from 'lucide-react';
import { sortByOrder } from '@/lib/progress';
import EmptyState from '@/components/EmptyState';
import ModuleCard from '@/components/admin/editor/ModuleCard';
import InlineAddForm from '@/components/admin/editor/InlineAddForm';
import { reorder } from '@/components/admin/editor/editorApi';

// Drag-and-drop list of modules (type MODULE) with nested lesson lists (type LESSON).
export default function ModuleBoard({ modules, lessons, actions }) {
  const lessonsFor = (moduleId) => sortByOrder(lessons.filter((l) => l.module_id === moduleId));

  const onDragEnd = ({ source, destination, type }) => {
    if (!destination) return;
    if (source.droppableId === destination.droppableId && source.index === destination.index) return;
    if (type === 'MODULE') {
      actions.reorderModules(reorder(modules, source.index, destination.index), modules);
      return;
    }
    if (source.droppableId !== destination.droppableId) {
      toast.info('Lessons can only be reordered within their module');
      return;
    }
    const list = lessonsFor(source.droppableId);
    actions.reorderLessons(reorder(list, source.index, destination.index), list);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold mb-3">Add module</h2>
        <InlineAddForm
          placeholder="New module title"
          buttonLabel="Add module"
          pending={actions.addModule.isPending}
          onAdd={(title) => actions.addModule.mutate({ title, modules })}
        />
      </div>
      {modules.length === 0 ? (
        <EmptyState icon={Layers} title="No modules yet" description="Add a module to start structuring this course." />
      ) : (
        <DragDropContext onDragEnd={onDragEnd}>
          <Droppable droppableId="modules" type="MODULE">
            {(provided) => (
              <div ref={provided.innerRef} {...provided.droppableProps} className="space-y-4">
                {modules.map((module, index) => (
                  <ModuleCard key={module.id} module={module} index={index} lessons={lessonsFor(module.id)} actions={actions} />
                ))}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
    </div>
  );
}
