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

/** The longest reading time the API accepts for one view (four hours). */
const MAX_READING_SECS = 14_400;

/**
 * Mirrors the policy the API puts on a synced .html file it serves
 * (`Content-Security-Policy: sandbox allow-popups`): no scripts, no forms, and
 * — the part that matters — no allow-same-origin, so the document runs in an
 * opaque origin. The app shares its origin with every other Apex app, so an
 * HTML deck rendered same-origin could call all of their APIs as the viewer.
 */
const MARKUP_SANDBOX = 'allow-popups';

/**
 * What an offline copy really is, from its first bytes — never from the type
 * stored next to it, which came from whatever served it. Only a PDF or a
 * raster image is handed to the browser as a blob URL; everything else is
 * either markup for the sandbox or not previewable.
 */
async function sniffOfflineCopy(blob, fileType) {
  const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  const ascii = String.fromCharCode(...head);
  if (ascii.startsWith('%PDF-')) return 'application/pdf';
  if (head[0] === 0x89 && ascii.slice(1, 4) === 'PNG') return 'image/png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'image/jpeg';
  if (ascii.startsWith('GIF8')) return 'image/gif';
  if (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') return 'image/webp';
  const type = String(blob.type || '').toLowerCase();
  if (/html|svg|xml|^text\//.test(type) || ['html', 'htm'].includes(String(fileType).toLowerCase())) {
    return 'markup';
  }
  return 'binary';
}

/**
 * Builds the frame for an offline copy.
 * @returns {Promise<{kind: 'url', src: string, pdf: boolean, revoke: string}
 *   | {kind: 'srcdoc', srcdoc: string} | {kind: 'none'}>}
 */
async function offlineFrame(blob, fileType) {
  const sniffed = await sniffOfflineCopy(blob, fileType);
  if (sniffed === 'markup') return { kind: 'srcdoc', srcdoc: await blob.text() };
  if (sniffed === 'binary') return { kind: 'none' };
  // Re-typed from the sniffed bytes, so the browser renders it as exactly that.
  const src = URL.createObjectURL(new Blob([blob], { type: sniffed }));
  return { kind: 'url', src, pdf: sniffed === 'application/pdf', revoke: src };
}

export default function PresentationViewer() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [presentation, setPresentation] = useState(null);
  const [related, setRelated] = useState([]);
  // What the viewer frame shows: a URL (online stream, or a PDF/image offline
  // copy), sandboxed markup, or nothing previewable.
  const [frame, setFrame] = useState(null);
  // The streamable URL online, which is also what a download fetches.
  const [fileUrl, setFileUrl] = useState('');
  const [offlineStale, setOfflineStale] = useState(false);
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

  // Read by the unmount cleanup, which would otherwise see the values from the
  // render that first scheduled it — "online, 0 pages" — not the final ones.
  const servedOfflineRef = useRef(false);
  const totalPagesRef = useRef(0);

  const totalPages = presentation?.slide_count || 0;
  totalPagesRef.current = totalPages;
  servedOfflineRef.current = servedOffline;
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
    setFrame(null);
    setFileUrl('');
    setOfflineStale(false);
    setServedOffline(false);

    (async () => {
      try {
        const cached = await getCachedFile(id);
        if (cancelled) return;
        setIsOffline(Boolean(cached));

        // The record comes from the server when it can; with no network, the
        // copy saved alongside the offline file stands in for it.
        let record;
        try {
          record = await Presentation.get(id);
        } catch (err) {
          if (!cached?.blob || navigator.onLine) throw err;
          record = cached.presentation || {
            id,
            title: cached.title,
            file_type: cached.file_type,
            dropbox_rev: cached.rev,
          };
        }
        if (cancelled) return;
        setPresentation(record);

        const act = await getActivity(id);
        if (cancelled) return;
        setActivity(act);
        setPage(act.current_page || 1);
        maxPage.current = act.current_page || 1;

        // The offline copy is used when there is no network, or when it is
        // provably the current revision. Online, a copy of an older revision —
        // or one saved before revisions were recorded — is stale: the live
        // file is shown instead and the copy is offered for refresh.
        const current = record?.dropbox_rev;
        const copyIsCurrent = Boolean(cached?.blob && cached.rev && current && cached.rev === current);
        const useCopy = Boolean(cached?.blob) && (!navigator.onLine || copyIsCurrent);
        if (cached?.blob && !useCopy) setOfflineStale(true);

        if (useCopy) {
          const built = await offlineFrame(cached.blob, cached.file_type || record?.file_type);
          if (cancelled) {
            if (built.revoke) URL.revokeObjectURL(built.revoke);
            return;
          }
          if (built.revoke) blobUrlRef.current = built.revoke;
          if (built.kind === 'none') {
            setError('This offline copy cannot be previewed. Connect to the network to open it.');
          }
          setFrame(built);
          setServedOffline(true);
        } else if (!navigator.onLine) {
          setError('You are offline and this presentation has not been downloaded yet.');
        } else {
          const { data } = await getPresentationStream({ presentation_id: id });
          if (cancelled) return;
          if (!data?.url) throw new Error('No streamable file was returned.');
          setFileUrl(data.url);
          const markup = /html/i.test(data.contentType || '') ||
            ['html', 'htm'].includes(String(record?.file_type).toLowerCase());
          setFrame({ kind: 'url', src: data.url, pdf: !markup, sandbox: markup ? MARKUP_SANDBOX : undefined });
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
      // Refs, not state: this closure was created on the first render after
      // load and would otherwise report that render's values.
      const pages = totalPagesRef.current;
      const secs = Math.min(MAX_READING_SECS, (Date.now() - startedAt.current) / 1000);
      const pct = pages > 0 ? Math.min(100, Math.round((maxPage.current / pages) * 100)) : 0;
      if (secs > 3) {
        trackView(id, {
          source: servedOfflineRef.current ? 'offline' : 'online',
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
        // The record itself, so the viewer and the offline library can show
        // the deck with no network.
        presentation,
      });
      setIsOffline(true);
      setOfflineStale(false);
      flash(offlineStale ? 'Offline copy updated' : 'Saved for offline reading');
    } catch (err) {
      console.error('[viewer] download failed', err);
      flash(err.message || 'Download failed', 'danger');
    } finally {
      setDownloading(false);
    }
  }, [downloading, fileUrl, id, presentation, offlineStale, flash]);

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
  // The PDF open parameters mean nothing to an image or markup, so they are
  // only appended for a PDF.
  const frameSrc = useMemo(() => {
    if (frame?.kind !== 'url' || !frame.src) return '';
    if (!frame.pdf) return frame.src;
    const hash = [`page=${page}`, 'toolbar=0', 'navpanes=0', 'scrollbar=0', 'view=FitH'];
    if (searchTerm) hash.push(`search=${encodeURIComponent(searchTerm)}`);
    return `${frame.src}#${hash.join('&')}`;
  }, [frame, page, searchTerm]);
  const hasFrame = Boolean(frameSrc) || frame?.kind === 'srcdoc';

  if (loading) {
    return (
      <div className="flex min-h-[70vh] flex-col items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm">Preparing the presentation…</p>
      </div>
    );
  }

  if (error && !hasFrame) {
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
              label={
                offlineStale
                  ? 'Offline copy is out of date — update it'
                  : isOffline
                    ? 'Downloaded for offline'
                    : 'Download for offline'
              }
              onClick={isOffline && !offlineStale ? handleRemoveOffline : handleDownload}
              active={isOffline}
            >
              {downloading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : offlineStale ? (
                <AlertTriangle className="h-4 w-4 text-amber-400" />
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
            {hasFrame ? (
              <iframe
                title={presentation?.title || 'Presentation'}
                // Markup — an offline .html copy as srcdoc, or the live HTML
                // stream — always goes in a sandbox without allow-same-origin.
                // A PDF is not sandboxed: the browser's PDF viewer refuses to
                // run in one, and a PDF cannot script the embedding origin.
                {...(frame?.kind === 'srcdoc'
                  ? { srcDoc: frame.srcdoc, sandbox: MARKUP_SANDBOX }
                  : { src: frameSrc, ...(frame?.sandbox !== undefined ? { sandbox: frame.sandbox } : {}) })}
                referrerPolicy="no-referrer"
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
