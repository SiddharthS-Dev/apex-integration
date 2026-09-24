import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  PlayCircle, History, Flame, Star, Heart, BookMarked, Download, TrendingUp, Clock, CheckCircle2, Gauge,
} from 'lucide-react';
import ScrollRow from '@/components/ScrollRow';
import PresentationCard from '@/components/PresentationCard';
import { useAuth } from '@/lib/AuthContext';
import { useLibraryData, SORTERS } from '@/lib/useLibraryData';
import { formatReadingTime } from '@/lib/analytics';
import { DOMAINS, HERO_GRADIENT } from '@/lib/domains';
import { cn, initials, timeAgo } from '@/lib/utils';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function StatTile({ icon: Icon, label, value, tint }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl glass p-4">
      <span className={cn('grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', tint)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const { presentations, activity, activityById, offlineSet, loading, decorate, onToggleFavorite } =
    useLibraryData();

  const byId = useMemo(() => {
    const map = new Map();
    presentations.forEach((p) => map.set(p.id, p));
    return map;
  }, [presentations]);

  const resolve = (rows) => rows.map((a) => byId.get(a.id)).filter(Boolean);

  const started = useMemo(() => activity.filter((a) => (a.progress || 0) > 0), [activity]);
  const completed = useMemo(() => activity.filter((a) => (a.progress || 0) >= 98), [activity]);
  const avgProgress = useMemo(
    () => (started.length ? Math.round(started.reduce((s, a) => s + (a.progress || 0), 0) / started.length) : 0),
    [started]
  );

  const continueReading = useMemo(
    () =>
      resolve(
        activity
          .filter((a) => (a.progress || 0) > 0 && (a.progress || 0) < 98)
          .sort((a, b) => new Date(b.last_viewed || 0) - new Date(a.last_viewed || 0))
      ),
    [activity, byId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const recentlyViewed = useMemo(
    () =>
      resolve(
        activity
          .filter((a) => a.last_viewed)
          .sort((a, b) => new Date(b.last_viewed) - new Date(a.last_viewed))
          .slice(0, 16)
      ),
    [activity, byId] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const favorites = useMemo(() => resolve(activity.filter((a) => a.favorite)), [activity, byId]); // eslint-disable-line react-hooks/exhaustive-deps
  const offline = useMemo(() => presentations.filter((p) => offlineSet.has(p.id)), [presentations, offlineSet]);
  const trending = useMemo(() => [...presentations].sort(SORTERS.trending).slice(0, 14), [presentations]);
  const mostViewed = useMemo(() => [...presentations].sort(SORTERS.views).slice(0, 14), [presentations]);

  /* Recommendations: more from whichever domain this reader opens most. */
  const topDomain = useMemo(() => {
    const counts = new Map();
    activity.forEach((a) => {
      const p = byId.get(a.id);
      if (!p?.primary_domain) return;
      counts.set(p.primary_domain, (counts.get(p.primary_domain) || 0) + 1 + (a.views || 0));
    });
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
  }, [activity, byId]);

  const recommended = useMemo(() => {
    const seen = new Set(activity.map((a) => a.id));
    const pool = topDomain
      ? presentations.filter((p) => p.primary_domain === topDomain && !seen.has(p.id))
      : [...presentations].sort(SORTERS.trending);
    return pool.slice(0, 14);
  }, [presentations, topDomain, activity]);

  const domainBars = useMemo(() => {
    const counts = new Map();
    activity.forEach((a) => {
      const p = byId.get(a.id);
      if (!p?.primary_domain) return;
      counts.set(p.primary_domain, (counts.get(p.primary_domain) || 0) + Math.max(1, a.views || 1));
    });
    const rows = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const max = rows[0]?.[1] || 1;
    return rows.map(([name, count]) => ({ name, count, pct: Math.round((count / max) * 100) }));
  }, [activity, byId]);

  const history = useMemo(
    () =>
      activity
        .filter((a) => a.last_viewed && byId.has(a.id))
        .sort((a, b) => new Date(b.last_viewed) - new Date(a.last_viewed))
        .slice(0, 12),
    [activity, byId]
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-10 px-4 py-6 sm:px-6 sm:py-8">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-3xl">
        <div className={cn('absolute inset-0 opacity-90', HERO_GRADIENT)} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_20%_0%,rgba(255,255,255,0.25),transparent)]" />
        <div className="absolute -bottom-24 -right-16 h-64 w-64 rounded-full bg-fuchsia-400/40 blur-3xl" />
        <div className="relative flex items-center gap-4 px-6 py-9 sm:px-10">
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-white/15 text-lg font-bold text-white ring-1 ring-inset ring-white/25 backdrop-blur">
            {initials(user?.full_name || user?.email || '')}
          </span>
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wider text-white/70">{greeting()}</p>
            <h1 className="truncate text-2xl font-bold tracking-tight text-white sm:text-3xl">
              {user?.full_name || user?.email}
            </h1>
            <p className="mt-1 text-sm text-white/80">
              {started.length > 0
                ? `You have ${continueReading.length} presentation${continueReading.length === 1 ? '' : 's'} in progress.`
                : 'Pick a presentation to start reading — your progress is saved on this device.'}
            </p>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile icon={BookMarked} label="Started" value={started.length} tint="from-indigo-500 to-violet-500" />
        <StatTile icon={CheckCircle2} label="Completed" value={completed.length} tint="from-emerald-500 to-teal-500" />
        <StatTile icon={Gauge} label="Avg Progress" value={`${avgProgress}%`} tint="from-amber-500 to-orange-500" />
        <StatTile icon={Download} label="Available Offline" value={offlineSet.size} tint="from-fuchsia-500 to-pink-500" />
      </section>

      {continueReading.length > 0 && (
        <ScrollRow title="Continue Reading" icon={PlayCircle} items={continueReading} decorate={decorate} onToggleFavorite={onToggleFavorite} />
      )}
      {recentlyViewed.length > 0 && (
        <ScrollRow title="Recently Viewed" icon={History} items={recentlyViewed} decorate={decorate} onToggleFavorite={onToggleFavorite} />
      )}
      <ScrollRow title="🔥 Trending" icon={Flame} items={trending} decorate={decorate} onToggleFavorite={onToggleFavorite} loading={loading} />
      <ScrollRow title="⭐ Most Viewed" icon={Star} items={mostViewed} decorate={decorate} onToggleFavorite={onToggleFavorite} loading={loading} />
      {favorites.length > 0 && (
        <ScrollRow title="❤️ Favorites" icon={Heart} items={favorites} decorate={decorate} onToggleFavorite={onToggleFavorite} />
      )}
      <ScrollRow
        title={topDomain ? `📚 Recommended in ${topDomain}` : '📚 Recommended for You'}
        icon={TrendingUp}
        items={recommended}
        decorate={decorate}
        onToggleFavorite={onToggleFavorite}
        loading={loading}
      />
      {offline.length > 0 && (
        <ScrollRow
          title="📥 Offline Library"
          icon={Download}
          items={offline}
          decorate={decorate}
          onToggleFavorite={onToggleFavorite}
          seeAllTo="/offline"
        />
      )}

      {/* -------------------------------------------- categories + history */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Most Viewed Categories</h2>
          <div className="space-y-3 rounded-2xl glass p-4">
            {domainBars.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                Read a few presentations and your category mix will show up here.
              </p>
            ) : (
              domainBars.map(({ name, count, pct }) => (
                <div key={name} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{name}</span>
                    <span className="text-muted-foreground">{count}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${pct}%` }}
                      transition={{ duration: 0.6 }}
                      className={cn('h-full rounded-full bg-gradient-to-r', (DOMAINS[name] || {}).gradient || 'from-slate-500 to-slate-600')}
                    />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="space-y-3">
          <h2 className="text-lg font-semibold tracking-tight">Reading History</h2>
          <div className="rounded-2xl glass p-2">
            {history.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Nothing read yet.</p>
            ) : (
              <div className="divide-y divide-border">
                {history.map((a) => {
                  const p = byId.get(a.id);
                  return (
                    <div key={a.id} className="flex items-center gap-2 py-1">
                      <div className="min-w-0 flex-1">
                        <PresentationCard presentation={p} variant="compact" isOffline={offlineSet.has(p.id)} />
                      </div>
                      <div className="shrink-0 pr-2 text-right">
                        <p className="text-xs font-medium">{a.progress || 0}%</p>
                        <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
                          <Clock className="h-2.5 w-2.5" />
                          {a.reading_time ? formatReadingTime(a.reading_time) : timeAgo(a.last_viewed)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Link to="/library" className="inline-block text-xs text-primary hover:underline">
            Browse the full library →
          </Link>
        </div>
      </section>
    </div>
  );
}
