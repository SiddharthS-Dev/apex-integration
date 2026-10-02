import { Pause, Play, Square, Volume2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import useSpeechNarration from '@/components/lesson/useSpeechNarration';

const pill = 'inline-flex items-center gap-1.5 rounded-full bg-white/95 text-slate-900 px-3.5 py-2 text-xs sm:text-sm font-semibold shadow-lg hover:bg-white transition-colors';

// "Listen to narration" — reads the lesson script with the browser's speech engine.
export default function SpeechNarrationControls({ text, className }) {
  const { supported, state, play, pause, stop } = useSpeechNarration(text);
  if (!supported) return null;
  return (
    <div className={cn('absolute z-10 flex items-center gap-2', className)}>
      {state === 'playing' ? (
        <button type="button" className={pill} onClick={pause}><Pause className="w-4 h-4" /> Pause</button>
      ) : (
        <button type="button" className={pill} onClick={play}>
          {state === 'paused' ? <Play className="w-4 h-4 fill-current" /> : <Volume2 className="w-4 h-4" />}
          {state === 'paused' ? 'Resume' : 'Listen to narration'}
        </button>
      )}
      {state !== 'idle' && (
        <button type="button" className={pill} onClick={stop} aria-label="Stop narration"><Square className="w-4 h-4" /></button>
      )}
    </div>
  );
}
