import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import PresentationCard from '@/components/PresentationCard';
import { SkeletonScrollRow } from '@/components/SkeletonCard';
import { cn } from '@/lib/utils';

/**
 * Horizontal, snap-scrolling shelf used by every "Continue reading / Trending /
 * Recently added" style section.
 */
export default function ScrollRow({
  title,
  icon: Icon,
  items = [],
  decorate,
  onToggleFavorite,
  loading = false,
  seeAllTo,
  emptyMessage,
  cardWidth = 'w-[260px]',
  action,
  children,
}) {
  const scroller = useRef(null);

  const nudge = (dir) => {
    scroller.current?.scrollBy({ left: dir * (scroller.current.clientWidth * 0.8), behavior: 'smooth' });
  };

  if (!loading && items.length === 0 && !emptyMessage) return null;

  return (
    <section className="space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight sm:text-xl">
          {Icon && <Icon className="h-5 w-5 text-primary" />}
          {title}
        </h2>
        <div className="flex items-center gap-1">
          {action}
          {seeAllTo && (
            <Link
              to={seeAllTo}
              className="rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              See all
            </Link>
          )}
          <div className="hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => nudge(-1)}
              aria-label="Scroll left"
              className="grid h-8 w-8 place-items-center rounded-full glass transition-colors hover:bg-card/80"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => nudge(1)}
              aria-label="Scroll right"
              className="grid h-8 w-8 place-items-center rounded-full glass transition-colors hover:bg-card/80"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {children}

      {loading ? (
        <SkeletonScrollRow />
      ) : items.length === 0 ? (
        <p className="rounded-2xl glass px-4 py-6 text-sm text-muted-foreground">{emptyMessage}</p>
      ) : (
        <div ref={scroller} className="scroll-row no-scrollbar">
          {items.map((p) => {
            const meta = decorate ? decorate(p) : { presentation: p };
            return (
              <div key={p.id} className={cn('shrink-0 snap-start', cardWidth)}>
                <PresentationCard
                  presentation={p}
                  isOffline={meta.isOffline}
                  isFavorite={meta.isFavorite}
                  progress={meta.progress}
                  onToggleFavorite={onToggleFavorite}
                />
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
