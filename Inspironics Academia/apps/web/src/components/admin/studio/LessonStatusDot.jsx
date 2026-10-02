import { cn } from '@/lib/utils';

export const LESSON_DOT_CLASSES = {
  approved: 'bg-emerald-500',
  pending_review: 'bg-amber-500',
  generating: 'bg-blue-500 animate-pulse',
  pending: 'bg-slate-400',
  rejected: 'bg-rose-500',
};

export default function LessonStatusDot({ status, className }) {
  return (
    <span
      title={status?.replace(/_/g, ' ')}
      className={cn('inline-block w-2 h-2 rounded-full shrink-0', LESSON_DOT_CLASSES[status] || 'bg-slate-400', className)}
    />
  );
}
