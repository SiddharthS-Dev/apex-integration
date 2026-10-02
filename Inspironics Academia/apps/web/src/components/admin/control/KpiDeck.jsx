import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Award, BookOpen, FileQuestion, FileText, GraduationCap, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import DeepDivePanel from './DeepDivePanel';
import { KINDS, kindInfo } from './controlData';

const ICONS = { playbooks: FileText, courses: BookOpen, lessons: GraduationCap, questions: FileQuestion, learners: Users, certificates: Award };

function useIsWide() {
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return wide;
}

// KPI cards are the entry point: clicking one opens its deep-dive panel anchored beneath it, and the
// rest of the page dims and blurs. `open` is { kind, tab } | null, controlled by the page.
export default function KpiDeck({ data, actions, open, onOpen, onClose }) {
  const wrapRef = useRef(null);
  const cardRefs = useRef({});
  const wide = useIsWide();
  const [anchor, setAnchor] = useState({ left: 0, width: 0, origin: '50% 0%' });

  useLayoutEffect(() => {
    if (!open || !wide || !wrapRef.current) return undefined;
    const place = () => {
      const wrap = wrapRef.current.getBoundingClientRect();
      const card = cardRefs.current[open.kind]?.getBoundingClientRect();
      if (!card) return;
      const width = Math.min(900, wrap.width);
      const center = card.left - wrap.left + card.width / 2;
      const left = Math.max(0, Math.min(wrap.width - width, center - width / 2));
      setAnchor({ left, width, origin: `${center - left}px 0%` });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open, wide]);

  useEffect(() => {
    if (!open) return undefined;
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [open, onClose]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            key="dim" aria-hidden="true" onClick={onClose}
            className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-[3px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          />
        )}
      </AnimatePresence>
      <div ref={wrapRef} className={cn('relative', open && 'z-50')}>
        <div className="grid gap-3 sm:gap-4 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
          {KINDS.map((kind) => {
            const info = kindInfo(kind, data);
            const Icon = ICONS[kind];
            const active = open?.kind === kind;
            return (
              <motion.button
                key={kind} ref={(el) => { cardRefs.current[kind] = el; }} type="button"
                aria-expanded={active} aria-haspopup="dialog"
                onClick={() => (active ? onClose() : onOpen({ kind, tab: 'Summary' }))}
                whileHover={{ y: -3, scale: 1.02 }} whileTap={{ scale: 0.98 }}
                className={cn(
                  'glass tone-idle text-left p-4 sm:p-5 transition-[border-color,box-shadow] duration-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400',
                  active ? 'glass-glow ring-2 ring-violet-500/70 shadow-[0_0_40px_-8px_rgb(139_92_246/0.9)]' : 'hover:glass-glow',
                  open && !active && 'opacity-60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm text-muted-foreground">{info.label}</span>
                  <span className={cn('w-9 h-9 rounded-xl flex items-center justify-center ring-1 ring-violet-400/30 bg-violet-500/10', active ? 'text-violet-300' : 'text-violet-500 dark:text-violet-300')}>
                    <Icon className="w-4 h-4" />
                  </span>
                </div>
                <div className="text-3xl font-bold tabular-nums mt-1">{info.total}</div>
                <div className="text-xs text-muted-foreground truncate">{info.hint}</div>
              </motion.button>
            );
          })}
        </div>
        <AnimatePresence>
          {open && (
            wide ? (
              <DeepDivePanel
                key={`${open.kind}-${open.tab}`} kind={open.kind} initialTab={open.tab} data={data} actions={actions} onClose={onClose}
                style={{ position: 'absolute', top: 'calc(100% + 12px)', left: anchor.left, width: anchor.width, transformOrigin: anchor.origin, maxHeight: 'min(640px, calc(100vh - 8rem))' }}
              />
            ) : (
              <DeepDivePanel
                key={`${open.kind}-${open.tab}`} kind={open.kind} initialTab={open.tab} data={data} actions={actions} onClose={onClose}
                style={{ position: 'fixed', left: 12, right: 12, bottom: 12, top: 76 }}
              />
            )
          )}
        </AnimatePresence>
      </div>
    </>
  );
}
