import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import BookmarkItem from '@/components/bookmarks/BookmarkItem';
import { useMyBookmarks, usePublishedCourses } from '@/components/dashboard/useLearnerData';

export default function BookmarkList() {
  const qc = useQueryClient();
  const { data: bookmarks = [], isLoading } = useMyBookmarks();
  const { data: courses = [] } = usePublishedCourses();
  const lessonIds = [...new Set(bookmarks.map((b) => b.lesson_id).filter(Boolean))];
  const { data: lessons = [] } = useQuery({
    queryKey: ['bookmark-lessons', lessonIds.sort().join(',')],
    enabled: lessonIds.length > 0,
    queryFn: async () => (await api.entities.Lesson.filter({ id: { $in: lessonIds } }, 'order', 500)).filter((l) => l.status === 'approved'),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['bookmarks'] });
  const update = useMutation({
    mutationFn: ({ id, note }) => api.entities.Bookmark.update(id, { note }),
    onSuccess: () => { toast.success('Note saved'); refresh(); },
    onError: (e) => toast.error('Could not save note', { description: e?.message }),
  });
  const remove = useMutation({
    mutationFn: (id) => api.entities.Bookmark.delete(id),
    onSuccess: () => { toast.success('Bookmark removed'); refresh(); },
    onError: (e) => toast.error('Could not remove bookmark', { description: e?.message }),
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader icon={Bookmark} title="Bookmarks" description="Lessons you saved for later, with your notes." />
      {isLoading ? (
        <LoadingState label="Loading bookmarks…" />
      ) : bookmarks.length === 0 ? (
        <EmptyState
          icon={Bookmark}
          title="No bookmarks yet"
          description="Bookmark a lesson from the lesson player to find it here."
          action={<Button asChild size="sm"><Link to="/my-learning">Go to my learning</Link></Button>}
        />
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {bookmarks.map((b) => (
            <BookmarkItem
              key={b.id}
              bookmark={b}
              lesson={lessons.find((l) => l.id === b.lesson_id)}
              course={courses.find((c) => c.id === b.course_id)}
              busy={(update.isPending && update.variables?.id === b.id) || (remove.isPending && remove.variables === b.id)}
              onSaveNote={(note) => update.mutateAsync({ id: b.id, note })}
              onRemove={() => remove.mutate(b.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
