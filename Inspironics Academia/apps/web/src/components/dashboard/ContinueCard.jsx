import { Link } from 'react-router-dom';
import { Award, BookOpen, Clock, ClipboardCheck, MoreVertical, Play, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import CourseBadges from '@/components/catalog/CourseBadges';
import CourseArt from '@/components/dashboard/CourseArt';
import { ProgressBar } from '@/components/dashboard/DashParts';
import { estimateMinutes, formatMinutes } from '@/components/dashboard/dashboardData';
import { nextLesson } from '@/lib/progress';
import { continueHref } from '@/components/dashboard/useLearnerData';

export default function ContinueCard({ course, progress, outline }) {
  const lessons = outline?.lessons || [];
  const lesson = nextLesson(lessons, progress);
  const pct = progress?.percentage || 0;
  const total = outline?.lessons?.length ?? course.lesson_count ?? 0;
  const remaining = formatMinutes(estimateMinutes(lessons, progress?.completed_lessons));
  const resumeTo = continueHref(course.id, outline, progress);

  return (
    <article className="group dash-panel dash-hover overflow-hidden flex flex-col min-w-0">
      <div className="relative">
        <Link to={`/courses/${course.id}`} tabIndex={-1} aria-hidden="true">
          <CourseArt course={course} className="h-28" />
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label={`More options for ${course.title}`}
              className="absolute top-2 right-2 w-7 h-7 rounded-lg bg-black/30 text-white backdrop-blur flex items-center justify-center hover:bg-black/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
            >
              <MoreVertical className="w-4 h-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem asChild><Link to={resumeTo}><PlayCircle /> Resume lesson</Link></DropdownMenuItem>
            <DropdownMenuItem asChild><Link to={`/courses/${course.id}`}><BookOpen /> Course overview</Link></DropdownMenuItem>
            {progress?.final_passed ? (
              <DropdownMenuItem asChild><Link to={`/certificate/${course.id}`}><Award /> View certificate</Link></DropdownMenuItem>
            ) : pct >= 100 && (
              <DropdownMenuItem asChild><Link to={`/test/final/${course.id}`}><ClipboardCheck /> Take final test</Link></DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="p-4 flex flex-col gap-3 flex-1">
        <div className="min-w-0">
          <CourseBadges course={course} className="gap-1.5 mb-2" />
          <Link to={`/courses/${course.id}`} className="block font-semibold text-sm leading-snug line-clamp-2 hover:text-primary transition-colors">
            {course.title}
          </Link>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-1" title={lesson?.title}>
            {lesson ? `Next: ${lesson.title}` : course.description || 'Open the course to continue'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ProgressBar value={pct} tone="cyan" />
          <span className="text-xs font-semibold tabular-nums">{pct}%</span>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{progress?.completed_lessons?.length || 0}/{total} lessons</span>
          {remaining && <span className="inline-flex items-center gap-1" title="Estimated time left"><Clock className="w-3.5 h-3.5" />{remaining} left</span>}
        </div>
        <Button asChild size="sm" className="mt-auto w-full group/btn transition-transform active:scale-[0.98]">
          <Link to={resumeTo}><Play className="fill-current transition-transform group-hover/btn:scale-110" /> Resume</Link>
        </Button>
      </div>
    </article>
  );
}
