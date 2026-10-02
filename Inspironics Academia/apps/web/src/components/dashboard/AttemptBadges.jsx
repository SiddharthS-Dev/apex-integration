import { Badge } from '@/components/ui/badge';

const TYPE_CLASSES = {
  lesson: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300',
  chapter: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  final: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300',
};

const TYPE_LABELS = { lesson: 'Lesson quiz', chapter: 'Chapter test', final: 'Final test' };

export function AttemptTypeBadge({ type = 'lesson' }) {
  return (
    <Badge variant="outline" className={`border-transparent ${TYPE_CLASSES[type] || TYPE_CLASSES.lesson}`}>
      {TYPE_LABELS[type] || type}
    </Badge>
  );
}

export function PassBadge({ passed }) {
  return passed ? (
    <Badge variant="outline" className="border-transparent bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">Passed</Badge>
  ) : (
    <Badge variant="outline" className="border-transparent bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">Not passed</Badge>
  );
}

export default AttemptTypeBadge;
