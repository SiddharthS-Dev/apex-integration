import { motion, useReducedMotion } from 'framer-motion';
import { Check, Layers } from 'lucide-react';
import { cn } from '@/lib/utils';
import { STAGES, stageIndex } from './hubData';

// Error card backdrop: fracture lines radiating from an impact point.
export function ShatteredGlass({ className }) {
  const cracks = [
    'M120 70 L40 10', 'M120 70 L10 60', 'M120 70 L30 130', 'M120 70 L110 150', 'M120 70 L200 140',
    'M120 70 L240 90', 'M120 70 L230 20', 'M120 70 L150 0', 'M80 40 L60 70 L30 80', 'M170 110 L190 80 L230 70',
    'M100 110 L70 120', 'M150 40 L180 45',
  ];
  return (
    <svg viewBox="0 0 240 150" preserveAspectRatio="xMidYMid slice" className={cn('pointer-events-none', className)} aria-hidden="true">
      <defs>
        <radialGradient id="crack-glow" cx="50%" cy="46%" r="55%">
          <stop offset="0" stopColor="rgb(244 63 94)" stopOpacity=".35" />
          <stop offset="1" stopColor="rgb(244 63 94)" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="240" height="150" fill="url(#crack-glow)" />
      <g stroke="rgb(253 164 175)" strokeOpacity=".35" strokeWidth=".8" fill="none">
        {cracks.map((d) => <path key={d} d={d} />)}
      </g>
      <circle cx="120" cy="70" r="3" fill="rgb(253 164 175)" fillOpacity=".6" />
    </svg>
  );
}

// Circular tracker for the real pipeline stages; nodes light up as each checkpoint passes.
export function StageRing({ progress = 0, idle = false, size = 212 }) {
  const reduce = useReducedMotion();
  const current = idle ? -1 : stageIndex(progress);
  const r = 62;
  const c = 2 * Math.PI * r;
  const pct = idle ? 0 : Math.max(4, Math.min(100, progress));
  const nodes = STAGES.map((s, i) => {
    const angle = (-90 + (360 / STAGES.length) * i) * (Math.PI / 180);
    return { ...s, i, x: 50 + 40 * Math.cos(angle), y: 50 + 40 * Math.sin(angle) };
  });

  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 160 160" className="absolute inset-[24%] w-[52%] h-[52%] -rotate-90" aria-hidden="true">
        <circle cx="80" cy="80" r={r} fill="none" stroke="rgb(var(--glow) / 0.12)" strokeWidth="10" />
        <motion.circle
          cx="80" cy="80" r={r} fill="none" stroke="url(#ring-grad)" strokeWidth="10" strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: c * (1 - pct / 100) }}
          transition={{ duration: reduce ? 0 : 1.2, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: 'drop-shadow(0 0 6px rgb(var(--glow) / .7))' }}
        />
        <circle cx="80" cy="80" r="46" fill="none" stroke="rgb(var(--glow) / 0.25)" strokeWidth="1" strokeDasharray="2 5" />
        <defs>
          <linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#22d3ee" />
            <stop offset="1" stopColor="#10b981" />
          </linearGradient>
        </defs>
      </svg>

      <div className="absolute inset-0 flex items-center justify-center">
        <motion.div
          className="w-12 h-12 rounded-2xl flex items-center justify-center bg-[rgb(var(--glow)/0.12)] ring-1 ring-[rgb(var(--glow)/0.35)] neon-text"
          animate={idle || reduce ? {} : { rotate: [0, 6, -6, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Layers className="w-6 h-6" />
        </motion.div>
      </div>

      {nodes.map((n) => {
        const done = n.i < current;
        const active = n.i === current;
        return (
          <div
            key={n.label}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-0.5"
            style={{ left: `${n.x}%`, top: `${n.y}%` }}
          >
            <span
              className={cn(
                'w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-bold ring-1 transition-colors',
                done && 'bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 ring-emerald-400/50',
                active && 'bg-[rgb(var(--glow)/0.25)] neon-text ring-[rgb(var(--glow)/0.7)] motion-safe:animate-pulse',
                !done && !active && 'bg-muted/60 text-muted-foreground ring-border',
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" strokeWidth={3} /> : n.i + 1}
            </span>
            <span className={cn('text-[9px] leading-none whitespace-nowrap', active ? 'neon-text font-semibold' : 'text-muted-foreground')}>
              {n.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// Finished playbook: a small stack of course books with a gentle float.
export function BookStack({ className, count = 3 }) {
  const reduce = useReducedMotion();
  const books = [
    { w: '88%', from: '#059669', to: '#10b981' },
    { w: '80%', from: '#0f766e', to: '#14b8a6' },
    { w: '92%', from: '#065f46', to: '#34d399' },
  ].slice(0, count);
  return (
    <motion.div
      className={cn('relative flex flex-col-reverse items-center gap-1 [perspective:600px]', className)}
      animate={reduce ? {} : { y: [0, -4, 0] }}
      transition={{ duration: 5, repeat: Infinity, ease: 'easeInOut' }}
      aria-hidden="true"
    >
      {books.map((b, i) => (
        <div
          key={i}
          className="h-5 rounded-[5px] shadow-lg shadow-emerald-900/40 [transform:rotateX(38deg)_rotateZ(-8deg)] relative overflow-hidden"
          style={{ width: b.w, background: `linear-gradient(90deg, ${b.from}, ${b.to})`, marginLeft: i % 2 ? '8%' : 0 }}
        >
          <div className="absolute right-1.5 inset-y-1 w-[38%] rounded-sm bg-emerald-50/85" />
          <div className="absolute left-2 top-1/2 -translate-y-1/2 h-0.5 w-6 rounded bg-white/60" />
        </div>
      ))}
      <div className="absolute -bottom-3 inset-x-2 h-4 rounded-[50%] bg-emerald-500/30 blur-md" />
    </motion.div>
  );
}
