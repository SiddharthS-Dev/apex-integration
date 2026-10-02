import { Link } from 'react-router-dom';
import { ArrowLeft, BookOpen, Layers, Loader2, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import CourseBadges from '@/components/catalog/CourseBadges';

export default function CourseHero({ course, moduleCount, lessonCount, progress, onStart, starting, canStart }) {
  const pct = progress?.percentage || 0;
  const label = progress?.started || pct > 0 ? 'Continue learning' : 'Start course';
  return (
    <section className="rounded-2xl border border-border bg-card p-6 sm:p-8 mb-8 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r from-indigo-500 to-violet-600" />
      <Link to="/courses" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-4">
        <ArrowLeft className="w-4 h-4" /> All courses
      </Link>
      <CourseBadges course={course} className="mb-3" />
      <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{course.title}</h1>
      {course.description && <p className="text-muted-foreground mt-2 max-w-3xl">{course.description}</p>}
      <div className="flex flex-wrap items-center gap-5 text-sm text-muted-foreground mt-4">
        <span className="inline-flex items-center gap-1.5"><Layers className="w-4 h-4" />{moduleCount} modules</span>
        <span className="inline-flex items-center gap-1.5"><BookOpen className="w-4 h-4" />{lessonCount} lessons</span>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center gap-4 mt-6">
        <div className="flex-1 max-w-md space-y-1">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">Your progress</span>
            <span className="font-medium">{pct}%</span>
          </div>
          <Progress value={pct} />
        </div>
        <Button size="lg" onClick={onStart} disabled={!canStart || starting} className="bg-gradient-to-r from-indigo-500 to-violet-600 text-white hover:opacity-90">
          {starting ? <Loader2 className="animate-spin" /> : <PlayCircle />}
          {label}
        </Button>
      </div>
    </section>
  );
}
