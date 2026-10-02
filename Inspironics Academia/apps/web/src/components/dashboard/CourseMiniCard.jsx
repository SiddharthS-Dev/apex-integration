import { Link } from 'react-router-dom';
import { ArrowRight, BookOpen, Layers } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

const DIFFICULTY_CLASSES = {
  beginner: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  intermediate: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  advanced: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
};

export function DifficultyBadge({ difficulty = 'beginner' }) {
  return (
    <Badge variant="outline" className={`border-transparent capitalize ${DIFFICULTY_CLASSES[difficulty] || DIFFICULTY_CLASSES.beginner}`}>
      {difficulty}
    </Badge>
  );
}

export default function CourseMiniCard({ course }) {
  return (
    <Link
      to={`/courses/${course.id}`}
      className="group rounded-2xl border border-border bg-card p-5 flex flex-col gap-3 hover:border-primary/40 hover:shadow-sm transition"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0">
          <BookOpen className="w-5 h-5" />
        </div>
        <DifficultyBadge difficulty={course.difficulty} />
      </div>
      <div className="min-w-0">
        <h3 className="font-semibold leading-snug line-clamp-2 group-hover:text-primary">{course.title}</h3>
        {course.description && <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{course.description}</p>}
      </div>
      <div className="mt-auto flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Layers className="w-3.5 h-3.5" /> {course.module_count || 0} modules · {course.lesson_count || 0} lessons
        </span>
        <ArrowRight className="w-4 h-4 text-primary opacity-0 group-hover:opacity-100 transition" />
      </div>
    </Link>
  );
}
