import { Award, CheckCircle2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { formatDate } from '@/components/admin/adminFormat';
import { isCompleted } from '@/components/admin/learners/learnerData';

export default function LearnerDetailDialog({ row, courseMap, onClose }) {
  const user = row?.user;
  const certCourses = new Set((row?.certificates || []).map((c) => c.course_id));
  return (
    <Dialog open={!!row} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{user?.full_name || user?.email}</DialogTitle>
          <DialogDescription>
            {user?.email} · joined {formatDate(user?.created_date)} · avg quiz {row?.avgQuiz ?? '—'}{row?.avgQuiz != null ? '%' : ''}
          </DialogDescription>
        </DialogHeader>
        {row && row.progress.length === 0 && <p className="text-sm text-muted-foreground">This user has not started any courses.</p>}
        <ul className="space-y-4">
          {row?.progress.map((p) => (
            <li key={p.id} className="rounded-xl border border-border p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm truncate">{courseMap[p.course_id]?.title || 'Unknown course'}</span>
                <span className="text-sm text-muted-foreground shrink-0">{p.percentage || 0}%</span>
              </div>
              <Progress value={p.percentage || 0} className="h-1.5 my-2" />
              <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                <span>{p.completed_lessons?.length || 0} lessons done</span>
                <span>{p.completed_chapters?.length || 0} chapter tests passed</span>
                {p.final_score ? <span>Final: {p.final_score}%</span> : null}
                {isCompleted(p) && (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="w-3 h-3" /> Completed</span>
                )}
                {certCourses.has(p.course_id) && (
                  <span className="inline-flex items-center gap-1 text-violet-600 dark:text-violet-400"><Award className="w-3 h-3" /> Certified</span>
                )}
              </div>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
