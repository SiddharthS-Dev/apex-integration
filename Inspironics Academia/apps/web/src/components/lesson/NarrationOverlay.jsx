import { Play } from 'lucide-react';

// Shown when the browser blocks narration autoplay.
export default function NarrationOverlay({ onPlay }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-[1px]">
      <button
        type="button"
        onClick={onPlay}
        className="inline-flex items-center gap-2 rounded-full bg-white text-slate-900 px-5 py-3 text-sm font-semibold shadow-lg hover:scale-105 transition-transform"
      >
        <Play className="w-4 h-4 fill-current" />
        Play narration
      </button>
    </div>
  );
}
