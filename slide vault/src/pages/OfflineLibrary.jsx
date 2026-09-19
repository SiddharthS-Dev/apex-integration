import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { HardDrive, Download, History, Heart, Trash2, Inbox, RefreshCw } from 'lucide-react';
import { Presentation } from '@/api/entities';
import PresentationCard from '@/components/PresentationCard';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { Button } from '@/components/ui';
import {
  getAllCached, removeCachedFile, getAllActivity, getStorageEstimate, toggleFavorite,
} from '@/lib/offline-db';
import { cn, formatBytes, timeAgo } from '@/lib/utils';

const TABS = [
  { key: 'downloads', label: 'Downloads', icon: Download },
  { key: 'recent', label: 'Recently Viewed', icon: History },
  { key: 'favorites', label: 'Favorites', icon: Heart },
];

export default function OfflineLibrary() {
  const [tab, setTab] = useState('downloads');
  const [cached, setCached] = useState([]);
  const [activity, setActivity] = useState([]);
  const [presentations, setPresentations] = useState([]);
  const [estimate, setEstimate] = useState({ usage: 0, quota: 0 });
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [files, acts, rows, storage] = await Promise.all([
        getAllCached(),
        getAllActivity(),
        Presentation.filter({ status: 'active' }),
        getStorageEstimate(),
      ]);
      setCached(files);
      setActivity(acts);
      setPresentations(rows);
      setEstimate(storage);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const byId = useMemo(() => {
    const map = new Map();
    presentations.forEach((p) => map.set(p.id, p));
    return map;
  }, [presentations]);

  const activityById = useMemo(() => {
    const map = new Map();
    activity.forEach((a) => map.set(a.id, a));
    return map;
  }, [activity]);

  const offlineSet = useMemo(() => new Set(cached.map((c) => c.id)), [cached]);

  const cacheBytes = useMemo(() => cached.reduce((s, c) => s + (c.size || 0), 0), [cached]);
  const quota = estimate.quota || 0;
  const usedPct = quota > 0 ? Math.min(100, (cacheBytes / quota) * 100) : 0;

  const handleRemove = async (id) => {
    await removeCachedFile(id);
    load();
  };

  const handleToggleFavorite = async (id) => {
    await toggleFavorite(id);
    setActivity(await getAllActivity());
  };

  const downloads = cached.map((c) => ({ file: c, presentation: byId.get(c.id) })).filter((r) => r.presentation);

  const recent = activity
    .filter((a) => a.last_viewed && byId.has(a.id))
    .sort((a, b) => new Date(b.last_viewed) - new Date(a.last_viewed))
    .map((a) => byId.get(a.id));

  const favorites = activity.filter((a) => a.favorite && byId.has(a.id)).map((a) => byId.get(a.id));

  const counts = {
    downloads: downloads.length,
    recent: recent.length,
    favorites: favorites.length,
  };

  const emptyState = (message) => (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col items-center justify-center rounded-2xl glass px-6 py-20 text-center"
    >
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary">
        <Inbox className="h-6 w-6 text-muted-foreground" />
      </span>
      <h2 className="mt-4 text-lg font-semibold">Nothing here yet</h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{message}</p>
      <Button asChild variant="gradient" size="sm" className="mt-5 p-0">
        <Link to="/library" className="px-4 py-2">
          Browse the library
        </Link>
      </Button>
    </motion.div>
  );

  return (
    <div className="mx-auto max-w-[1500px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Downloads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Downloaded presentations live inside the app sandbox — never as loose files on your device.
          </p>
        </div>
        <Button variant="glass" size="sm" onClick={load}>
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /> Refresh
        </Button>
      </div>

      {/* ----------------------------------------------------- storage meter */}
      <section className="rounded-2xl glass p-4">
        <div className="flex items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white">
            <HardDrive className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">Offline storage</p>
              <p className="text-xs text-muted-foreground">
                {formatBytes(cacheBytes)} used
                {quota > 0 ? ` of ${formatBytes(quota)} available` : ''} · {cached.length} file
                {cached.length === 1 ? '' : 's'}
              </p>
            </div>
            <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-secondary">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${Math.max(usedPct, cacheBytes > 0 ? 2 : 0)}%` }}
                transition={{ duration: 0.6 }}
                className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400"
              />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------- tabs */}
      <div className="inline-flex items-center gap-1 rounded-xl glass p-1">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all sm:text-sm',
              tab === key
                ? 'bg-gradient-to-r from-indigo-600 to-violet-600 text-white shadow'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span className={cn('rounded-full px-1.5 text-[10px]', tab === key ? 'bg-white/20' : 'bg-secondary')}>
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <SkeletonGrid count={4} />
      ) : tab === 'downloads' ? (
        downloads.length === 0 ? (
          emptyState('Open any presentation and tap Download to keep a copy for offline reading.')
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {downloads.map(({ file, presentation }) => (
              <div key={file.id} className="space-y-2">
                <PresentationCard
                  presentation={presentation}
                  isOffline
                  isFavorite={activityById.get(file.id)?.favorite}
                  progress={activityById.get(file.id)?.progress || 0}
                  onToggleFavorite={handleToggleFavorite}
                />
                <div className="flex items-center justify-between gap-2 px-1 text-[11px] text-muted-foreground">
                  <span className="truncate">
                    Synced {timeAgo(file.cached_at)} · {formatBytes(file.size)}
                    {activityById.get(file.id)?.last_viewed
                      ? ` · Viewed ${timeAgo(activityById.get(file.id).last_viewed)}`
                      : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(file.id)}
                    className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-red-400 transition-colors hover:bg-red-500/10"
                  >
                    <Trash2 className="h-3 w-3" /> Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : tab === 'recent' ? (
        recent.length === 0 ? (
          emptyState('Presentations you open will appear here so you can pick up where you left off.')
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {recent.map((p) => (
              <PresentationCard
                key={p.id}
                presentation={p}
                isOffline={offlineSet.has(p.id)}
                isFavorite={activityById.get(p.id)?.favorite}
                progress={activityById.get(p.id)?.progress || 0}
                onToggleFavorite={handleToggleFavorite}
              />
            ))}
          </div>
        )
      ) : favorites.length === 0 ? (
        emptyState('Star a presentation to keep it close at hand.')
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {favorites.map((p) => (
            <PresentationCard
              key={p.id}
              presentation={p}
              isOffline={offlineSet.has(p.id)}
              isFavorite
              progress={activityById.get(p.id)?.progress || 0}
              onToggleFavorite={handleToggleFavorite}
            />
          ))}
        </div>
      )}
    </div>
  );
}
