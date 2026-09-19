import { useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import ScrollRow from '@/components/ScrollRow';
import { TIME_RANGES, viewsInBreakdown } from '@/lib/analytics';
import { cn } from '@/lib/utils';

/**
 * "Most viewed" shelf with Today / This Week / This Month / All-Time tabs.
 * Time-scoped counts come from each PresentationAnalytics daily_breakdown;
 * the all-time tab falls back to the denormalised view_count.
 */
export default function MostViewedSection({
  presentations = [],
  analyticsById,
  decorate,
  onToggleFavorite,
  loading = false,
  limit = 12,
}) {
  const [range, setRange] = useState('week');
  const days = TIME_RANGES.find((r) => r.key === range)?.days ?? 7;

  const items = useMemo(() => {
    const scored = presentations.map((p) => {
      const record = analyticsById?.get(p.id);
      const count = days === 0
        ? record?.total_views ?? p.view_count ?? 0
        : viewsInBreakdown(record?.daily_breakdown, days);
      return { p, count };
    });

    const ranked = scored.filter((s) => s.count > 0).sort((a, b) => b.count - a.count);
    // Early in a range nobody has views yet — fall back to all-time so the shelf
    // is never empty on a fresh install.
    const source = ranked.length > 0 ? ranked : scored.sort((a, b) => (b.p.view_count || 0) - (a.p.view_count || 0));
    return source.slice(0, limit).map((s) => s.p);
  }, [presentations, analyticsById, days, limit]);

  return (
    <ScrollRow
      title="Most Viewed"
      icon={Star}
      items={items}
      decorate={decorate}
      onToggleFavorite={onToggleFavorite}
      loading={loading}
      emptyMessage="No view data yet."
    >
      <div className="inline-flex items-center gap-1 rounded-xl glass p-1">
        {TIME_RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRange(r.key)}
            className={cn(
              'rounded-lg px-3 py-1.5 text-xs font-medium transition-all',
              range === r.key
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {r.label}
          </button>
        ))}
      </div>
    </ScrollRow>
  );
}
