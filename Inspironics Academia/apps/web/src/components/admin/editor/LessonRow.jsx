import { Draggable } from '@hello-pangea/dnd';
import { GripVertical, Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import StatusBadge from '@/components/admin/StatusBadge';
import EditableText from '@/components/admin/editor/EditableText';
import ConfirmDeleteButton from '@/components/admin/editor/ConfirmDeleteButton';
import DisabledReason from '@/components/DisabledReason';
import useAppConfig, { AI_DISABLED_REASON } from '@/lib/useAppConfig';

export default function LessonRow({ lesson, index, actions }) {
  const generating = actions.generatingId === lesson.id || lesson.status === 'generating';
  const hasContent = !!lesson.teaching_script;
  const { ai_enabled: ai } = useAppConfig();
  return (
    <Draggable draggableId={lesson.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          className={cn(
            'flex items-center gap-2 rounded-xl border border-border bg-background px-2 py-1.5',
            snapshot.isDragging && 'shadow-md ring-2 ring-primary/30',
          )}
        >
          <div {...provided.dragHandleProps} className="text-muted-foreground hover:text-foreground cursor-grab" aria-label="Drag lesson">
            <GripVertical className="w-4 h-4" />
          </div>
          <span className="text-xs text-muted-foreground w-5 text-right">{index + 1}.</span>
          <EditableText
            value={lesson.title}
            onSave={(title) => actions.saveLesson.mutate({ id: lesson.id, patch: { title } })}
            placeholder="Lesson title"
            className="h-8 text-sm flex-1"
          />
          <StatusBadge status={lesson.status || 'pending'} />
          <DisabledReason reason={ai ? null : AI_DISABLED_REASON}>
            <Button size="sm" variant="outline" disabled={!ai || generating || actions.generate.isPending} onClick={() => actions.generate.mutate(lesson)}>
              {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
              <span className="hidden sm:inline">{hasContent ? 'Regenerate' : 'Generate content'}</span>
            </Button>
          </DisabledReason>
          <ConfirmDeleteButton
            title="Delete lesson?"
            description={`"${lesson.title}" and its generated content will be removed.`}
            disabled={actions.deleteLesson.isPending}
            onConfirm={() => actions.deleteLesson.mutate(lesson)}
          />
        </div>
      )}
    </Draggable>
  );
}
