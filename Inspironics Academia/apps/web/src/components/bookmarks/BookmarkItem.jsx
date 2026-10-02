import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { Bookmark, PlayCircle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import BookmarkNote from '@/components/bookmarks/BookmarkNote';

export default function BookmarkItem({ bookmark, lesson, course, onSaveNote, onRemove, busy }) {
  const courseId = bookmark.course_id || course?.id;
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0">
          <Bookmark className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold leading-snug truncate">{lesson?.title || 'Lesson unavailable'}</h3>
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {course?.title || 'Course'}
            {bookmark.created_date ? ` · Saved ${formatDistanceToNow(new Date(bookmark.created_date), { addSuffix: true })}` : ''}
          </p>
        </div>
        <div className="flex gap-1 shrink-0">
          {lesson && courseId && (
            <Button asChild size="sm">
              <Link to={`/learn/${courseId}/${bookmark.lesson_id}`}><PlayCircle /> Open</Link>
            </Button>
          )}
          <Button size="icon" variant="ghost" onClick={onRemove} disabled={busy} aria-label="Remove bookmark">
            <Trash2 className="text-rose-600 dark:text-rose-400" />
          </Button>
        </div>
      </div>
      <BookmarkNote note={bookmark.note} onSave={onSaveNote} saving={busy} />
    </div>
  );
}
