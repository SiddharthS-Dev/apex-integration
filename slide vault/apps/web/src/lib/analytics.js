import { trackView as trackViewFn, recordLogin as recordLoginFn } from '@/api/functions';

/** Records a view event. Failures are swallowed — analytics never block reading. */
export async function trackView(presentationId, { source = 'online', readingTimeSecs = 0, completionPct = 0 } = {}) {
  if (!presentationId) return null;
  try {
    const { data } = await trackViewFn({
      presentation_id: presentationId,
      source,
      reading_time_secs: Math.round(readingTimeSecs),
      completion_pct: Math.round(completionPct),
    });
    return data;
  } catch (err) {
    console.warn('[analytics] trackView failed', err);
    return null;
  }
}

export async function recordLogin() {
  try {
    const { data } = await recordLoginFn({});
    return data;
  } catch (err) {
    console.warn('[analytics] recordLogin failed', err);
    return null;
  }
}

export function formatReadingTime(secs = 0) {
  const total = Math.max(0, Math.round(secs));
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${s}s`;
}

/** Sums a PresentationAnalytics daily_breakdown over the last N days. */
export function viewsInBreakdown(breakdown = [], days = 7) {
  if (!Array.isArray(breakdown)) return 0;
  if (!days) return breakdown.reduce((sum, d) => sum + (d.count || 0), 0);
  const cutoff = Date.now() - days * 86400000;
  return breakdown.reduce((sum, d) => {
    const t = new Date(d.date).getTime();
    return Number.isNaN(t) || t < cutoff ? sum : sum + (d.count || 0);
  }, 0);
}

export const TIME_RANGES = [
  { key: 'today', label: 'Today', days: 1 },
  { key: 'week', label: 'This Week', days: 7 },
  { key: 'month', label: 'This Month', days: 30 },
  { key: 'all', label: 'All-Time', days: 0 },
];
