import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Cpu, FileText, Layers, ScanText, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

const ICONS = { upload: FileText, extract: ScanText, course: Layers, ai: Cpu, review: UserCheck, approved: CheckCircle2 };
const TONE = {
  violet: 'text-violet-500 dark:text-violet-300 ring-violet-400/50 bg-violet-500/10',
  sky: 'text-sky-500 dark:text-sky-300 ring-sky-400/50 bg-sky-500/10',
  amber: 'text-amber-500 dark:text-amber-300 ring-amber-400/50 bg-amber-500/10',
  emerald: 'text-emerald-500 dark:text-emerald-300 ring-emerald-400/50 bg-emerald-500/10',
  rose: 'text-rose-500 dark:text-rose-300 ring-rose-400/50 bg-rose-500/10',
};

// Node-and-edge diagram of the real content pipeline. Stages with running work pulse, and a
// dot travels along the edge feeding them.
export default function PipelineDiagram({ stages, compact = false }) {
  const reduce = useReducedMotion();
  return (
    <div className="relative">
      <div className={cn('grid gap-y-6', compact ? 'grid-cols-3 sm:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6')}>
        {stages.map((s, i) => {
          const Icon = ICONS[s.key];
          return (
            <div key={s.key} className="relative flex flex-col items-center text-center px-1">
              {i < stages.length - 1 && (
                <div aria-hidden="true" className={cn('hidden absolute top-7 left-[calc(50%+30px)] right-[calc(-50%+30px)] h-px bg-gradient-to-r from-violet-400/60 to-sky-400/60', compact ? 'sm:block' : 'lg:block')}>
                  {stages[i + 1].active && !reduce && (
                    <motion.span
                      className="absolute -top-[3px] w-1.5 h-1.5 rounded-full bg-sky-300 shadow-[0_0_8px_2px_rgb(56_189_248/0.8)]"
                      animate={{ left: ['0%', '100%'] }}
                      transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
                    />
                  )}
                </div>
              )}
              <motion.div
                className={cn('relative w-14 h-14 rounded-2xl ring-1 flex items-center justify-center backdrop-blur', TONE[s.tone])}
                whileHover={{ scale: 1.06 }}
              >
                {s.active && !reduce && (
                  <motion.span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-2xl ring-2 ring-current"
                    animate={{ opacity: [0.7, 0], scale: [1, 1.35] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: 'easeOut' }}
                  />
                )}
                <Icon className="w-6 h-6" />
              </motion.div>
              <div className="mt-2 text-xs font-semibold leading-tight">{s.label}</div>
              <div className="text-lg font-bold tabular-nums leading-tight">{s.value}</div>
              <div className="text-[10px] text-muted-foreground leading-tight">{s.sub}</div>
              {s.active && <div className="mt-1 text-[10px] font-semibold text-sky-500 dark:text-sky-300 motion-safe:animate-pulse">● Active</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
