import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, Clock } from 'lucide-react';
import VideoTypeBadge from '@/components/course/VideoTypeBadge';

export default function ModuleLessonRow({ lesson, courseId, completed, index }) {
  return (
    <Link
      to={`/learn/${courseId}/${lesson.id}`}
      className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors"
    >
      {completed ? (
        <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
      ) : (
        <Circle className="w-5 h-5 text-muted-foreground/50 shrink-0" />
      )}
      <span className="text-xs text-muted-foreground w-5 shrink-0">{index + 1}.</span>
      <span className="flex-1 min-w-0 truncate font-medium">{lesson.title}</span>
      <VideoTypeBadge type={lesson.video_type} className="hidden sm:inline-flex" />
      {lesson.duration_target && (
        <span className="hidden md:inline-flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
          <Clock className="w-3.5 h-3.5" />
          {lesson.duration_target}
        </span>
      )}
    </Link>
  );
}
