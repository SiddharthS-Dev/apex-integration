import { Captions, CaptionsOff, Pause, Play, SkipBack, SkipForward, Volume2, VolumeX } from 'lucide-react';
import { Slider } from '@/components/ui/slider';

const fmt = (s = 0) => {
  const t = Math.max(0, Math.floor(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
};
const iconBtn = 'w-9 h-9 rounded-full flex items-center justify-center text-white hover:bg-white/15 transition-colors disabled:opacity-40 disabled:hover:bg-transparent';

// `markers` are scenes ({ start, title }); each start gets a tick on the progress bar.
// `captions` is on/off when the lesson has subtitles, undefined when it has none (no CC button).
export default function PlayerControls({ playing, current, duration, muted, onToggle, onSeek, onMute, markers = [], onPrevScene, onNextScene, captions, onCaptions }) {
  const scenes = markers.length > 1;
  return (
    <div className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-10 bg-gradient-to-t from-black/75 to-transparent">
      <div className="flex items-center gap-1 sm:gap-2">
        {scenes && (
          <button type="button" onClick={onPrevScene} className={`${iconBtn} hidden sm:flex`} aria-label="Previous scene" title="Previous scene">
            <SkipBack className="w-4 h-4" />
          </button>
        )}
        <button type="button" onClick={onToggle} className={iconBtn} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        {scenes && (
          <button type="button" onClick={onNextScene} disabled={!onNextScene} className={`${iconBtn} hidden sm:flex`} aria-label="Next scene" title="Next scene">
            <SkipForward className="w-4 h-4" />
          </button>
        )}
        <div className="relative flex-1">
          <Slider
            value={[Math.min(current, duration || 0)]}
            max={duration || 1}
            step={0.1}
            onValueChange={([v]) => onSeek(v)}
            aria-label="Narration progress"
          />
          {scenes && duration > 0 && markers.slice(1).map((m) => (
            <span
              key={m.start}
              title={m.title}
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 -translate-y-1/2 w-0.5 h-3 rounded-full bg-white/70"
              style={{ left: `${Math.min(100, (m.start / duration) * 100)}%` }}
            />
          ))}
        </div>
        <span className="text-xs text-white/90 tabular-nums whitespace-nowrap px-1">
          {fmt(current)} / {fmt(duration)}
        </span>
        {captions !== undefined && (
          <button type="button" onClick={onCaptions} className={`${iconBtn} ${captions ? 'bg-white/15' : ''}`} aria-label={captions ? 'Hide subtitles' : 'Show subtitles'} aria-pressed={captions} title={captions ? 'Hide subtitles' : 'Show subtitles'}>
            {captions ? <Captions className="w-4 h-4" /> : <CaptionsOff className="w-4 h-4" />}
          </button>
        )}
        <button type="button" onClick={onMute} className={iconBtn} aria-label={muted ? 'Unmute' : 'Mute'}>
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
