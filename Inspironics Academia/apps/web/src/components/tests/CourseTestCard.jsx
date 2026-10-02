import { Link } from 'react-router-dom';
import { Award, CheckCircle2, ClipboardCheck, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';

function ChapterTestRow({ module, passed }) {
  return (
    <li className="flex items-center gap-3 py-2.5">
      {passed
        ? <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
        : <Circle className="w-4 h-4 text-muted-foreground shrink-0" />}
      <span className="flex-1 min-w-0 text-sm truncate">{module.title}</span>
      <Button asChild size="sm" variant={passed ? 'ghost' : 'outline'}>
        <Link to={`/test/chapter/${module.id}`}>{passed ? 'Retake' : 'Take test'}</Link>
      </Button>
    </li>
  );
}

export default function CourseTestCard({ course, progress, modules = [], bestFinal }) {
  const passedIds = new Set(progress?.completed_chapters || []);
  const best = Math.max(bestFinal ?? 0, progress?.final_score ?? 0);
  const hasFinal = bestFinal != null || !!progress?.final_score;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to={`/courses/${course.id}`} className="font-semibold hover:text-primary">{course.title}</Link>
          <p className="text-xs text-muted-foreground mt-0.5">
            {passedIds.size} of {modules.length} chapter tests passed
          </p>
        </div>
        <ClipboardCheck className="w-5 h-5 text-primary shrink-0" />
      </div>
      {modules.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {modules.map((m) => <ChapterTestRow key={m.id} module={m} passed={passedIds.has(m.id)} />)}
        </ul>
      )}
      <div className="mt-4 rounded-xl bg-primary/5 border border-primary/15 p-3 flex items-center gap-3">
        <Award className="w-5 h-5 text-primary shrink-0" />
        <div className="flex-1 min-w-0 text-sm">
          <div className="font-medium">Final test</div>
          <div className="text-xs text-muted-foreground">
            {progress?.final_passed ? `Passed · best ${best}%` : hasFinal ? `Best score ${best}%` : 'Not attempted yet'}
          </div>
        </div>
        <Button asChild size="sm">
          <Link to={`/test/final/${course.id}`}>{hasFinal ? 'Retake' : 'Start'}</Link>
        </Button>
      </div>
    </div>
  );
}
