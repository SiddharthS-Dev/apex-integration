import { Link } from 'react-router-dom';
import { Award, GraduationCap, Trophy } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function FinalTestCard({ courseId, progress }) {
  const best = progress?.final_score || 0;
  const passed = !!progress?.final_passed;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center">
          <GraduationCap className="w-5 h-5" />
        </div>
        <div>
          <h3 className="font-semibold">Final test</h3>
          <p className="text-xs text-muted-foreground">Pass to earn your certificate</p>
        </div>
      </div>
      <div className="flex items-center justify-between rounded-xl bg-muted/60 px-3 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2 text-muted-foreground"><Trophy className="w-4 h-4" />Best score</span>
        <span className="font-semibold">{best ? `${best}%` : '—'}</span>
      </div>
      {passed && (
        <div className="rounded-xl bg-emerald-50 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300 px-3 py-2 text-sm font-medium">
          You passed the final test!
        </div>
      )}
      <div className="flex flex-col gap-2">
        <Button asChild variant={passed ? 'outline' : 'default'}>
          <Link to={`/test/final/${courseId}`}>{passed ? 'Retake final test' : 'Take final test'}</Link>
        </Button>
        {passed && (
          <Button asChild className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90">
            <Link to={`/certificate/${courseId}`}><Award />View certificate</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
