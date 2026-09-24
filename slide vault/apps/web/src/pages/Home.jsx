import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Library as LibraryIcon, Download, Eye, Layers, PlayCircle, History, Flame, Sparkles, Tag, ArrowRight,
} from 'lucide-react';
import SearchBar from '@/components/SearchBar';
import ScrollRow from '@/components/ScrollRow';
import MostViewedSection from '@/components/MostViewedSection';
import { useLibraryData, SORTERS, topTags } from '@/lib/useLibraryData';
import { DOMAINS, DOMAIN_NAMES, HERO_GRADIENT } from '@/lib/domains';
import { cn } from '@/lib/utils';

function StatCard({ icon: Icon, label, value, tint }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl glass p-4"
    >
      <span className={cn('grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-white', tint)}>
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0">
        <span className="block text-xl font-bold leading-tight">{value}</span>
        <span className="block truncate text-xs text-muted-foreground">{label}</span>
      </span>
    </motion.div>
  );
}

export default function Home() {
  const {
    presentations, analyticsById, activity, activityById, offlineSet,
    loading, decorate, onToggleFavorite,
  } = useLibraryData({ withAnalytics: true });

  const byId = useMemo(() => {
    const map = new Map();
    presentations.forEach((p) => map.set(p.id, p));
    return map;
  }, [presentations]);

  const continueReading = useMemo(
    () =>
      activity
        .filter((a) => (a.progress || 0) > 0 && (a.progress || 0) < 98 && byId.has(a.id))
        .sort((a, b) => new Date(b.last_viewed || 0) - new Date(a.last_viewed || 0))
        .map((a) => byId.get(a.id)),
    [activity, byId]
  );

  const recentlyViewed = useMemo(
    () =>
      activity
        .filter((a) => a.last_viewed && byId.has(a.id))
        .sort((a, b) => new Date(b.last_viewed) - new Date(a.last_viewed))
        .slice(0, 16)
        .map((a) => byId.get(a.id)),
    [activity, byId]
  );

  const trending = useMemo(
    () => [...presentations].sort(SORTERS.trending).slice(0, 16),
    [presentations]
  );

  const recentlyAdded = useMemo(
    () => [...presentations].sort(SORTERS.recent).slice(0, 16),
    [presentations]
  );

  const totalViews = useMemo(
    () => presentations.reduce((sum, p) => sum + (p.view_count || 0), 0),
    [presentations]
  );

  const tags = useMemo(() => topTags(presentations, 24), [presentations]);

  const domainCounts = useMemo(() => {
    const counts = new Map(DOMAIN_NAMES.map((d) => [d, 0]));
    presentations.forEach((p) => {
      if (counts.has(p.primary_domain)) counts.set(p.primary_domain, counts.get(p.primary_domain) + 1);
    });
    return counts;
  }, [presentations]);

  return (
    <div className="mx-auto max-w-[1500px] space-y-10 px-4 py-6 sm:px-6 sm:py-8">
      {/* ------------------------------------------------------------ hero */}
      <section className="relative overflow-hidden rounded-3xl">
        <div className={cn('absolute inset-0 opacity-90', HERO_GRADIENT)} />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_20%_0%,rgba(255,255,255,0.25),transparent)]" />
        <div className="absolute -bottom-24 -right-16 h-72 w-72 rounded-full bg-fuchsia-400/40 blur-3xl" />

        <div className="relative px-6 py-12 sm:px-10 sm:py-16">
          <motion.p
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium text-white ring-1 ring-inset ring-white/25 backdrop-blur"
          >
            <Sparkles className="h-3.5 w-3.5" /> Presentation Knowledge Hub
          </motion.p>

          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 }}
            className="mt-4 max-w-3xl text-balance text-3xl font-bold tracking-tight text-white sm:text-5xl"
          >
            Inspironics knowledge, beautifully organized.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mt-3 max-w-2xl text-sm text-white/80 sm:text-base"
          >
            Discover, search, and view presentations across every team. Stream online, read offline —
            automatically.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="mt-7 max-w-2xl"
          >
            <SearchBar presentations={presentations} size="lg" />
          </motion.div>
        </div>
      </section>

      {/* ----------------------------------------------------------- stats */}
      <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          icon={LibraryIcon}
          label="Presentations"
          value={loading ? '—' : presentations.length}
          tint="from-indigo-500 to-violet-500"
        />
        <StatCard
          icon={Download}
          label="Available Offline"
          value={loading ? '—' : offlineSet.size}
          tint="from-emerald-500 to-teal-500"
        />
        <StatCard
          icon={Eye}
          label="Total Views"
          value={loading ? '—' : totalViews.toLocaleString()}
          tint="from-amber-500 to-orange-500"
        />
        <StatCard
          icon={Layers}
          label="Domains"
          value={DOMAIN_NAMES.length}
          tint="from-fuchsia-500 to-pink-500"
        />
      </section>

      {/* -------------------------------------------------------- shelves */}
      {continueReading.length > 0 && (
        <ScrollRow
          title="Continue Reading"
          icon={PlayCircle}
          items={continueReading}
          decorate={decorate}
          onToggleFavorite={onToggleFavorite}
        />
      )}

      {recentlyViewed.length > 0 && (
        <ScrollRow
          title="Recently Viewed"
          icon={History}
          items={recentlyViewed}
          decorate={decorate}
          onToggleFavorite={onToggleFavorite}
        />
      )}

      <ScrollRow
        title="Trending Now"
        icon={Flame}
        items={trending}
        decorate={decorate}
        onToggleFavorite={onToggleFavorite}
        loading={loading}
        seeAllTo="/library?sort=views"
      />

      <ScrollRow
        title="Recently Added"
        icon={Sparkles}
        items={recentlyAdded}
        decorate={decorate}
        onToggleFavorite={onToggleFavorite}
        loading={loading}
        seeAllTo="/library?sort=recent"
      />

      <MostViewedSection
        presentations={presentations}
        analyticsById={analyticsById}
        decorate={decorate}
        onToggleFavorite={onToggleFavorite}
        loading={loading}
      />

      {/* -------------------------------------------------------- domains */}
      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
          <Layers className="h-5 w-5 text-primary" /> Browse by Domain
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {DOMAIN_NAMES.map((name) => {
            const domain = DOMAINS[name];
            const Icon = domain.icon;
            return (
              <motion.div key={name} whileHover={{ y: -4 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}>
                <Link
                  to={`/library?domain=${encodeURIComponent(name)}`}
                  className="group relative block overflow-hidden rounded-2xl p-5 text-white"
                >
                  <span className={cn('absolute inset-0 bg-gradient-to-br', domain.gradient)} />
                  <span className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.25),transparent)]" />
                  <span className="relative flex flex-col gap-3">
                    <Icon className="h-6 w-6" />
                    <span className="block text-sm font-semibold leading-tight">{name}</span>
                    <span className="flex items-center justify-between text-xs text-white/80">
                      {domainCounts.get(name) || 0} decks
                      <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                    </span>
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------------- tags */}
      {tags.length > 0 && (
        <section className="space-y-3">
          <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
            <Tag className="h-5 w-5 text-primary" /> Popular Tags
          </h2>
          <div className="flex flex-wrap gap-2">
            {tags.map(({ tag, count }) => (
              <Link
                key={tag}
                to={`/library?q=${encodeURIComponent(tag)}`}
                className="rounded-full glass px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {tag}
                <span className="ml-1.5 text-[10px] opacity-60">{count}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
