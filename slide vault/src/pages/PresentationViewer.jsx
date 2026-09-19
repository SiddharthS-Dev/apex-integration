import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft, Search, PanelLeftClose, PanelLeftOpen, Bookmark, Star, Download, Trash2,
  ZoomIn, ZoomOut, Maximize2, Minimize2, ChevronLeft, ChevronRight, Loader2, WifiOff,
  AlertTriangle, CheckCircle2, Target, X,
} from 'lucide-react';
import { Presentation } from '@/api/entities';
import { getPresentationStream } from '@/api/functions';
import { trackView } from '@/lib/analytics';
import {
  cacheFile, getCachedFile, removeCachedFile, getActivity, updateActivity,
  ensureCacheSpace, toggleBookmark as toggleBookmarkDb,
} from '@/lib/offline-db';
import { getDomain, FILE_TYPE_STYLE } from '@/lib/domains';
import PresentationCard from '@/components/PresentationCard';
import { Button } from '@/components/ui';
import { cn, formatBytes, formatDate, timeAgo } from '@/lib/utils';

const ZOOM_STEPS = [50, 75, 90, 100, 125, 150, 175, 200];

export default function PresentationViewer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [presentation, setPresentation] = useState(null);
  const [related, setRelated] = useState([]);
  const [fileUrl, setFileUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [activity, setActivity] = useState(null);
  const [isOffline, setIsOffline] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [servedOffline, setServedOffline] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);

  const [tocOpen, setTocOpen] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [zoom, setZoom] = useState(100);
  const [fullscreen, setFullscreen] = useState(false);
  const [page, setPage] = useState(1);
  const [toast, setToast] = useState(null);

  const blobUrlRef = useRef(null);
  const startedAt = useRef(Date.now());
  const maxPage = useRef(1);
  const containerRef = useRef(null);

  const totalPages = presentation?.slide_count || 0;
  const progress = totalPages > 0 ? Math.min(100, Math.round((page / totalPages) * 100)) : 0;

  const flash = useCallback((message, tone = 'success') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 2600);
  }, []);

  /* ------------------------------------------------------------- loading */

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    startedAt.current = Date.now();
    maxPage.current = 1;
    setLoading(true);
    setError(null);
    setFileUrl('');
    setServedOffline(false);

    (async () => {
      try {
        const record = await Presentation.get(id);
        if (cancelled) return;
        setPresentation(record);

        const act = await getActivity(id);
        if (cancelled) return;
        setActivity(act);
        setPage(act.current_page || 1);
        maxPage.current = act.current_page || 1;

        // An offline copy always wins: instant, and works with no network.
        const cached = await getCachedFile(id);
        if (cancelled) return;
        setIsOffline(Boolean(cached));

        if (cached?.blob) {
          blobUrlRef.current = URL.createObjectURL(cached.blob);
          setFileUrl(blobUrlRef.current);
          setServedOffline(true);
        } else if (!navigator.onLine) {
          setError('You are offline and this presentation has not been downloaded yet.');
        } else {
          const { data } = await getPresentationStream({ presentation_id: id });
          if (cancelled) return;
          if (!data?.url) throw new Error('No streamable file was returned.');
          setFileUrl(data.url);
        }

        Presentation.filter({ primary_domain: record.primary_domain, status: 'active' }, '-view_count', 13)
          .then((rows) => !cancelled && setRelated(rows.filter((r) => r.id !== id).slice(0, 12)))
          .catch(() => {});
      } catch (err) {
        console.error('[viewer] load failed', err);
        if (!cancelled) setError(err.message || 'This presentation could not be opened.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [id]);

  /* -------------------------------------------- persist progress + views */

  const persistProgress = useCallback(
    (nextPage) => {
      maxPage.current = Math.max(maxPage.current, nextPage);
      const pct = totalPages > 0 ? Math.min(100, Math.round((maxPage.current / totalPages) * 100)) : 0;
      updateActivity(id, {
        current_page: nextPage,
        progress: pct,
        last_viewed: new Date().toISOString(),
      }).catch(() => {});
    },
    [id, totalPages]
  );

  useEffect(() => {
    if (!presentation) return undefined;
    updateActivity(id, {
      last_viewed: new Date().toISOString(),
      views: (activity?.views || 0) + 1,
    }).catch(() => {});

    return () => {
      const secs = (Date.now() - startedAt.current) / 1000;
      const pct = totalPages > 0 ? Math.min(100, Math.round((maxPage.current / totalPages) * 100)) : 0;
      if (secs > 3) {
        trackView(id, {
          source: servedOffline ? 'offline' : 'online',
          readingTimeSecs: secs,
          completionPct: pct,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presentation?.id]);

  /* ------------------------------------------------------------- actions */

  const goToPage = useCallback(
    (next) => {
      const bounded = Math.max(1, totalPages ? Math.min(next, totalPages) : next);
      setPage(bounded);
      persistProgress(bounded);
    },
    [persistProgress, totalPages]
  );

  const handleToggleBookmark = useCallback(async () => {
    const next = await toggleBookmarkDb(id, page);
    setActivity(next);
    flash(next.bookmarks.includes(page) ? `Bookmarked page ${page}` : `Bookmark removed`);
  }, [id, page, flash]);

  const handleToggleFavorite = useCallback(async () => {
    const next = await updateActivity(id, { favorite: !activity?.favorite });
    setActivity(next);
    flash(next.favorite ? 'Added to favourites' : 'Removed from favourites');
  }, [activity?.favorite, id, flash]);

  const handleDownload = useCallback(async () => {
    if (!fileUrl || downloading) return;
    setDownloading(true);
    try {
      const response = await fetch(fileUrl);
      if (!response.ok) throw new Error(`Download failed (${response.status})`);
      const blob = await response.blob();
      await ensureCacheSpace(blob.size);
      await cacheFile(id, blob, {
        rev: presentation?.dropbox_rev,
        title: presentation?.title,
        file_type: presentation?.file_type,
      });
      setIsOffline(true);
      flash('Saved for offline reading');
    } catch (err) {
      console.error('[viewer] download failed', err);
      flash(err.message || 'Download failed', 'danger');
    } finally {
      setDownloading(false);
    }
  }, [downloading, fileUrl, id, presentation, flash]);

  const handleRemoveOffline = useCallback(async () => {
    await removeCachedFile(id);
    setIsOffline(false);
    flash('Offline copy removed');
  }, [id, flash]);

  const changeZoom = useCallback((dir) => {
    setZoom((current) => {
      const idx = ZOOM_STEPS.indexOf(current);
      const nextIdx = Math.max(0, Math.min(ZOOM_STEPS.length - 1, (idx === -1 ? 3 : idx) + dir));
      return ZOOM_STEPS[nextIdx];
    });
  }, []);

  /* --------------------------------------------------- keyboard shortcuts */

  useEffect(() => {
    const onKey = (e) => {
      const tag = e.target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') {
        if (e.key === 'Escape') setSearchOpen(false);
        return;
      }
      switch (e.key) {
        case 'ArrowRight':
          goToPage(page + 1);
          break;
        case 'ArrowLeft':
          goToPage(page - 1);
          break;
        case ' ':
          e.preventDefault();
          goToPage(page + 1);
          break;
        case 'f':
        case 'F':
          setFullscreen((f) => !f);
          break;
        case '+':
        case '=':
          changeZoom(1);
          break;
        case '-':
          changeZoom(-1);
          break;
        case 'b':
        case 'B':
          handleToggleBookmark();
          break;
        case 'Escape':
          if (searchOpen) setSearchOpen(false);
          else if (fullscreen) setFullscreen(false);
          else setTocOpen(false);
          break;
        default:
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, goToPage, changeZoom, handleToggleBookmark, searchOpen, fullscreen]);

  /* ------------------------------------------------------------- render */

  const domain = getDomain(presentation?.primary_domain);

  // #toolbar=0&navpanes=0 hides the browser's own download/print controls.
  const frameSrc = useMemo(() => {
    if (!fileUrl) return '';
    const hash = [`page=${page}`, 'toolbar=0', 'navpanes=0', 'scrollbar=0', 'view=FitH'];
    if (searchTerm) hash.push(`search=${encodeURIComponent(searchTerm)}`);
    return `${fileUrl}#${hash.join('&')}`;
  }, [fileUrl, page, searchTerm]);

  if (loading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">Preparing the presentation…</p>
      </div>
    );
  }

  if (error && !fileUrl) {
    return (
      <div className="mx-auto flex min-h-[70vh] max-w-lg flex-col items-center justify-center px-6 text-center">
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-amber-500/15 text-amber-400">
          {online ? <AlertTriangle className="h-6 w-6" /> : <WifiOff className="h-6 w-6" />}
        </span>
        <h1 className="mt-4 text-xl font-semibold">Cannot open this presentation</h1>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <div className="mt-6 flex gap-2">
          <Button variant="outline" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" /> Go back
          </Button>
          <Button variant="gradient" onClick={() => window.location.reload()}>
            Try again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex flex-col', fullscreen && 'fixed inset-0 z-50 bg-background')}>
      {/* --------------------------------------------------------- top bar */}
      <div className="sticky top-16 z-20 border-b border-border/60 glass-strong lg:top-16">
        <div className="flex h-14 items-center gap-2 px-3 sm:px-4">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>

          <div className="flex min-w-0 flex-1 items-center gap-2">
            <h1 className="truncate text-sm font-semibold sm:text-base">{presentation?.title}</h1>
            <span
              className={cn(
                'hidden shrink-0 rounded-full bg-gradient-to-r px-2 py-0.5 text-[10px] font-semibold text-white sm:inline-block',
                domain.gradient
              )}
            >
              {presentation?.primary_domain}
            </span>
            <span
              className={cn(
                'hidden shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset md:inline-block',
                FILE_TYPE_STYLE[presentation?.file_type] || FILE_TYPE_STYLE.pdf
              )}
            >
              {presentation?.file_type}
            </span>
            {servedOffline && (
              <span className="hidden shrink-0 items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-400 sm:inline-flex">
                <Download className="h-2.5 w-2.5" /> Offline
              </span>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-0.5">
            <IconButton label="Find in presentation" onClick={() => setSearchOpen((s) => !s)} active={searchOpen}>
              <Search className="h-4 w-4" />
            </IconButton>
            <IconButton label="Toggle details panel" onClick={() => setTocOpen((t) => !t)} active={tocOpen}>
              {tocOpen ? <PanelLeftClose className="h-4 w-4" /> : <PanelLeftOpen className="h-4 w-4" />}
            </IconButton>
            <IconButton label="Bookmark this page" onClick={handleToggleBookmark} active={activity?.bookmarks?.includes(page)}>
              <Bookmark className={cn('h-4 w-4', activity?.bookmarks?.includes(page) && 'fill-current')} />
            </IconButton>
            <IconButton label="Favourite" onClick={handleToggleFavorite} active={activity?.favorite}>
              <Star className={cn('h-4 w-4', activity?.favorite && 'fill-amber-400 text-amber-400')} />
            </IconButton>
            <IconButton
              label={isOffline ? 'Downloaded for offline' : 'Download for offline'}
              onClick={isOffline ? handleRemoveOffline : handleDownload}
              active={isOffline}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : isOffline ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
              ) : (
                <Download className="h-4 w-4" />
              )}
            </IconButton>

            <span className="mx-1 hidden items-center gap-0.5 rounded-lg bg-secondary/60 px-1 sm:flex">
              <IconButton label="Zoom out" onClick={() => changeZoom(-1)}>
                <ZoomOut className="h-4 w-4" />
              </IconButton>
              <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">{zoom}%</span>
              <IconButton label="Zoom in" onClick={() => changeZoom(1)}>
                <ZoomIn className="h-4 w-4" />
              </IconButton>
            </span>

            <IconButton label="Fullscreen" onClick={() => setFullscreen((f) => !f)}>
              {fullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </IconButton>
          </div>
        </div>

        {/* Reading progress */}
        <div className="h-0.5 w-full bg-secondary">
          <motion.div
            className="h-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500"
            animate={{ width: `${progress}%` }}
            transition={{ type: 'spring', stiffness: 200, damping: 30 }}
          />
        </div>

        <AnimatePresence>
          {searchOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-t border-border/60"
            >
              <div className="flex items-center gap-2 px-3 py-2 sm:px-4">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
                <input
                  autoFocus
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Find in this presentation…"
                  className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  type="button"
                  onClick={() => {
                    setSearchTerm('');
                    setSearchOpen(false);
                  }}
                  aria-label="Close find"
                  className="rounded p-1 text-muted-foreground hover:bg-secondary"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* --------------------------------------------------------- content */}
      <div className="flex min-h-0 flex-1">
        <AnimatePresence initial={false}>
          {tocOpen && (
            <motion.aside
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 320, opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="hidden shrink-0 overflow-hidden border-r border-border/60 lg:block"
            >
              <div className="h-[calc(100vh-8.5rem)] w-80 space-y-5 overflow-y-auto p-4">
                <section className="space-y-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Details
                  </h2>
                  <dl className="space-y-1.5 rounded-xl glass p-3 text-xs">
                    <Row label="Author" value={presentation?.author || '—'} />
                    <Row label="Slides" value={presentation?.slide_count || '—'} />
                    <Row label="Size" value={formatBytes(presentation?.file_size)} />
                    <Row label="Updated" value={formatDate(presentation?.modified_date)} />
                    <Row label="Synced" value={timeAgo(presentation?.last_synced)} />
                    <Row
                      label="AI confidence"
                      value={presentation?.ai_confidence ? `${Math.round(presentation.ai_confidence * 100)}%` : '—'}
                    />
                  </dl>
                </section>

                {presentation?.ai_summary && (
                  <section className="space-y-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      AI Summary
                    </h2>
                    <p className="rounded-xl glass p-3 text-xs leading-relaxed text-muted-foreground">
                      {presentation.ai_summary}
                    </p>
                  </section>
                )}

                {presentation?.learning_objectives?.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Learning Objectives
                    </h2>
                    <ul className="space-y-2 rounded-xl glass p-3">
                      {presentation.learning_objectives.map((obj, i) => (
                        <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
                          <Target className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                          {obj}
                        </li>
                      ))}
                    </ul>
                  </section>
                )}

                <section className="space-y-2">
                  <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Bookmarks
                  </h2>
                  {activity?.bookmarks?.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {activity.bookmarks.map((b) => (
                        <button
                          key={b}
                          type="button"
                          onClick={() => goToPage(b)}
                          className={cn(
                            'rounded-lg px-2.5 py-1 text-xs transition-colors',
                            page === b ? 'bg-primary text-primary-foreground' : 'bg-secondary hover:bg-secondary/70'
                          )}
                        >
                          Page {b}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      No bookmarks yet — press <kbd className="rounded bg-secondary px-1">B</kbd> to add one.
                    </p>
                  )}
                </section>

                {presentation?.tags?.length > 0 && (
                  <section className="space-y-2">
                    <h2 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Tags
                    </h2>
                    <div className="flex flex-wrap gap-1.5">
                      {presentation.tags.map((tag) => (
                        <Link
                          key={tag}
                          to={`/library?q=${encodeURIComponent(tag)}`}
                          className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          {tag}
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {isOffline && (
                  <Button variant="outline" size="sm" className="w-full" onClick={handleRemoveOffline}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove offline copy
                  </Button>
                )}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* ------------------------------------------------------- viewer */}
        <div className="min-w-0 flex-1 bg-black/20">
          <div
            className="relative h-[calc(100vh-8.5rem)] w-full select-none overflow-auto"
            onContextMenu={(e) => e.preventDefault()}
          >
            {frameSrc ? (
              <iframe
                title={presentation?.title || 'Presentation'}
                src={frameSrc}
                className="h-full w-full border-0 bg-neutral-900"
                style={{
                  transform: `scale(${zoom / 100})`,
                  transformOrigin: 'top center',
                  width: `${10000 / zoom}%`,
                  height: `${10000 / zoom}%`,
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                No preview available.
              </div>
            )}
          </div>

          {/* Page controls */}
          <div className="flex items-center justify-center gap-2 border-t border-border/60 py-2.5">
            <Button variant="ghost" size="sm" onClick={() => goToPage(page - 1)} disabled={page <= 1}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <div className="flex items-center gap-1.5 rounded-lg glass px-2.5 py-1">
              <input
                type="number"
                min={1}
                max={totalPages || undefined}
                value={page}
                onChange={(e) => goToPage(Number(e.target.value) || 1)}
                className="w-12 bg-transparent text-center text-sm outline-none"
                aria-label="Page number"
              />
              {totalPages > 0 && <span className="text-xs text-muted-foreground">/ {totalPages}</span>}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => goToPage(page + 1)}
              disabled={totalPages > 0 && page >= totalPages}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* --------------------------------------------------------- related */}
      {!fullscreen && related.length > 0 && (
        <section className="mx-auto w-full max-w-[1500px] space-y-3 px-4 py-8 sm:px-6">
          <h2 className="text-lg font-semibold tracking-tight">
            More in {presentation?.primary_domain}
          </h2>
          <div className="scroll-row no-scrollbar">
            {related.map((p) => (
              <div key={p.id} className="w-[240px] shrink-0 snap-start">
                <PresentationCard presentation={p} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ----------------------------------------------------------- toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className={cn(
              'fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm shadow-xl ring-1',
              toast.tone === 'danger'
                ? 'bg-red-500/90 text-white ring-red-400/40'
                : 'bg-emerald-500/90 text-white ring-emerald-400/40'
            )}
          >
            {toast.message}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function IconButton({ children, label, onClick, active }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        'grid h-9 w-9 place-items-center rounded-lg transition-colors',
        active ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-medium">{value}</dd>
    </div>
  );
}
