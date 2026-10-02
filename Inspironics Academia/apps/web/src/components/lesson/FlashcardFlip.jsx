import { motion } from 'framer-motion';
import { RotateCw } from 'lucide-react';

const face = 'absolute inset-0 rounded-2xl p-6 flex flex-col items-center justify-center text-center [backface-visibility:hidden]';

export default function FlashcardFlip({ card, flipped, onFlip }) {
  return (
    <button type="button" onClick={onFlip} className="block w-full [perspective:1200px]" aria-label="Flip card">
      <motion.div
        className="relative h-56 sm:h-64 w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.45, ease: 'easeInOut' }}
      >
        <div className={`${face} bg-gradient-to-br from-indigo-500 to-violet-600 text-white`}>
          <span className="text-xs uppercase tracking-wider text-white/70 mb-3">Question</span>
          <p className="text-lg font-semibold leading-snug">{card.front}</p>
          <span className="absolute bottom-4 inline-flex items-center gap-1 text-xs text-white/70">
            <RotateCw className="w-3 h-3" /> Tap to reveal
          </span>
        </div>
        <div className={`${face} [transform:rotateY(180deg)] border border-border bg-card`}>
          <span className="text-xs uppercase tracking-wider text-muted-foreground mb-3">Answer</span>
          <p className="text-base leading-relaxed">{card.back}</p>
        </div>
      </motion.div>
    </button>
  );
}
