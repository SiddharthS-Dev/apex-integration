import { useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { previewIntervals } from '@academy/shared';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { localDay } from '@/lib/progress';
import { submitReview, useInvalidateReviews } from '@/lib/retention';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import FlashcardDeck from '@/components/lesson/FlashcardDeck';

export default function FlashcardsTab({ lesson }) {
  const { user } = useAuth();
  const invalidate = useInvalidateReviews();
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
    const isDue = (c) => !byCard[c.id] || (byCard[c.id].due_date || '') <= localDay();
    const due = cardsQ.data.filter(isDue);
    return { deck: [...due, ...cardsQ.data.filter((c) => !isDue(c))], dueIds: new Set(due.map((c) => c.id)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardsQ.data, schedQ.isSuccess]);

  // The server schedules the card (SM-2) and logs the review, which feeds retention and streaks.
  const onRate = async (card, quality) => {
    try {
      schedules.current[card.id] = (await submitReview(card.id, quality)).schedule;
      invalidate();
    } catch (e) {
      toast.error(e?.message || 'Could not save review');
    }
  };

  if (cardsQ.isLoading || schedQ.isLoading) return <LoadingState label="Loading flashcards…" />;
  if (!deck.length) return <EmptyState icon={Layers} title="No flashcards yet" description="Flashcards for this lesson haven't been published." />;
  return <FlashcardDeck deck={deck} dueIds={dueIds} onRate={onRate} intervalsFor={(card) => previewIntervals(schedules.current[card.id])} />;
}
