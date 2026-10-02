import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, useInView, useReducedMotion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Accent palette shared by icon tiles, bars and badges.
export const TONES = {
  violet: { tile: 'bg-violet-500/10 text-violet-600 dark:text-violet-300 ring-violet-500/25', bar: 'from-indigo-500 to-violet-500', text: 'text-violet-600 dark:text-violet-300' },
  cyan: { tile: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-300 ring-cyan-500/25', bar: 'from-sky-500 to-cyan-400', text: 'text-cyan-600 dark:text-cyan-300' },
  green: { tile: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 ring-emerald-500/25', bar: 'from-emerald-500 to-teal-400', text: 'text-emerald-600 dark:text-emerald-300' },
  orange: { tile: 'bg-orange-500/10 text-orange-600 dark:text-orange-300 ring-orange-500/25', bar: 'from-orange-500 to-amber-400', text: 'text-orange-600 dark:text-orange-300' },
  blue: { tile: 'bg-blue-500/10 text-blue-600 dark:text-blue-300 ring-blue-500/25', bar: 'from-blue-500 to-indigo-500', text: 'text-blue-600 dark:text-blue-300' },
};

export function Panel({ as: Tag = 'section', className, children, ...props }) {
  return <Tag className={cn('dash-panel p-4 sm:p-5', className)} {...props}>{children}</Tag>;
}

export function IconTile({ icon: Icon, tone = 'violet', size = 'md', className }) {
  const box = size === 'lg' ? 'w-12 h-12 rounded-2xl' : size === 'sm' ? 'w-8 h-8 rounded-lg' : 'w-10 h-10 rounded-xl';
  const glyph = size === 'lg' ? 'w-6 h-6' : size === 'sm' ? 'w-4 h-4' : 'w-5 h-5';
  return (
    <div className={cn('shrink-0 flex items-center justify-center ring-1 ring-inset', box, TONES[tone].tile, className)}>
      <Icon className={glyph} />
    </div>
  );
}

export function SectionHeader({ icon: Icon, tone = 'violet', title, subtitle, action, className }) {
  return (
    <div className={cn('flex items-start justify-between gap-3 mb-4', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {Icon && <Icon className={cn('w-5 h-5 mt-0.5 shrink-0', TONES[tone].text)} />}
        <div className="min-w-0">
          <h2 className="text-base font-semibold tracking-tight leading-6">{title}</h2>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {action}
    </div>
  );
}

export function HeaderLink({ to, children }) {
  return (
    <Link to={to} className="group shrink-0 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline underline-offset-4">
      {children}
      <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

// Progress bar that fills from zero the first time it scrolls into view.
export function ProgressBar({ value = 0, tone = 'violet', className }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div ref={ref} className={cn('dash-track', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <motion.div
        className={cn('h-full rounded-full bg-gradient-to-r', TONES[tone].bar)}
        initial={{ width: reduce ? `${pct}%` : 0 }}
        animate={{ width: inView || reduce ? `${pct}%` : 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}

// Counts up to a numeric value once; non-numeric values render as-is.
export function CountUp({ value, suffix = '' }) {
  const reduce = useReducedMotion();
  const numeric = typeof value === 'number' && Number.isFinite(value);
  const [shown, setShown] = useState(numeric && !reduce ? 0 : value);
  useEffect(() => {
    if (!numeric || reduce) { setShown(value); return undefined; }
    let frame;
    const start = performance.now();
    const tick = (t) => {
      const k = Math.min(1, (t - start) / 700);
      setShown(Math.round(value * (1 - (1 - k) ** 3)));
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, numeric, reduce]);
  return <span className="tabular-nums">{shown}{numeric ? suffix : ''}</span>;
}

// Compact empty state in the dashboard's visual language.
export function DashEmpty({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cn('rounded-xl border border-dashed border-[hsl(var(--dash-line))] px-6 py-8 text-center flex flex-col items-center gap-2', className)}>
      {Icon && <IconTile icon={Icon} tone="violet" className="mb-1" />}
      <h3 className="text-sm font-semibold">{title}</h3>
      {description && <p className="text-xs text-muted-foreground max-w-xs">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

// Staggered fade-up for top-level dashboard sections.
export function Reveal({ delay = 0, className, children }) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      className={className}
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
