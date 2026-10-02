import { AnimatePresence, motion } from 'framer-motion';
import { AlertTriangle, CheckCircle2, Cloud, Sparkles, Upload } from 'lucide-react';
import { cn } from '@/lib/utils';
import { timeAgo } from '@/components/admin/adminFormat';
import { initials } from '@/components/shell/UserBadge';

const KIND = {
  ai: { icon: Sparkles, tone: 'bg-violet-500/15 text-violet-600 dark:text-violet-300 ring-violet-400/40', who: 'AI' },
  upload: { icon: Upload, tone: 'bg-slate-500/15 text-slate-600 dark:text-slate-300 ring-slate-400/40', who: 'Upload' },
  sync: { icon: Cloud, tone: 'bg-sky-500/15 text-sky-600 dark:text-sky-300 ring-sky-400/40', who: 'Dropbox' },
  success: { icon: CheckCircle2, tone: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 ring-emerald-400/40', who: 'Review' },
  error: { icon: AlertTriangle, tone: 'bg-rose-500/15 text-rose-600 dark:text-rose-300 ring-rose-400/40', who: 'Pipeline' },
  warn: { icon: AlertTriangle, tone: 'bg-amber-500/15 text-amber-600 dark:text-amber-300 ring-amber-400/40', who: 'Learner' },
  user: { icon: null, tone: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white ring-violet-400/40', who: 'Learner' },
};

export default function SystemActivity({ events }) {
  return (
    <section className="glass tone-idle p-4 sm:p-5 min-w-0">
      <h2 className="font-semibold mb-3">System activity</h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Uploads, generation, reviews and learner results will appear here.</p>
      ) : (
        <ol className="max-h-[26rem] overflow-y-auto -mr-2 pr-2 space-y-0.5 [scrollbar-width:thin]">
          <AnimatePresence initial={false}>
            {events.slice(0, 40).map((e) => {
              const k = KIND[e.kind] || KIND.ai;
              const Icon = k.icon;
              return (
                <motion.li
                  key={e.id} layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  whileHover={{ scale: 1.01 }}
                  className="flex items-center gap-3 rounded-xl px-2 py-2 hover:bg-muted/40 transition-colors"
                >
                  <span className={cn('w-8 h-8 rounded-full ring-1 flex items-center justify-center shrink-0 text-[10px] font-bold', k.tone)}>
                    {Icon ? <Icon className="w-4 h-4" /> : initials(e.who || '?')}
                  </span>
                  <p className="text-sm min-w-0 flex-1 line-clamp-2 [overflow-wrap:anywhere]">{e.text}</p>
                  <span className="text-[11px] text-muted-foreground shrink-0 whitespace-nowrap">{timeAgo(e.at)}</span>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}
