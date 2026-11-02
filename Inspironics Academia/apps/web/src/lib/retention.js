import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { localDay } from '@/lib/progress';

// Learner-side hooks for spaced review, recertification and notifications. Server functions do the
// scheduling and bookkeeping; these only fetch and invalidate.

export const REVIEW_QUEUE_KEY = 'review-queue';

export function useReviewQueue({ enabled = true } = {}) {
  const { user } = useAuth();
  return useQuery({
    queryKey: [REVIEW_QUEUE_KEY, user?.id],
    enabled: !!user?.id && enabled,
    queryFn: async () => (await api.functions.invoke('getReviewQueue', { today: localDay() })).data,
    staleTime: 60_000,
  });
}

/** Rates one card. Returns the saved { schedule, log, intervals }. */
export async function submitReview(cardId, quality) {
  const { data } = await api.functions.invoke('submitFlashcardReview', { flashcard_id: cardId, quality, today: localDay() });
  return data;
}

/** Refreshes everything a review changes: the queue, schedules shown on the dashboard and lesson tabs. */
export function useInvalidateReviews() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: [REVIEW_QUEUE_KEY] });
    queryClient.invalidateQueries({ queryKey: ['review-schedules'] });
  };
}

export function useMyRecertifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['my-recertifications', user?.id],
    enabled: !!user?.id,
    queryFn: async () => (await api.functions.invoke('getMyRecertifications', { today: localDay() })).data || [],
  });
}

export function useNotifications() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    enabled: !!user?.id,
    queryFn: () => api.entities.Notification.filter({ user_id: user.id }, '-created_date', 50),
    refetchInterval: 60_000,
  });
}

const DAY_MS = 86_400_000;

/** "in 3 days", "tomorrow", "today", "2 days ago" for a YYYY-MM-DD relative to the learner's today. */
export function relativeDay(day, today = localDay()) {
  if (!day) return '';
  const diff = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / DAY_MS);
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  return diff > 0 ? `in ${diff} days` : `${-diff} days ago`;
}

/** Short interval label for a rating button: 1d, 6d, 3w, 4mo. */
export function intervalLabel(days) {
  if (days == null) return '';
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.round(days / 7)}w`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
}
