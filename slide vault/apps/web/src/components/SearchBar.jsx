import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, X, Clock, CornerDownLeft } from 'lucide-react';
import { getDomain } from '@/lib/domains';
import { cn } from '@/lib/utils';

const RECENT_KEY = 'slidesvault:recent-searches';
const MAX_RECENT = 6;
const MAX_SUGGESTIONS = 6;

function readRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function pushRecent(term) {
  const clean = term.trim();
  if (!clean) return readRecent();
  const next = [clean, ...readRecent().filter((t) => t.toLowerCase() !== clean.toLowerCase())].slice(0, MAX_RECENT);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
  return next;
}

/** Scores a presentation against a query across every indexed field. */
export function scorePresentation(p, terms) {
  const title = (p.title || '').toLowerCase();
  const summary = `${p.ai_summary || ''} ${p.description || ''}`.toLowerCase();
  const domain = `${p.primary_domain || ''} ${p.sub_domain || ''} ${p.category || ''}`.toLowerCase();
  const tags = [...(p.tags || []), ...(p.keywords || [])].join(' ').toLowerCase();

  let score = 0;
  for (const t of terms) {
    if (title === t) score += 40;
    if (title.startsWith(t)) score += 14;
    if (title.includes(t)) score += 10;
    if (domain.includes(t)) score += 6;
    if (tags.includes(t)) score += 5;
    if (summary.includes(t)) score += 2;
  }
  return score;
}

export function searchPresentations(presentations, query, limit = MAX_SUGGESTIONS) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return presentations
    .map((p) => ({ p, score: scorePresentation(p, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || (b.p.view_count || 0) - (a.p.view_count || 0))
    .slice(0, limit)
    .map((r) => r.p);
}

export default function SearchBar({
  presentations = [],
  defaultValue = '',
  placeholder = 'Search presentations, topics, tags…',
  size = 'default',
  autoFocus = false,
  live = false,
  liveDelay = 250,
  onSearch,
  className,
}) {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const containerRef = useRef(null);
  const [query, setQuery] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [recent, setRecent] = useState(readRecent);

  useEffect(() => setQuery(defaultValue), [defaultValue]);

  // On pages that filter in place (the Library), results follow typing after a
  // short pause instead of waiting for Enter.
  useEffect(() => {
    if (!live || !onSearch || query === defaultValue) return undefined;
    const timer = setTimeout(() => onSearch(query.trim()), liveDelay);
    return () => clearTimeout(timer);
  }, [live, liveDelay, onSearch, query, defaultValue]);

  const suggestions = useMemo(
    () => searchPresentations(presentations, query),
    [presentations, query]
  );

  const showRecent = query.trim().length === 0 && recent.length > 0;
  const items = showRecent ? recent : suggestions;

  // Cmd/Ctrl+K focuses the field from anywhere on the page.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    const onClickAway = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickAway);
    return () => document.removeEventListener('mousedown', onClickAway);
  }, []);

  const submit = useCallback(
    (term) => {
      const value = (term ?? query).trim();
      setRecent(pushRecent(value));
      setOpen(false);
      setActiveIndex(-1);
      if (onSearch) onSearch(value);
      else navigate(value ? `/library?q=${encodeURIComponent(value)}` : '/library');
    },
    [navigate, onSearch, query]
  );

  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && items[activeIndex]) {
        const item = items[activeIndex];
        if (showRecent) {
          setQuery(item);
          submit(item);
        } else {
          setOpen(false);
          navigate(`/presentation/${item.id}`);
        }
        return;
      }
      submit();
    } else if (e.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    }
  };

  const tall = size === 'lg';

  return (
    <div ref={containerRef} className={cn('relative w-full', className)}>
      <div
        className={cn(
          'flex items-center gap-2 rounded-2xl glass px-4 transition-shadow focus-within:ring-2 focus-within:ring-primary/50',
          tall ? 'h-14' : 'h-11'
        )}
      >
        <Search className={cn('shrink-0 text-muted-foreground', tall ? 'h-5 w-5' : 'h-4 w-4')} />
        <input
          ref={inputRef}
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label="Search presentations"
          className={cn(
            'min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground',
            tall ? 'text-base' : 'text-sm'
          )}
        />
        {query && (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="rounded-full p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
        <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground sm:inline-block">
          ⌘K
        </kbd>
      </div>

      <AnimatePresence>
        {open && items.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.14 }}
            className="absolute inset-x-0 top-full z-50 mt-2 overflow-hidden rounded-2xl glass-strong shadow-2xl"
          >
            {showRecent ? (
              <div className="p-1.5">
                <p className="px-2.5 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recent searches
                </p>
                {recent.map((term, i) => (
                  <button
                    key={term}
                    type="button"
                    onMouseEnter={() => setActiveIndex(i)}
                    onClick={() => {
                      setQuery(term);
                      submit(term);
                    }}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm',
                      activeIndex === i ? 'bg-secondary' : 'hover:bg-secondary/60'
                    )}
                  >
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{term}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="p-1.5">
                {suggestions.map((p, i) => {
                  const domain = getDomain(p.primary_domain);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onMouseEnter={() => setActiveIndex(i)}
                      onClick={() => {
                        setOpen(false);
                        navigate(`/presentation/${p.id}`);
                      }}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left',
                        activeIndex === i ? 'bg-secondary' : 'hover:bg-secondary/60'
                      )}
                    >
                      <span
                        className={cn(
                          'grid h-9 w-12 shrink-0 place-items-center rounded-lg bg-gradient-to-br text-[9px] font-bold text-white',
                          domain.gradient
                        )}
                      >
                        {(p.file_type || 'pdf').toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {p.primary_domain}
                          {p.sub_domain ? ` · ${p.sub_domain}` : ''}
                        </span>
                      </span>
                    </button>
                  );
                })}
                <button
                  type="button"
                  onClick={() => submit()}
                  className="mt-1 flex w-full items-center justify-between gap-2 rounded-xl border-t border-border px-2.5 py-2 text-left text-xs text-muted-foreground hover:bg-secondary/60"
                >
                  <span>
                    See all results for <strong className="text-foreground">{query}</strong>
                  </span>
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
