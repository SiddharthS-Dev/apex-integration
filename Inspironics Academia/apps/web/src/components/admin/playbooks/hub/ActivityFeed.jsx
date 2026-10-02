import { AnimatePresence, motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { AlertTriangle, CheckCircle2, Cloud, History, Sparkles, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';

const KIND = {
  ai: { icon: Sparkles, tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-violet-400/40', who: 'Pipeline' },
  dropbox: { icon: Cloud, tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-sky-400/40', who: 'Dropbox' },
  upload: { icon: Upload, tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-slate-400/40', who: 'Upload' },
  error: { icon: AlertTriangle, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-rose-400/40', who: 'Pipeline' },
  'sync-error': { icon: AlertTriangle, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-rose-400/40', who: 'Dropbox' },
  success: { icon: CheckCircle2, tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-400/40', who: 'Publish' },
};

export default function ActivityFeed({ events }) {
  return (
    <aside className="glass tone-idle p-4 sm:p-5 flex flex-col min-h-0 xl:max-h-[calc(100vh-7rem)] xl:sticky xl:top-20">
      <h2 className="font-semibold flex items-center gap-2 mb-4">
        <History className="w-4 h-4 neon-text" /> Recent Activity
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Uploads, Dropbox syncs and processing runs will appear here.</p>
      ) : (
        <ol className="relative overflow-y-auto -mr-2 pr-2 space-y-1 [scrollbar-width:thin]">
          <span aria-hidden="true" className="absolute left-[17px] top-2 bottom-2 w-px bg-gradient-to-b from-violet-400/40 via-sky-400/20 to-transparent" />
          <AnimatePresence initial={false}>
            {events.slice(0, 20).map((e) => {
              const k = KIND[e.kind] || KIND.ai;
              const Icon = k.icon;
              return (
                <motion.li
                  key={e.id}
                  layout
                  initial={{ opacity: 0, y: -14 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                  className="relative flex gap-3 rounded-xl p-1.5 hover:bg-muted/40 transition-colors"
                >
                  <span className={cn('relative z-10 w-8 h-8 rounded-full ring-1 flex items-center justify-center shrink-0 backdrop-blur', k.tone)}>
                    <Icon className="w-4 h-4" />
                  </span>
                  <div className="min-w-0 pt-0.5">
                    <p className="text-[13px] leading-snug line-clamp-3 [overflow-wrap:anywhere]">{e.text}</p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {k.who} · {formatDistanceToNow(new Date(e.at), { addSuffix: true })}
                    </p>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </aside>
  );
}
