import { useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { sm2 } from '@/lib/progress';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import FlashcardDeck from '@/components/lesson/FlashcardDeck';

const today = () => new Date().toISOString().slice(0, 10);

export default function FlashcardsTab({ lesson, courseId }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const cardsQ = useQuery({
    queryKey: ['lesson-flashcards', lesson.id],
    queryFn: async () => (await api.entities.Flashcard.filter({ lesson_id: lesson.id }, 'created_date', 100)).filter((c) => c.status === 'approved'),
  });
  const schedQ = useQuery({
    queryKey: ['review-schedules', user?.id, lesson.id],
    queryFn: () => api.entities.ReviewSchedule.filter({ user_id: user.id, lesson_id: lesson.id }, '-updated_date', 200),
    enabled: !!user,
  });
  const schedules = useRef({});
  (schedQ.data || []).forEach((s) => { schedules.current[s.flashcard_id] ||= s; });

  // Deck order is fixed once loaded: cards due today (or never reviewed) first.
  const { deck, dueIds } = useMemo(() => {
    if (!cardsQ.data || !schedQ.data) return { deck: [], dueIds: new Set() };
    const byCard = Object.fromEntries(schedQ.data.map((s) => [s.flashcard_id, s]));
    const isDue = (c) => !byCard[c.id] || (byCard[c.id].due_date || '') <= today();
    const due = cardsQ.data.filter(isDue);
    return { deck: [...due, ...cardsQ.data.filter((c) => !isDue(c))], dueIds: new Set(due.map((c) => c.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsQ.data, schedQ.isSuccess]);

  const onRate = async (card, quality) => {
    try {
      const existing = schedules.current[card.id];
      const next = sm2(existing, quality);
      schedules.current[card.id] = existing?.id
        ? await api.entities.ReviewSchedule.update(existing.id, next)
        : await api.entities.ReviewSchedule.create({ user_id: user.id, flashcard_id: card.id, lesson_id: lesson.id, course_id: courseId, ...next });
      queryClient.invalidateQueries({ queryKey: ['review-schedules', user.id, 'all'] });
    } catch (e) {
      toast.error(e?.message || 'Could not save review');
    }
  };

  if (cardsQ.isLoading || schedQ.isLoading) return <LoadingState label="Loading flashcards…" />;
  if (!deck.length) return <EmptyState icon={Layers} title="No flashcards yet" description="Flashcards for this lesson haven't been published." />;
  return <FlashcardDeck deck={deck} dueIds={dueIds} onRate={onRate} />;
}
