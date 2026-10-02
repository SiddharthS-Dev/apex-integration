import { GripVertical } from 'lucide-react';
import EditableText from '@/components/admin/editor/EditableText';
import ConfirmDeleteButton from '@/components/admin/editor/ConfirmDeleteButton';

export default function ModuleHeader({ module, index, lessons, actions, dragHandleProps }) {
  const save = (patch) => actions.saveModule.mutate({ id: module.id, patch });
  return (
    <div className="flex items-start gap-2 mb-3">
      <div {...dragHandleProps} className="mt-2 text-muted-foreground hover:text-foreground cursor-grab" aria-label="Drag module">
        <GripVertical className="w-4 h-4" />
      </div>
      <div className="w-8 h-8 mt-0.5 rounded-xl bg-primary/10 text-primary flex items-center justify-center text-sm font-semibold shrink-0">
        {index + 1}
      </div>
      <div className="flex-1 min-w-0 space-y-1">
        <EditableText value={module.title} onSave={(title) => save({ title })} placeholder="Module title" className="font-semibold" />
        <EditableText
          value={module.description}
          onSave={(description) => save({ description })}
          placeholder="Module description"
          multiline
          className="text-sm text-muted-foreground min-h-0"
        />
        {module.source_chapters && (
          <p className="px-2 text-xs text-muted-foreground">Source: {module.source_chapters}</p>
        )}
      </div>
      <span className="mt-2 text-xs text-muted-foreground whitespace-nowrap">{lessons.length} lessons</span>
      <ConfirmDeleteButton
        title="Delete module?"
        description={`This deletes "${module.title}" and its ${lessons.length} lesson(s). This cannot be undone.`}
        disabled={actions.deleteModule.isPending}
        onConfirm={() => actions.deleteModule.mutate({ module, lessons })}
      />
    </div>
  );
}
