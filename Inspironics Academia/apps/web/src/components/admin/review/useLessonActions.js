import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { updateMany } from '@/lib/pipeline';

// Per-lesson generation and review decisions. `pending` names the running action.
export default function useLessonActions(lesson, questions = [], flashcards = []) {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['studio'] });

  const run = async (key, fn, success) => {
    setPending(key);
    try {
      const res = await fn();
      if (res?.data && res.data.ok === false) throw new Error(res.data.error || 'Failed');
      toast.success(success);
    } catch (err) {
      toast.error(err?.response?.data?.error || err?.message || 'Action failed');
    } finally {
      setPending(null);
      refresh();
    }
  };

  const invoke = (name, extra = {}) => {
    refresh();
    return api.functions.invoke(name, { lesson_id: lesson.id, ...extra });
  };

  return {
    pending,
    generateContent: () => run('content', () => invoke('generateLessonContent'), 'Lesson content generated'),
    generateMedia: () => run('media', () => invoke('generateLessonMedia'), 'Lesson media generated'),
    // Slides and subtitles only, over the narration already recorded — no new audio, no media credits.
    rebuildSlides: () => run('media', () => invoke('generateLessonMedia', { slides_only: true }), 'Slides and subtitles rebuilt'),
    approve: () => run('approve', async () => {
      await api.entities.Lesson.update(lesson.id, { status: 'approved' });
      await updateMany('Question', questions.filter((q) => q.status !== 'approved'), { status: 'approved' });
      await updateMany('Flashcard', flashcards.filter((f) => f.status !== 'approved'), { status: 'approved' });
    }, 'Lesson approved'),
    reject: () => run('reject', () => api.entities.Lesson.update(lesson.id, { status: 'rejected' }), 'Lesson rejected'),
  };
}
