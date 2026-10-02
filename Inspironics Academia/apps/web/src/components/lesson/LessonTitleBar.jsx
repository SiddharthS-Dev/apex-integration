import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, Eye } from 'lucide-react';
import BookmarkButton from '@/components/BookmarkButton';
import VideoTypeBadge from '@/components/course/VideoTypeBadge';

export default function LessonTitleBar({ lesson, course, previewStatus }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="min-w-0">
        <Link to={`/courses/${course.id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
          <ArrowLeft className="w-4 h-4" /> {course.title}
        </Link>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight">{lesson.title}</h1>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <VideoTypeBadge type={lesson.video_type} />
          {lesson.duration_target && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />{lesson.duration_target}
            </span>
          )}
          {previewStatus && (
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 px-2 py-0.5 text-xs font-medium">
              <Eye className="w-3 h-3" /> Preview: {previewStatus.replace(/_/g, ' ')}
            </span>
          )}
        </div>
      </div>
      <BookmarkButton lessonId={lesson.id} courseId={course.id} />
    </div>
  );
}
