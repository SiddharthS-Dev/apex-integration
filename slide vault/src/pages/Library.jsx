import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  SlidersHorizontal, LayoutGrid, List as ListIcon, Rows3, X, SearchX, Download, Loader2,
} from 'lucide-react';
import SearchBar, { scorePresentation } from '@/components/SearchBar';
import PresentationCard from '@/components/PresentationCard';
import { SkeletonGrid } from '@/components/SkeletonCard';
import { Button } from '@/components/ui';
import { useLibraryData, SORTERS, SORT_OPTIONS, topTags } from '@/lib/useLibraryData';
import { DOMAINS, DOMAIN_NAMES } from '@/lib/domains';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 24;
const VIEW_KEY = 'slidesvault:library-view';
const LIBRARY_FILE_TYPES = ['pdf', 'pptx', 'html'];

function readViewMode() {
  try {
    return localStorage.getItem(VIEW_KEY) || 'grid';
  } catch {
    return 'grid';
  }
}

function FilterGroup({ title, children }) {
  return (
    <div className="space-y-2">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}

function FilterPill({ active, onClick, children, className }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
        active ? 'bg-primary/15 font-medium text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        className
      )}
    >
      {children}
    </button>
  );
}

export default function Library() {
  const [params, setParams] = useSearchParams();
  const { presentations, loading, decorate, onToggleFavorite } = useLibraryData();

  const [viewMode, setViewMode] = useState(readViewMode);
  const [showFilters, setShowFilters] = useState(false);
  const [visible, setVisible] = useState(PAGE_SIZE);
  const sentinelRef = useRef(null);

  const q = params.get('q') || '';
  const domain = params.get('domain') || '';
  const sub = params.get('sub') || '';
  const type = params.get('type') || '';
  const sort = params.get('sort') || 'recent';
  const offlineOnly = params.get('offline') === '1';

  const setParam = useCallback(
    (key, value) => {
      const next = new URLSearchParams(params);
      if (!value) next.delete(key);
      else next.set(key, value);
      if (key === 'domain') next.delete('sub');
      setParams(next, { replace: true });
    },
    [params, setParams]
  );

  const handleSearch = useCallback((value) => setParam('q', value), [setParam]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  useEffect(() => setVisible(PAGE_SIZE), [q, domain, sub, type, sort, offlineOnly]);

  const results = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    let rows = presentations.filter((p) => {
      if (domain && p.primary_domain !== domain) return false;
      if (sub && p.sub_domain !== sub) return false;
      if (type && p.file_type !== type) return false;
      if (offlineOnly && !decorate(p).isOffline) return false;
      if (terms.length > 0 && scorePresentation(p, terms) === 0) return false;
      return true;
    });

    if (terms.length > 0) {
      rows = rows.sort((a, b) => scorePresentation(b, terms) - scorePresentation(a, terms));
    } else {
      rows = rows.sort(SORTERS[sort] || SORTERS.recent);
    }
    return rows;
  }, [presentations, q, domain, sub, type, sort, offlineOnly, decorate]);

  // Infinite scroll sentinel.
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible((v) => (v < results.length ? v + PAGE_SIZE : v));
        }
      },
      { rootMargin: '400px' }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [results.length]);

  const tags = useMemo(() => topTags(presentations, 20), [presentations]);
  const subDomains = domain ? DOMAINS[domain]?.subDomains || [] : [];
  const hasFilters = Boolean(q || domain || sub || type || offlineOnly || sort !== 'recent');
  const shown = results.slice(0, visible);

  const clearAll = () => setParams(new URLSearchParams(), { replace: true });

  const filtersPanel = (
    <div className="space-y-5">
      <FilterGroup title="Sort">
        <div className="space-y-0.5">
          {SORT_OPTIONS.map((opt) => (
            <FilterPill key={opt.key} active={sort === opt.key} onClick={() => setParam('sort', opt.key)}>
              {opt.label}
            </FilterPill>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Domain">
        <div className="space-y-0.5">
          <FilterPill active={!domain} onClick={() => setParam('domain', '')}>
            All domains
          </FilterPill>
          {DOMAIN_NAMES.map((name) => (
            <FilterPill key={name} active={domain === name} onClick={() => setParam('domain', name)}>
              <span className={cn('h-2.5 w-2.5 shrink-0 rounded-full bg-gradient-to-br', DOMAINS[name].gradient)} />
              <span className="truncate">{name}</span>
            </FilterPill>
          ))}
        </div>
      </FilterGroup>

      {subDomains.length > 0 && (
        <FilterGroup title="Sub-domain">
          <div className="space-y-0.5">
            <FilterPill active={!sub} onClick={() => setParam('sub', '')}>
              All of {domain}
            </FilterPill>
            {subDomains.map((name) => (
              <FilterPill key={name} active={sub === name} onClick={() => setParam('sub', name)}>
                {name}
              </FilterPill>
            ))}
          </div>
        </FilterGroup>
      )}

      <FilterGroup title="File Type">
        <div className="flex flex-wrap gap-1.5">
          {LIBRARY_FILE_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setParam('type', type === t ? '' : t)}
              className={cn(
                'rounded-lg px-2.5 py-1 text-xs font-semibold uppercase transition-colors',
                type === t ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </FilterGroup>

      <FilterGroup title="Availability">
        <FilterPill active={offlineOnly} onClick={() => setParam('offline', offlineOnly ? '' : '1')}>
          <Download className="h-3.5 w-3.5" /> Offline available
        </FilterPill>
      </FilterGroup>

      {tags.length > 0 && (
        <FilterGroup title="Popular Tags">
          <div className="flex flex-wrap gap-1.5">
            {tags.map(({ tag }) => (
              <button
                key={tag}
                type="button"
                onClick={() => setParam('q', q === tag ? '' : tag)}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[11px] transition-colors',
                  q === tag ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'
                )}
              >
                {tag}
              </button>
            ))}
          </div>
        </FilterGroup>
      )}

      {hasFilters && (
        <Button variant="outline" size="sm" className="w-full" onClick={clearAll}>
          <X className="h-3.5 w-3.5" /> Clear filters
        </Button>
      )}
    </div>
  );

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Library</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {loading ? 'Loading the catalog…' : `${results.length} presentation${results.length === 1 ? '' : 's'}`}
              {domain ? ` in ${domain}` : ''}
              {q ? ` matching “${q}”` : ''}
            </p>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-0.5 rounded-xl glass p-1">
              {[
                { key: 'grid', icon: LayoutGrid, label: 'Grid view' },
                { key: 'list', icon: ListIcon, label: 'List view' },
                { key: 'compact', icon: Rows3, label: 'Compact view' },
              ].map(({ key, icon: Icon, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-label={label}
                  onClick={() => setViewMode(key)}
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg transition-colors',
                    viewMode === key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" />
                </button>
              ))}
            </div>
            <Button variant="glass" size="sm" className="lg:hidden" onClick={() => setShowFilters((s) => !s)}>
              <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
            </Button>
          </div>
        </div>

        <SearchBar
          presentations={presentations}
          defaultValue={q}
          live
          onSearch={handleSearch}
        />
      </div>

      <div className="flex gap-6">
        {/* ------------------------------------------------------- filters */}
        <aside
          className={cn(
            'w-60 shrink-0 self-start rounded-2xl glass p-4 lg:sticky lg:top-24 lg:block',
            showFilters ? 'fixed inset-x-4 bottom-4 top-24 z-40 w-auto overflow-y-auto lg:static lg:inset-auto' : 'hidden'
          )}
        >
          <div className="mb-3 flex items-center justify-between lg:hidden">
            <span className="text-sm font-semibold">Filters</span>
            <button type="button" onClick={() => setShowFilters(false)} aria-label="Close filters">
              <X className="h-4 w-4" />
            </button>
          </div>
          {filtersPanel}
        </aside>

        {/* ------------------------------------------------------- results */}
        <div className="min-w-0 flex-1">
          {loading ? (
            <SkeletonGrid count={8} />
          ) : results.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-center justify-center rounded-2xl glass px-6 py-20 text-center"
            >
              <span className="grid h-14 w-14 place-items-center rounded-2xl bg-secondary">
                <SearchX className="h-6 w-6 text-muted-foreground" />
              </span>
              <h2 className="mt-4 text-lg font-semibold">No presentations found</h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Nothing matches these filters. Try a broader search term or clear the filters to see the
                whole library.
              </p>
              {hasFilters && (
                <Button variant="gradient" size="sm" className="mt-5" onClick={clearAll}>
                  Clear filters
                </Button>
              )}
            </motion.div>
          ) : (
            <>
              {viewMode === 'grid' && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                  {shown.map((p) => {
                    const meta = decorate(p);
                    return (
                      <PresentationCard
                        key={p.id}
                        presentation={p}
                        isOffline={meta.isOffline}
                        isFavorite={meta.isFavorite}
                        progress={meta.progress}
                        onToggleFavorite={onToggleFavorite}
                      />
                    );
                  })}
                </div>
              )}

              {viewMode === 'list' && (
                <div className="space-y-3">
                  {shown.map((p) => {
                    const meta = decorate(p);
                    return (
                      <PresentationCard
                        key={p.id}
                        presentation={p}
                        variant="list"
                        isOffline={meta.isOffline}
                        isFavorite={meta.isFavorite}
                        onToggleFavorite={onToggleFavorite}
                      />
                    );
                  })}
                </div>
              )}

              {viewMode === 'compact' && (
                <div className="divide-y divide-border rounded-2xl glass p-2">
                  {shown.map((p) => (
                    <PresentationCard
                      key={p.id}
                      presentation={p}
                      variant="compact"
                      isOffline={decorate(p).isOffline}
                    />
                  ))}
                </div>
              )}

              <div ref={sentinelRef} className="h-16" />
              {visible < results.length && (
                <p className="flex items-center justify-center gap-2 pb-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading more…
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
