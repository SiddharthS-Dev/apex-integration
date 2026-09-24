import { memo } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, Star, Download, Clock, FileText } from 'lucide-react';
import { getDomain, FILE_TYPE_STYLE } from '@/lib/domains';
import { cn, timeAgo, truncate } from '@/lib/utils';

/** Gradient placeholder used whenever Dropbox has not produced a thumbnail. */
function ThumbFallback({ presentation, className, textClass = 'text-sm' }) {
  const domain = getDomain(presentation.primary_domain);
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center bg-gradient-to-br p-3 text-center',
        domain.gradient,
        className
      )}
    >
      <span className={cn('line-clamp-3 font-semibold leading-tight text-white/95 drop-shadow', textClass)}>
        {presentation.title}
      </span>
    </div>
  );
}

function Thumb({ presentation, className, textClass }) {
  if (presentation.thumbnail_url) {
    return (
      <img
        src={presentation.thumbnail_url}
        alt=""
        loading="lazy"
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return <ThumbFallback presentation={presentation} className={className} textClass={textClass} />;
}

function FileTypeBadge({ type }) {
  if (!type) return null;
  return (
    <span
      className={cn(
        'rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase ring-1 ring-inset backdrop-blur',
        FILE_TYPE_STYLE[type] || FILE_TYPE_STYLE.pdf
      )}
    >
      {type}
    </span>
  );
}

function PresentationCard({
  presentation,
  variant = 'grid',
  isOffline = false,
  isFavorite = false,
  progress = 0,
  onToggleFavorite,
  className,
}) {
  if (!presentation) return null;
  const domain = getDomain(presentation.primary_domain);
  const to = `/presentation/${presentation.id}`;

  const favoriteButton = onToggleFavorite ? (
    <button
      type="button"
      aria-label={isFavorite ? 'Remove from favourites' : 'Add to favourites'}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(presentation.id);
      }}
      className="rounded-full bg-black/40 p-1.5 text-white/90 backdrop-blur transition-colors hover:bg-black/60"
    >
      <Star className={cn('h-3.5 w-3.5', isFavorite && 'fill-amber-400 text-amber-400')} />
    </button>
  ) : null;

  /* --------------------------------------------------------------- compact */
  if (variant === 'compact') {
    return (
      <Link
        to={to}
        className={cn(
          'group flex items-center gap-3 rounded-xl p-2 transition-colors hover:bg-secondary/60',
          className
        )}
      >
        <div className="h-12 w-16 shrink-0 overflow-hidden rounded-lg ring-1 ring-border">
          <Thumb presentation={presentation} textClass="text-[9px]" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium group-hover:text-primary">{presentation.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {presentation.primary_domain}
            {presentation.sub_domain ? ` · ${presentation.sub_domain}` : ''}
          </p>
        </div>
        {isOffline && <Download className="h-3.5 w-3.5 shrink-0 text-emerald-400" />}
      </Link>
    );
  }

  /* ------------------------------------------------------------------ list */
  if (variant === 'list') {
    return (
      <motion.div whileHover={{ y: -2 }} transition={{ type: 'spring', stiffness: 400, damping: 28 }}>
        <Link
          to={to}
          className={cn('group flex gap-4 rounded-2xl glass p-3 transition-shadow hover:shadow-xl', className)}
        >
          <div className="relative aspect-video w-40 shrink-0 overflow-hidden rounded-xl ring-1 ring-border">
            <Thumb presentation={presentation} textClass="text-[11px]" />
            <div className="absolute left-1.5 top-1.5">
              <FileTypeBadge type={presentation.file_type} />
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
            <div className="min-w-0">
              <h3 className="truncate font-semibold group-hover:text-primary">{presentation.title}</h3>
              <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
                {presentation.ai_summary || presentation.description}
              </p>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r px-2 py-0.5 font-medium text-white',
                  domain.gradient
                )}
              >
                {presentation.primary_domain}
              </span>
              {presentation.sub_domain && <span>{presentation.sub_domain}</span>}
              <span className="inline-flex items-center gap-1">
                <Eye className="h-3 w-3" /> {presentation.view_count || 0}
              </span>
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3 w-3" /> {timeAgo(presentation.modified_date || presentation.created_date)}
              </span>
              {isOffline && (
                <span className="inline-flex items-center gap-1 text-emerald-400">
                  <Download className="h-3 w-3" /> Offline
                </span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-start">{favoriteButton}</div>
        </Link>
      </motion.div>
    );
  }

  /* ------------------------------------------------------------------ grid */
  return (
    <motion.div
      whileHover={{ y: -4 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={cn('h-full', className)}
    >
      <Link
        to={to}
        className="group flex h-full flex-col overflow-hidden rounded-2xl glass transition-shadow hover:shadow-2xl hover:shadow-primary/10"
      >
        <div className="relative aspect-video w-full overflow-hidden">
          <Thumb presentation={presentation} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 transition-opacity group-hover:opacity-100" />

          <div className="absolute left-2 top-2 flex items-center gap-1.5">
            <FileTypeBadge type={presentation.file_type} />
            {isOffline && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-bold uppercase text-emerald-300 ring-1 ring-inset ring-emerald-500/30 backdrop-blur">
                <Download className="h-2.5 w-2.5" /> Offline
              </span>
            )}
          </div>

          <div className="absolute right-2 top-2">{favoriteButton}</div>

          {progress > 0 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/40">
              <div
                className="h-full bg-gradient-to-r from-indigo-400 to-fuchsia-400"
                style={{ width: `${Math.min(100, progress)}%` }}
              />
            </div>
          )}
        </div>

        <div className="flex flex-1 flex-col gap-2 p-3.5">
          <div className="flex items-center justify-between gap-2">
            <span
              className={cn(
                'truncate rounded-full bg-gradient-to-r px-2 py-0.5 text-[10px] font-semibold text-white',
                domain.gradient
              )}
            >
              {presentation.primary_domain || 'Uncategorized'}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
              <Eye className="h-3 w-3" />
              {presentation.view_count || 0}
            </span>
          </div>

          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug group-hover:text-primary">
            {presentation.title}
          </h3>

          <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
            {truncate(presentation.ai_summary || presentation.description || '', 150)}
          </p>

          <div className="mt-auto flex flex-wrap items-center gap-1 pt-1">
            {(presentation.tags || []).slice(0, 3).map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
            {presentation.slide_count > 0 && (
              <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                <FileText className="h-2.5 w-2.5" /> {presentation.slide_count}
              </span>
            )}
          </div>
        </div>
      </Link>
    </motion.div>
  );
}

export default memo(PresentationCard);
