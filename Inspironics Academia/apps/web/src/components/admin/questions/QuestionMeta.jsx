import { cn } from '@/lib/utils';
import StatusBadge from '@/components/admin/StatusBadge';
import { COGNITIVE_COLORS, DIFFICULTY_COLORS, PILL } from '@/components/admin/adminFormat';

// Badge row: status, difficulty, cognitive level, marks, and where the question lives.
export default function QuestionMeta({ question, context }) {
  const difficulty = question.difficulty || 'basic';
  const cognitive = question.cognitive_level || 'recall';
  const where = context?.assessment
    ? `Assessment: ${context.assessment.title}`
    : context?.lesson
      ? `Lesson: ${context.lesson.title}`
      : null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <StatusBadge status={question.status || 'pending_review'} />
      <span className={cn(PILL, DIFFICULTY_COLORS[difficulty])}>{difficulty}</span>
      <span className={cn(PILL, COGNITIVE_COLORS[cognitive])}>{cognitive}</span>
      <span className={cn(PILL, 'bg-muted text-muted-foreground')}>{question.marks ?? 1} mark{(question.marks ?? 1) === 1 ? '' : 's'}</span>
      {(context?.course || where) && (
        <span className="text-xs text-muted-foreground truncate max-w-full">
          {context?.course?.title}
          {context?.course && where ? ' · ' : ''}
          {where}
        </span>
      )}
    </div>
  );
}
