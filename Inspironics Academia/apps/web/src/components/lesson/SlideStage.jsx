import { useEffect, useRef } from 'react';
import { GraduationCap } from 'lucide-react';
import { cn } from '@/lib/utils';
import { pointsShown, sceneAt } from '@/components/lesson/scenes';

// Type is sized in container units (the player frame is the container), so a slide keeps its
// proportions at any player width — the way a rendered video would — with a floor for small screens.
const size = (cqw, min) => ({ fontSize: `max(${min}px, ${cqw}cqw)` });

const GRID = {
  backgroundImage:
    'radial-gradient(60% 80% at 100% 0%, rgba(124,58,237,.35), transparent 60%),'
    + 'radial-gradient(50% 70% at 0% 100%, rgba(79,70,229,.35), transparent 60%),'
    + 'linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px),'
    + 'linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)',
  backgroundSize: 'auto, auto, 4cqw 4cqw, 4cqw 4cqw',
};

// Denser slides get tighter type, so four or five points still clear the subtitle band.
const density = (n) => (n <= 3 ? { text: 2.25, gap: 1.6 } : n === 4 ? { text: 1.95, gap: 1.2 } : { text: 1.75, gap: 0.9 });

// A list of key points — or, with `timeline`, an ordered process too long to sit in one row.
function PointList({ points, shown, timeline = false }) {
  const d = density(points.length);
  return (
    <ul className="relative" style={{ display: 'grid', rowGap: `${d.gap}cqw` }}>
      {timeline && <span aria-hidden="true" className="absolute left-[1.4cqw] top-[1.4cqw] bottom-[1.4cqw] w-px bg-gradient-to-b from-indigo-400/70 to-violet-400/10" />}
      {points.map((p, i) => (
        <li
          key={p}
          className={cn(
            'flex items-start gap-[1.6cqw] transition-all duration-700',
            i < shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[1cqw]',
          )}
        >
          <span
            className={cn(
              'relative mt-[0.2cqw] shrink-0 grid place-items-center w-[2.8cqw] h-[2.8cqw] min-w-4 min-h-4 font-bold transition-colors duration-500',
              timeline ? 'rounded-full' : 'rounded-[0.8cqw]',
              i === shown - 1 ? 'bg-gradient-to-br from-indigo-400 to-violet-500 text-white shadow-lg shadow-violet-500/30' : timeline ? 'bg-slate-900 text-indigo-200 ring-1 ring-white/15' : 'bg-white/10 text-indigo-200',
            )}
            style={size(1.5, 9)}
          >
            {i + 1}
          </span>
          <span className={cn('leading-snug transition-colors duration-500', i === shown - 1 ? 'text-white' : 'text-white/75')} style={size(d.text, 10)}>
            {p}
          </span>
        </li>
      ))}
    </ul>
  );
}

function StepFlow({ points, shown }) {
  return (
    <ol className="grid gap-[1.4cqw]" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((p, i) => (
        <li
          key={p}
          className={cn('relative transition-all duration-700', i < shown ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-[1cqw]')}
        >
          {/* the connector to the next stage */}
          {i < points.length - 1 && (
            <span aria-hidden="true" className="absolute top-[2cqw] left-[4.4cqw] -right-[1.4cqw] h-px bg-gradient-to-r from-indigo-400/70 to-violet-400/20" />
          )}
          <span
            className={cn(
              'relative grid place-items-center rounded-full w-[4cqw] h-[4cqw] min-w-6 min-h-6 font-bold ring-[0.3cqw] transition-colors duration-500',
              i === shown - 1 ? 'bg-gradient-to-br from-indigo-400 to-violet-500 text-white ring-violet-400/30' : 'bg-slate-900 text-indigo-200 ring-white/10',
            )}
            style={size(1.7, 10)}
          >
            {i + 1}
          </span>
          <p
            className={cn('mt-[1.4cqw] rounded-[1cqw] border p-[1.4cqw] leading-snug transition-colors duration-500', i === shown - 1 ? 'border-violet-400/40 bg-white/[.08] text-white' : 'border-white/10 bg-white/[.04] text-white/75')}
            style={size(1.75, 10)}
          >
            {p}
          </p>
        </li>
      ))}
    </ol>
  );
}

// The explainer slide for the scene being narrated: course and module, the scene heading, and its key
// points building up as the narration reaches them. Everything is real text drawn by the page — the
// lesson's own words, never an image model's guess. A scene clip, when there is one, is a muted backdrop.
export default function SlideStage({ scenes, current, playing, onToggle, context = {} }) {
  const active = sceneAt(scenes, current);
  const scene = scenes[active];
  const shown = pointsShown(scene, current);
  const backdrop = useRef(null);

  useEffect(() => {
    const el = backdrop.current;
    if (!el) return;
    if (playing) el.play().catch(() => {});
    else el.pause();
  }, [playing, scene?.videoUrl]);

  if (!scene) return null;
  const eyebrow = [context.course, context.module].filter(Boolean).join('  ·  ');
  const steps = scene.layout === 'steps' && scene.points.length > 1;
  // Up to three stages read well side by side; more become a vertical timeline.
  const flow = steps && scene.points.length <= 3;

  return (
    <div className="absolute inset-0 overflow-hidden bg-slate-950 text-white select-none" style={GRID} onClick={onToggle}>
      {scene.videoUrl && (
        <video
          key={scene.videoUrl}
          ref={backdrop}
          src={scene.videoUrl}
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-20"
        />
      )}

      {/* header: where this lesson sits, and where we are in it */}
      <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-[2cqw] px-[4.5cqw] pt-[3.2cqw]">
        <div className="flex min-w-0 items-center gap-[1.2cqw]">
          <span className="grid shrink-0 place-items-center rounded-[0.9cqw] w-[3.2cqw] h-[3.2cqw] min-w-5 min-h-5 bg-gradient-to-br from-indigo-500 to-violet-600 shadow-lg shadow-violet-500/30">
            <GraduationCap className="w-[60%] h-[60%]" />
          </span>
          <span className="truncate font-semibold uppercase tracking-[0.14em] text-indigo-200/90" style={size(1.25, 8)}>
            {eyebrow || 'Inspironics Academia'}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-[0.6cqw]" aria-label={`Scene ${active + 1} of ${scenes.length}`}>
          {scenes.map((s) => (
            <span
              key={s.index}
              className={cn('h-[0.5cqw] min-h-1 rounded-full transition-all duration-500', s.index === active ? 'w-[3cqw] bg-violet-400' : s.index < active ? 'w-[1cqw] bg-indigo-300/70' : 'w-[1cqw] bg-white/20')}
            />
          ))}
          <span className="ml-[0.8cqw] tabular-nums font-semibold text-white/70" style={size(1.2, 8)}>
            {String(active + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
          </span>
        </div>
      </div>

      {/* the slide; the lower fifth is left clear for the subtitles and the controls */}
      <div key={active} className="absolute inset-x-0 top-[10cqw] bottom-[20%] px-[6cqw] flex flex-col animate-in fade-in slide-in-from-bottom-2 duration-700">
        <div className="flex items-center gap-[1cqw] font-semibold uppercase tracking-[0.18em] text-violet-300" style={size(1.2, 8)}>
          <span className="h-px w-[3cqw] bg-violet-400" />
          Part {active + 1}
        </div>
        {/* a long heading wraps; a smaller size keeps the points clear of the subtitles */}
        <h2 className="mt-[1cqw] max-w-[85%] font-extrabold leading-[1.1] tracking-tight" style={size(scene.title.length > 38 ? 3.1 : 3.7, 15)}>
          {scene.title}
        </h2>
        <div className="mt-[3cqw] min-h-0 flex-1">
          {flow ? <StepFlow points={scene.points} shown={shown} /> : <PointList points={scene.points} shown={shown} timeline={steps} />}
        </div>
      </div>
    </div>
  );
}
