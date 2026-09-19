import { useCallback, useEffect, useMemo, useState } from 'react';
import { Presentation, PresentationAnalytics } from '@/api/entities';
import { getAllActivity, getAllCachedIds, toggleFavorite } from '@/lib/offline-db';

/**
 * One place to load the catalog plus the local reading state that decorates it.
 * Home, Library, Dashboard and OfflineLibrary all need the same three sources,
 * so they share this hook instead of each re-implementing the joins.
 */
export function useLibraryData({ withAnalytics = false } = {}) {
  const [presentations, setPresentations] = useState([]);
  const [analytics, setAnalytics] = useState([]);
  const [activity, setActivity] = useState([]);
  const [offlineIds, setOfflineIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadLocalState = useCallback(async () => {
    const [acts, ids] = await Promise.all([getAllActivity(), getAllCachedIds()]);
    setActivity(acts);
    setOfflineIds(ids);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await Presentation.filter({ status: 'active' }, '-created_date');
      setPresentations(rows);
      if (withAnalytics) {
        setAnalytics(await PresentationAnalytics.list('-total_views'));
      }
      await loadLocalState();
      setError(null);
    } catch (err) {
      console.error('[library] load failed', err);
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [withAnalytics, loadLocalState]);

  useEffect(() => {
    load();
  }, [load]);

  const activityById = useMemo(() => {
    const map = new Map();
    activity.forEach((a) => map.set(a.id, a));
    return map;
  }, [activity]);

  const offlineSet = useMemo(() => new Set(offlineIds), [offlineIds]);

  const analyticsById = useMemo(() => {
    const map = new Map();
    analytics.forEach((a) => map.set(a.presentation_id, a));
    return map;
  }, [analytics]);

  const onToggleFavorite = useCallback(
    async (id) => {
      await toggleFavorite(id);
      await loadLocalState();
    },
    [loadLocalState]
  );

  const decorate = useCallback(
    (p) => ({
      presentation: p,
      isOffline: offlineSet.has(p.id),
      isFavorite: activityById.get(p.id)?.favorite === true,
      progress: activityById.get(p.id)?.progress || 0,
    }),
    [offlineSet, activityById]
  );

  return {
    presentations,
    analytics,
    analyticsById,
    activity,
    activityById,
    offlineIds,
    offlineSet,
    loading,
    error,
    reload: load,
    reloadLocalState: loadLocalState,
    onToggleFavorite,
    decorate,
  };
}

/** Sorts by the value people expect from each library sort option. */
export const SORTERS = {
  recent: (a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0),
  updated: (a, b) => new Date(b.modified_date || b.updated_date || 0) - new Date(a.modified_date || a.updated_date || 0),
  views: (a, b) => (b.view_count || 0) - (a.view_count || 0),
  title: (a, b) => String(a.title).localeCompare(String(b.title)),
  trending: (a, b) => (b.trend_score || b.view_count || 0) - (a.trend_score || a.view_count || 0),
};

export const SORT_OPTIONS = [
  { key: 'recent', label: 'Recently Added' },
  { key: 'updated', label: 'Recently Updated' },
  { key: 'views', label: 'Most Viewed' },
  { key: 'title', label: 'A → Z' },
];

/** Tag cloud helper: most frequent tags across the catalog. */
export function topTags(presentations, limit = 20) {
  const counts = new Map();
  presentations.forEach((p) => {
    (p.tags || []).forEach((tag) => counts.set(tag, (counts.get(tag) || 0) + 1));
  });
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag, count]) => ({ tag, count }));
}
