import { Link } from 'react-router-dom';
import { BookOpen, Layers, GraduationCap } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import CourseBadges from '@/components/catalog/CourseBadges';

export default function CourseCard({ course, progress }) {
  const pct = progress?.percentage || 0;
  return (
    <Link
      to={`/courses/${course.id}`}
      className="group rounded-2xl border border-border bg-card p-5 flex flex-col gap-4 transition-shadow hover:shadow-lg hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0">
          <GraduationCap className="w-5 h-5" />
        </div>
        <CourseBadges course={course} className="justify-end" />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug group-hover:text-primary transition-colors">{course.title}</h3>
        {course.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-3">{course.description}</p>}
      </div>
      <div className="mt-auto space-y-3">
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1"><Layers className="w-3.5 h-3.5" />{course.module_count || 0} modules</span>
          <span className="inline-flex items-center gap-1"><BookOpen className="w-3.5 h-3.5" />{course.lesson_count || 0} lessons</span>
        </div>
        {progress && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{pct}%</span>
            </div>
            <Progress value={pct} />
          </div>
        )}
      </div>
    </Link>
  );
}
