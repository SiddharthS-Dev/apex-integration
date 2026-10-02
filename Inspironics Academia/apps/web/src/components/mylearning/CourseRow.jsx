import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { BookOpen, CheckCircle2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { DifficultyBadge } from '@/components/dashboard/CourseMiniCard';
import { continueHref, isCourseComplete } from '@/components/dashboard/useLearnerData';

export default function CourseRow({ course, progress, outline }) {
  const done = isCourseComplete(progress);
  const pct = progress?.final_passed ? 100 : progress?.percentage || 0;
  const updated = progress?.updated_date ? formatDistanceToNow(new Date(progress.updated_date), { addSuffix: true }) : '—';

  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col md:flex-row md:items-center gap-4">
      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0">
        {done ? <CheckCircle2 className="w-6 h-6" /> : <BookOpen className="w-6 h-6" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/courses/${course.id}`} className="font-semibold hover:text-primary truncate">{course.title}</Link>
          <DifficultyBadge difficulty={course.difficulty} />
        </div>
        <div className="flex items-center gap-3 mt-2">
          <Progress value={Math.min(100, pct)} className="max-w-xs" />
          <span className="text-sm font-medium tabular-nums">{Math.min(100, pct)}%</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1.5">
          {progress?.completed_lessons?.length || 0} lessons done · Updated {updated}
          {progress?.final_passed ? ` · Final passed (${progress.final_score || 0}%)` : ''}
        </p>
      </div>
      <Button asChild size="sm" variant={done ? 'outline' : 'default'}>
        <Link to={continueHref(course.id, outline, progress)}>
          <PlayCircle /> {done ? 'Review' : 'Continue'}
        </Link>
      </Button>
    </div>
  );
}
