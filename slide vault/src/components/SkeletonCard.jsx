import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

const pulse = {
  animate: { opacity: [0.45, 0.85, 0.45] },
  transition: { duration: 1.6, repeat: Infinity, ease: 'easeInOut' },
};

export function SkeletonCard({ className }) {
  return (
    <motion.div {...pulse} className={cn('overflow-hidden rounded-2xl glass', className)}>
      <div className="aspect-video w-full bg-secondary" />
      <div className="space-y-2.5 p-3.5">
        <div className="h-3 w-20 rounded-full bg-secondary" />
        <div className="h-4 w-full rounded bg-secondary" />
        <div className="h-4 w-2/3 rounded bg-secondary" />
        <div className="flex gap-1.5 pt-1">
          <div className="h-3 w-10 rounded bg-secondary" />
          <div className="h-3 w-12 rounded bg-secondary" />
        </div>
      </div>
    </motion.div>
  );
}

export function SkeletonGrid({ count = 8, className }) {
  return (
    <div
      className={cn(
        'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
        className
      )}
    >
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonRow({ count = 5, className }) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <motion.div key={i} {...pulse} className="flex gap-4 rounded-2xl glass p-3">
          <div className="aspect-video w-40 shrink-0 rounded-xl bg-secondary" />
          <div className="flex-1 space-y-2.5 py-1">
            <div className="h-4 w-1/2 rounded bg-secondary" />
            <div className="h-3 w-full rounded bg-secondary" />
            <div className="h-3 w-3/4 rounded bg-secondary" />
          </div>
        </motion.div>
      ))}
    </div>
  );
}

export function SkeletonScrollRow({ count = 6 }) {
  return (
    <div className="scroll-row no-scrollbar">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className="w-[260px] shrink-0 snap-start" />
      ))}
    </div>
  );
}

export default SkeletonCard;
