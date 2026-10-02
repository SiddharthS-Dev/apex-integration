import { Link } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import {
  AlertTriangle, ArrowRight, BookOpen, Download, FileText, GitCompare, Loader2, MonitorPlay, MoreVertical, Play,
  RotateCcw, ScrollText, Trash2,
} from 'lucide-react';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import PlaybookSourceBadge from '@/components/admin/playbooks/PlaybookSourceBadge';
import { BookStack, ShatteredGlass, StageRing } from './HubVisuals';
import { READY_LABEL, STAGES, isStalled, stageIndex } from './hubData';

const TONE = { error: 'tone-error', processing: 'tone-processing', queued: 'tone-idle', ready: 'tone-success', archived: 'tone-muted' };

const btn = 'inline-flex items-center justify-center gap-2 rounded-xl px-3.5 h-10 text-sm font-medium transition-all duration-200 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--glow))] disabled:opacity-50 disabled:pointer-events-none [&_svg]:w-4 [&_svg]:h-4 [&_svg]:shrink-0';
export const BTN = {
  glow: cn(btn, 'border border-[rgb(var(--glow)/0.6)] bg-[rgb(var(--glow)/0.1)] neon-text shadow-[0_0_18px_-4px_rgb(var(--glow)/0.7)] hover:shadow-[0_0_26px_-2px_rgb(var(--glow)/0.9)] hover:bg-[rgb(var(--glow)/0.18)]'),
  solid: cn(btn, 'bg-[rgb(var(--glow))] text-white shadow-[0_8px_26px_-6px_rgb(var(--glow)/0.85)] hover:shadow-[0_12px_34px_-4px_rgb(var(--glow))] hover:brightness-110'),
  ghost: cn(btn, 'border border-[hsl(var(--glass-line))] bg-background/30 text-foreground/90 hover:bg-[rgb(var(--glow)/0.08)] hover:border-[rgb(var(--glow)/0.4)]'),
};

function CardMenu({ playbook, onDownload, onDelete, onProcess, busy }) {
  const canRun = playbook.status !== 'archived' && (playbook.status !== 'processing' || isStalled(playbook, busy));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`More actions for ${playbook.title}`}
        className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-[rgb(var(--glow)/0.12)] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[rgb(var(--glow))]"
      >
        <MoreVertical className="w-4 h-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link to={`/admin/studio/${playbook.id}`}><MonitorPlay /> Open Content Studio</Link></DropdownMenuItem>
        <DropdownMenuItem asChild><Link to={`/admin/playbooks/${playbook.id}/versions`}><GitCompare /> Versions</Link></DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onDownload(playbook)}><Download /> Download source</DropdownMenuItem>
        {canRun && (
          <DropdownMenuItem disabled={busy} onSelect={() => onProcess(playbook)}><RotateCcw /> Process again</DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onDelete(playbook)} className="text-rose-600 focus:text-rose-600 dark:text-rose-400"><Trash2 /> Delete</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CardHead({ playbook, menu }) {
  const path = playbook.source === 'dropbox' && playbook.dropbox_path ? playbook.dropbox_path : playbook.file_name;
  return (
    <div className="relative flex items-start gap-3">
      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 bg-[rgb(var(--glow)/0.12)] ring-1 ring-[rgb(var(--glow)/0.35)] neon-text">
        <FileText className="w-5 h-5" />
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold leading-snug line-clamp-2 [overflow-wrap:anywhere]" title={playbook.title}>{playbook.title}</h3>
        <div className="flex items-center gap-1.5 mt-1 min-w-0">
          <PlaybookSourceBadge source={playbook.source} />
          <span className="text-[11px] text-muted-foreground truncate" title={path}>{path}</span>
        </div>
      </div>
      {menu}
    </div>
  );
}

function ErrorBody({ playbook, busy, onProcess, onShowError }) {
  const tooBig = /exceeds the extraction limit/i.test(playbook.error || '');
  return (
    <>
      <div className="relative rounded-xl border border-rose-500/30 bg-rose-500/[0.07] backdrop-blur-md p-3" role="alert">
        <div className="flex items-center gap-1.5 text-xs font-semibold neon-text"><AlertTriangle className="w-3.5 h-3.5" /> Extraction error</div>
        <p className="text-xs text-foreground/85 mt-1 line-clamp-3 [overflow-wrap:anywhere]">{playbook.error || 'Processing failed without an error message.'}</p>
        {tooBig && <p className="text-[11px] text-muted-foreground mt-1.5">Retrying won&apos;t help until the file is smaller or the server&apos;s MAX_EXTRACT_MB limit is raised.</p>}
      </div>
      <div className="relative grid gap-2 mt-auto">
        <button type="button" className={BTN.glow} disabled={busy} onClick={() => onProcess(playbook)}>
          {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Retry processing
        </button>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={BTN.ghost} onClick={() => onShowError(playbook)}><ScrollText /> Error log</button>
          <Link to={`/admin/playbooks/${playbook.id}/versions`} className={BTN.ghost}><GitCompare /> Versions</Link>
        </div>
      </div>
    </>
  );
}

function ProcessingBody({ playbook, queued, busy, onProcess }) {
  const progress = playbook.progress || 0;
  const stage = STAGES[stageIndex(progress)];
  const stalled = isStalled(playbook, busy);
  return (
    <>
      <StageRing progress={progress} idle={queued} />
      <div className="relative mt-auto space-y-3">
        {queued ? (
          <button type="button" className={cn(BTN.solid, 'w-full')} disabled={busy} onClick={() => onProcess(playbook)}>
            {busy ? <Loader2 className="animate-spin" /> : <Play />} Process now
          </button>
        ) : stalled ? (
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={BTN.glow} onClick={() => onProcess(playbook)}><RotateCcw /> Restart</button>
            <Link to={`/admin/studio/${playbook.id}`} className={BTN.ghost}><MonitorPlay /> Monitor</Link>
          </div>
        ) : (
          <Link to={`/admin/studio/${playbook.id}`} className={cn(BTN.glow, 'w-full')}><MonitorPlay /> Live build monitor</Link>
        )}
        <div>
          <div className="h-1.5 rounded-full bg-[rgb(var(--glow)/0.15)] overflow-hidden">
            <div
              className="h-full rounded-full bg-gradient-to-r from-sky-500 to-cyan-300 transition-[width] duration-700 shadow-[0_0_10px_rgb(var(--glow))]"
              style={{ width: `${queued ? 0 : progress}%` }}
            />
          </div>
          <p className="text-xs mt-2 min-h-[2.5em]">
            {queued ? (
              <span className="text-muted-foreground">Waiting to be processed — extraction hasn&apos;t started.</span>
            ) : stalled ? (
              <span className="text-amber-600 dark:text-amber-300">
                Stuck at {progress}% ({stage.active.toLowerCase()}) — no progress for {formatDistanceToNow(new Date(playbook.updated_date))}. The run has likely stopped; restart it.
              </span>
            ) : (
              <>
                <span className="neon-text font-semibold motion-safe:animate-pulse">Processing · {progress}%</span>
                <span className="text-muted-foreground"> — {stage.active}…</span>
              </>
            )}
          </p>
        </div>
      </div>
    </>
  );
}

function ReadyBody({ playbook, course, onDownload }) {
  const archived = playbook.status === 'archived';
  const primary = course?.status === 'published'
    ? { to: `/courses/${course.id}`, label: 'Open course', icon: BookOpen }
    : { to: `/admin/studio/${playbook.id}`, label: playbook.status === 'processed' ? 'Build course in Studio' : 'Review in Content Studio', icon: MonitorPlay };
  const Icon = primary.icon;
  return (
    <>
      <div className="relative flex items-center gap-3">
        <div className="flex-1 min-w-0 space-y-3">
          <div>
            <div className="text-xs text-muted-foreground">Chapters</div>
            <div className="text-4xl font-bold tracking-tight tabular-nums leading-tight">{playbook.chapter_count || 0}</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Status</div>
            <div className="text-base font-semibold neon-text">{archived ? 'Archived' : READY_LABEL[playbook.status] || 'Processed'}</div>
            {course && <div className="text-[11px] text-muted-foreground truncate mt-0.5" title={course.title}>Course: {course.title}</div>}
          </div>
        </div>
        {!archived && <BookStack className="w-28 shrink-0" />}
      </div>
      <div className="relative grid gap-2 mt-auto">
        {!archived && (
          <Link to={primary.to} className={cn(BTN.solid, 'group/cta w-full')}>
            <Icon /> {primary.label}
            <ArrowRight className="transition-transform group-hover/cta:translate-x-1" />
          </Link>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={BTN.ghost} onClick={() => onDownload(playbook)}><Download /> Source</button>
          <Link to={`/admin/playbooks/${playbook.id}/versions`} className={BTN.ghost}><GitCompare /> Versions</Link>
        </div>
      </div>
    </>
  );
}

export default function PlaybookHubCard({ playbook, variant, course, busy, onProcess, onDownload, onDelete, onShowError }) {
  const menu = <CardMenu playbook={playbook} busy={busy} onProcess={onProcess} onDownload={onDownload} onDelete={onDelete} />;
  const stacked = variant === 'processing';
  return (
    <article className={cn('relative', TONE[variant], variant === 'archived' && 'opacity-70')}>
      {stacked && (
        <>
          <div aria-hidden="true" className="glass absolute inset-x-4 -bottom-3 h-full opacity-50" />
          <div aria-hidden="true" className="glass absolute inset-x-2 -bottom-1.5 h-full opacity-70" />
        </>
      )}
      <div className="glass glass-glow glass-lift relative overflow-hidden p-5 flex flex-col gap-4 h-full min-h-[430px]">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(90% 60% at 50% 0%, rgb(var(--glow) / 0.16), transparent 70%)' }}
        />
        {variant === 'error' && <ShatteredGlass className="absolute inset-x-0 top-40 h-56 w-full opacity-80" />}
        <CardHead playbook={playbook} menu={menu} />
        {variant === 'error' && <ErrorBody playbook={playbook} busy={busy} onProcess={onProcess} onShowError={onShowError} />}
        {(variant === 'processing' || variant === 'queued') && (
          <ProcessingBody playbook={playbook} queued={variant === 'queued'} busy={busy} onProcess={onProcess} />
        )}
        {(variant === 'ready' || variant === 'archived') && <ReadyBody playbook={playbook} course={course} onDownload={onDownload} />}
        {playbook.updated_date && (
          <div className="relative text-[10px] text-muted-foreground -mt-1">
            Updated {formatDistanceToNow(new Date(playbook.updated_date), { addSuffix: true })}
          </div>
        )}
      </div>
    </article>
  );
}
