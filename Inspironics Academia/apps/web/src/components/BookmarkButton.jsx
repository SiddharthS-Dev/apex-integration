import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bookmark, BookmarkCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import BookmarkNotePopover from '@/components/lesson/BookmarkNotePopover';

export default function BookmarkButton({ lessonId, courseId }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const key = ['bookmark', user?.id, lessonId];
  const { data: bookmark } = useQuery({
    queryKey: key,
    queryFn: async () => (await api.entities.Bookmark.filter({ user_id: user.id, lesson_id: lessonId }))[0] || null,
    enabled: !!user && !!lessonId,
  });

  const run = async (fn, message) => {
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['bookmarks'] });
      if (message) toast.success(message);
    } catch (e) {
      toast.error(e?.message || 'Bookmark update failed');
    } finally {
      setBusy(false);
    }
  };

  const create = (note) => api.entities.Bookmark.create({ user_id: user.id, lesson_id: lessonId, course_id: courseId, ...(note ? { note } : {}) });
  const toggle = () =>
    bookmark ? run(() => api.entities.Bookmark.delete(bookmark.id), 'Bookmark removed') : run(() => create(), 'Lesson bookmarked');
  const saveNote = (note) =>
    bookmark ? run(() => api.entities.Bookmark.update(bookmark.id, { note }), 'Note saved') : run(() => create(note), 'Bookmarked with note');

  return (
    <div className="flex items-center gap-1">
      <Button type="button" size="sm" variant={bookmark ? 'secondary' : 'outline'} onClick={toggle} disabled={busy || !user}>
        {bookmark ? <BookmarkCheck className="text-primary" /> : <Bookmark />}
        {bookmark ? 'Bookmarked' : 'Bookmark'}
      </Button>
      <BookmarkNotePopover note={bookmark?.note || ''} onSave={saveNote} saving={busy} />
    </div>
  );
}
