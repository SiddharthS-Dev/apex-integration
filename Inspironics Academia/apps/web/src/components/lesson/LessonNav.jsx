import { Link } from 'react-router-dom';
import { CheckCircle2, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function LessonNav({ courseId, prev, next, completed, busy, onComplete }) {
  const label = completed ? (next ? 'Next lesson' : 'Back to course') : next ? 'Mark complete & next' : 'Mark complete & finish';
  const Icon = completed ? ChevronRight : CheckCircle2;
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4">
      {prev ? (
        <Button asChild variant="outline">
          <Link to={`/learn/${courseId}/${prev.id}`}><ChevronLeft /><span className="hidden sm:inline">Previous</span></Link>
        </Button>
      ) : (
        <span />
      )}
      <Button onClick={onComplete} disabled={busy} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90">
        {busy ? <Loader2 className="animate-spin" /> : <Icon />}
        {label}
      </Button>
    </div>
  );
}
