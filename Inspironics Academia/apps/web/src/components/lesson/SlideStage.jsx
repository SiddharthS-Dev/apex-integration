import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  Brain, Check, Cpu, Database, Gauge, GraduationCap, Layers, Lightbulb, Network, Rocket, Scale, ShieldCheck, Target,
  TrendingUp, Users, Workflow,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { pointsShown, sceneAt } from '@/components/lesson/scenes';

// Type is sized in container units (the player frame is the container), so a slide keeps its
// proportions at any player width — the way a rendered video would — with a floor for small screens.
const size = (cqw, min) => ({ fontSize: `max(${min}px, ${cqw}cqw)` });

// All motion is CSS. Entrances (.sa-once) always run to the end, even while the narration is paused,
// so nothing can be left invisible half-way in; ambient loops pause with the narration (.sa-paused).
// Everything switches off for people who ask the system for reduced motion, leaving the final state.
const STAGE_CSS = `
@keyframes sa-drift { 0%,100% { transform: translate(0,0) scale(1) } 33% { transform: translate(6%,-8%) scale(1.15) } 66% { transform: translate(-5%,6%) scale(.92) } }
@keyframes sa-pan { from { background-position: 0 0, 0 0 } to { background-position: 0 4cqw, 4cqw 0 } }
@keyframes sa-rise { 0% { transform: translateY(0); opacity: 0 } 15% { opacity: .9 } 85% { opacity: .6 } 100% { transform: translateY(-60cqw); opacity: 0 } }
@keyframes sa-spin { to { transform: rotate(360deg) } }
@keyframes sa-spin-rev { to { transform: rotate(-360deg) } }
@keyframes sa-pulse { 0%,100% { transform: scale(1); opacity: .55 } 50% { transform: scale(1.18); opacity: .15 } }
@keyframes sa-dash { to { stroke-dashoffset: -40 } }
@keyframes sa-sheen { 0% { transform: translateX(-120%) } 60%,100% { transform: translateX(220%) } }
@keyframes sa-zoom { from { transform: scale(1) } to { transform: scale(1.045) } }
@keyframes sa-bob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-4%) } }
@keyframes sa-in { from { opacity: 0; filter: blur(10px); transform: scale(1.03) } to { opacity: 1; filter: blur(0); transform: none } }
@keyframes sa-word { from { opacity: 0; transform: translateY(110%) } to { opacity: 1; transform: none } }
@keyframes sa-slide { from { opacity: 0; transform: translateX(-14px) } to { opacity: 1; transform: none } }
@keyframes sa-pop { from { opacity: 0; transform: scale(.4) rotate(-25deg) } to { opacity: 1; transform: none } }
@keyframes sa-scale-in { from { transform: scale(0) } to { transform: scale(1) } }
@keyframes sa-grow-y { from { transform: scaleY(0) } to { transform: scaleY(1) } }
@keyframes sa-grow-x { from { transform: scaleX(0) } to { transform: scaleX(1) } }
@keyframes sa-draw { from { stroke-dashoffset: 1 } to { stroke-dashoffset: 0 } }
@keyframes sa-sweep { from { left: -50% } to { left: 130% } }
.sa-paused, .sa-paused * { animation-play-state: paused !important }
.sa-paused .sa-once { animation-play-state: running !important }
@media (prefers-reduced-motion: reduce) { .sa-stage, .sa-stage * { animation: none !important } }
`;

// Each scene gets its own accent pair, so moving to the next part reads as a change of scene.
const ACCENTS = [
  ['#818cf8', '#a78bfa'],
  ['#22d3ee', '#818cf8'],
  ['#e879f9', '#8b5cf6'],
  ['#34d399', '#22d3ee'],
  ['#f472b6', '#a78bfa'],
  ['#60a5fa', '#c084fc'],
];

// The scene's illustration: an icon picked from what the scene is about.
const TOPICS = [
  [/\b(ai|intelligen|model|learn|cognitive|reason|agent|ml)/i, Brain],
  [/(sensor|edge|device|hardware|iot|signal|firmware)/i, Cpu],
  [/(data|contract|schema|storage|record|metadata|fabric)/i, Database],
  [/(secur|complian|governance|risk|polic|regulat|trust|audit)/i, ShieldCheck],
  [/(value|roi|revenue|growth|compound|business|economic|invest|cost)/i, TrendingUp],
  [/(monitor|metric|performance|aiops|fidelity|observ|quality)/i, Gauge],
  [/(process|flow|pipeline|lifecycle|step|stage|workflow)/i, Workflow],
  [/(layer|stack|modular|component|reference)/i, Layers],
  [/(platform|integrat|network|architect|engine|satellite|system|converg)/i, Network],
  [/(team|culture|leader|people|organi|human)/i, Users],
  [/(tension|trade|balanc|decision)/i, Scale],
  [/(goal|objective|outcome|strateg|mission|vision)/i, Target],
  [/(deploy|launch|scale|deliver|ship)/i, Rocket],
];
function topicIcon(scene) {
  const match = (text) => TOPICS.find(([re]) => re.test(text))?.[1];
  return match(scene.title) || match(scene.points.join(' ')) || Lightbulb;
}

// Shrinks its content to fit the space it is given, so a long heading or a wordy slide never runs
// into the subtitle band. Every point is laid out from the start (hidden ones are only transparent),
// so the scale is settled once per scene and does not jump as points appear.
function FitBox({ children, deps }) {
  const outer = useRef(null);
  const inner = useRef(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current;
      const i = inner.current;
      if (!o || !i) return;
      setScale(Math.min(1, o.clientHeight / Math.max(1, i.scrollHeight)));
    };
    fit();
    // re-measure when the frame resizes, when the content reflows, and once the web font has loaded
    const ro = new ResizeObserver(fit);
    ro.observe(outer.current);
    ro.observe(inner.current);
    let live = true;
    document.fonts?.ready.then(() => live && fit());
    return () => {
      live = false;
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (
    <div ref={outer} className="h-full w-full">
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'top left', width: `${100 / scale}%` }}>
        {children}
      </div>
    </div>
  );
}

// Denser slides get tighter type, so four or five points still clear the subtitle band.
const density = (n) => (n <= 3 ? { text: 1.8, gap: 1, pad: 0.9 } : n === 4 ? { text: 1.6, gap: 0.7, pad: 0.65 } : { text: 1.45, gap: 0.5, pad: 0.5 });

const EASE = 'cubic-bezier(.22,1,.36,1)';
const BOUNCE = 'cubic-bezier(.34,1.56,.64,1)';
/** A one-off entrance: runs once and holds its end state (pair it with className "sa-once"). */
const once = (name, seconds, delay = 0, ease = EASE) => ({ animation: `${name} ${seconds}s ${ease} ${delay}s both` });

/* ------------------------------------------------------------------ background -- */

// Fixed positions (no randomness), so a re-render never reshuffles the particles.
const PARTICLES = Array.from({ length: 22 }, (_, i) => ({
  left: (i * 37 + 11) % 100,
  top: 70 + ((i * 53) % 30),
  size: 0.25 + ((i * 7) % 4) * 0.12,
  delay: -((i * 1.7) % 14),
  duration: 11 + ((i * 3) % 8),
}));

function Backdrop({ accent }) {
  const [a, b] = accent;
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_0%,#0f1035_0%,#060714_70%)]" />
      {/* drifting colour fields that pick up the scene's accent */}
      <div className="absolute -right-[15%] -top-[30%] h-[85%] w-[60%] rounded-full blur-[6cqw] transition-colors duration-1000" style={{ background: a, opacity: 0.32, animation: 'sa-drift 18s ease-in-out infinite' }} />
      <div className="absolute -left-[15%] -bottom-[35%] h-[85%] w-[55%] rounded-full blur-[6cqw] transition-colors duration-1000" style={{ background: b, opacity: 0.28, animation: 'sa-drift 22s ease-in-out infinite reverse' }} />
      <div className="absolute left-[35%] top-[30%] h-[45%] w-[30%] rounded-full blur-[7cqw] bg-indigo-500/20" style={{ animation: 'sa-drift 26s ease-in-out infinite' }} />
      {/* a slowly travelling blueprint grid, fading out towards the edges */}
      <div
        className="absolute inset-0 [mask-image:radial-gradient(75%_70%_at_50%_45%,#000_30%,transparent_100%)]"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.055) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.055) 1px, transparent 1px)',
          backgroundSize: '4cqw 4cqw, 4cqw 4cqw',
          animation: 'sa-pan 6s linear infinite',
        }}
      />
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute rounded-full bg-white"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            width: `${p.size}cqw`,
            height: `${p.size}cqw`,
            boxShadow: `0 0 ${p.size * 3}cqw ${i % 2 ? a : b}`,
            animation: `sa-rise ${p.duration}s linear ${p.delay}s infinite`,
          }}
        />
      ))}
      <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-black/30" />
    </div>
  );
}

/* ---------------------------------------------------------------- illustration -- */

function Orbit({ Icon, accent }) {
  const [a, b] = accent;
  return (
    <div className="relative h-full w-full">
      {[0, 1, 2].map((r) => (
        <div
          key={r}
          className="absolute rounded-full border border-dashed"
          style={{
            inset: `${r * 14}%`,
            borderColor: r === 1 ? `${b}66` : `${a}55`,
            animation: `${r % 2 ? 'sa-spin-rev' : 'sa-spin'} ${28 - r * 7}s linear infinite`,
          }}
        >
          <span className="absolute left-1/2 -top-[1.6%] h-[3.4%] w-[3.4%] -translate-x-1/2 rounded-full" style={{ background: r === 1 ? b : a, boxShadow: `0 0 1.6cqw ${r === 1 ? b : a}` }} />
          {r === 0 && <span className="absolute -bottom-[1.2%] left-[30%] h-[2.4%] w-[2.4%] rounded-full bg-white/80" />}
        </div>
      ))}
      <Core Icon={Icon} accent={accent} />
    </div>
  );
}

function Mesh({ Icon, accent }) {
  const [a, b] = accent;
  const nodes = [[50, 50], [16, 22], [84, 18], [88, 70], [52, 90], [12, 74], [50, 10]];
  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full overflow-visible">
        {nodes.slice(1).map(([x, y], i) => (
          <g key={i}>
            <line
              className="sa-once" x1={50} y1={50} x2={x} y2={y} stroke={i % 2 ? b : a} strokeOpacity={0.35} strokeWidth={0.5}
              pathLength={1} strokeDasharray="1 1" style={once('sa-draw', 0.9, 0.3 + i * 0.12)}
            />
            <line x1={50} y1={50} x2={x} y2={y} stroke={i % 2 ? b : a} strokeWidth={0.9} strokeDasharray="2 18" strokeLinecap="round" style={{ animation: `sa-dash ${2 + (i % 3) * 0.6}s linear infinite` }} />
          </g>
        ))}
        {nodes.slice(1).map(([x, y], i) => (
          <circle
            key={i} className="sa-once" cx={x} cy={y} r={2.6} fill="#0b0d24" stroke={i % 2 ? b : a} strokeWidth={0.8}
            style={{ transformBox: 'fill-box', transformOrigin: 'center', ...once('sa-scale-in', 0.6, 0.5 + i * 0.12, BOUNCE) }}
          />
        ))}
      </svg>
      <div className="absolute inset-[26%]"><Core Icon={Icon} accent={accent} /></div>
    </div>
  );
}

function Bars({ Icon, accent }) {
  const [a, b] = accent;
  const heights = [38, 55, 47, 70, 62, 86];
  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-x-[6%] bottom-[8%] top-[30%] flex items-end gap-[4%]">
        {heights.map((h, i) => (
          <div
            key={i}
            className="sa-once flex-1 rounded-t-[0.6cqw]"
            style={{ height: `${h}%`, background: `linear-gradient(to top, ${a}22, ${i === heights.length - 1 ? b : a})`, transformOrigin: 'bottom', ...once('sa-grow-y', 0.8, 0.3 + i * 0.1, BOUNCE) }}
          />
        ))}
      </div>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-x-[6%] bottom-[8%] top-[30%] h-[62%] w-[88%] overflow-visible">
        <path
          className="sa-once" d="M4 66 L20 46 L36 54 L52 30 L68 38 L86 12" fill="none" stroke="#fff" strokeOpacity={0.85} strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round"
          pathLength={1} strokeDasharray="1 1" style={once('sa-draw', 1.4, 0.9, 'ease-in-out')}
        />
      </svg>
      <div className="absolute left-1/2 top-0 h-[34%] w-[34%] -translate-x-1/2" style={{ animation: 'sa-bob 5s ease-in-out infinite' }}>
        <Core Icon={Icon} accent={accent} small />
      </div>
    </div>
  );
}

function Core({ Icon, accent, small = false }) {
  const [a, b] = accent;
  return (
    <div className={cn('absolute grid place-items-center', small ? 'inset-0' : 'inset-[30%]')}>
      <span className="absolute inset-0 rounded-[28%]" style={{ background: `${a}55`, animation: 'sa-pulse 3.2s ease-in-out infinite' }} />
      <div
        className="sa-once relative grid h-full w-full place-items-center rounded-[28%] ring-1 ring-white/20"
        style={{ background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 1.5cqw 4cqw -1cqw ${b}`, ...once('sa-pop', 0.8, 0.2, BOUNCE) }}
      >
        <Icon className="h-[46%] w-[46%] text-white drop-shadow" strokeWidth={1.6} />
      </div>
    </div>
  );
}

const VISUALS = [Orbit, Mesh, Bars];

/* ---------------------------------------------------------------------- content -- */

function Title({ text }) {
  const words = text.split(/\s+/);
  return (
    <h2 className="mt-[1cqw] font-extrabold leading-[1.08] tracking-tight" style={size(text.length > 38 ? 3.1 : 3.7, 15)}>
      {words.map((w, i) => (
        <span key={i} className="inline-block overflow-hidden pb-[0.3cqw] align-bottom">
          <span
            className="sa-once inline-block bg-gradient-to-br from-white via-white to-indigo-200 bg-clip-text text-transparent"
            style={once('sa-word', 0.6, 0.25 + i * 0.07)}
          >
            {w}
          </span>
          {i < words.length - 1 && ' '}
        </span>
      ))}
    </h2>
  );
}

// Key points as cards that slide in as the narration reaches them; the one being spoken is lit,
// the ones already covered are ticked off.
function PointList({ points, shown, accent, timeline = false }) {
  const d = density(points.length);
  const [a, b] = accent;
  return (
    <ul className="relative" style={{ display: 'grid', rowGap: `${d.gap}cqw` }}>
      {timeline && (
        <span
          aria-hidden="true"
          className="absolute left-[1.55cqw] top-[1.6cqw] bottom-[1.6cqw] w-[0.2cqw] origin-top rounded-full transition-transform duration-700"
          style={{ background: `linear-gradient(to bottom, ${a}, ${b}22)`, transform: `scaleY(${shown / points.length})` }}
        />
      )}
      {points.map((p, i) => {
        const visible = i < shown;
        const active = i === shown - 1;
        const done = i < shown - 1;
        return (
          <li
            key={p}
            className="relative"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateX(-24px)',
              filter: visible ? 'none' : 'blur(6px)',
              transition: `opacity .6s ease, transform .8s ${BOUNCE}, filter .6s ease`,
            }}
          >
            <div
              className={cn(
                'relative flex items-center gap-[1.4cqw] rounded-[1cqw] border transition-all duration-700',
                timeline ? 'bg-transparent border-transparent' : 'overflow-hidden',
                timeline ? '' : active ? 'bg-white/[.09]' : 'bg-white/[.035] border-white/[.07]',
              )}
              style={{
                padding: timeline ? `${d.pad * 0.4}cqw 0` : `${d.pad}cqw ${d.pad * 1.3}cqw`,
                ...(active && !timeline ? { borderColor: `${a}80`, boxShadow: `0 0 3cqw -0.8cqw ${a}` } : {}),
              }}
            >
              {active && !timeline && (
                <>
                  <span className="sa-once absolute inset-y-[18%] left-0 w-[0.35cqw] rounded-full" style={{ background: `linear-gradient(${a}, ${b})`, ...once('sa-grow-y', 0.5) }} />
                  <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/10 to-transparent" style={{ animation: 'sa-sheen 3.5s ease-in-out infinite' }} />
                </>
              )}
              <span
                className={cn(
                  'relative z-[1] shrink-0 grid place-items-center w-[2.8cqw] h-[2.8cqw] min-w-4 min-h-4 font-bold transition-all duration-500',
                  timeline ? 'rounded-full' : 'rounded-[0.9cqw]',
                  active ? 'text-white scale-110' : done ? 'text-white' : 'bg-white/10 text-indigo-200',
                )}
                style={{
                  ...size(1.45, 9),
                  ...(active ? { background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 0 2cqw ${a}` } : done ? { background: `${a}40`, boxShadow: `inset 0 0 0 1px ${a}80` } : {}),
                }}
              >
                {done ? <Check className="w-[55%] h-[55%]" strokeWidth={3} /> : i + 1}
              </span>
              <span className={cn('relative z-[1] leading-snug transition-colors duration-500', active ? 'text-white' : 'text-white/70')} style={size(d.text, 10)}>
                {p}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// Up to three ordered stages side by side, joined by connectors that draw as each stage arrives.
function StepFlow({ points, shown, accent }) {
  const [a, b] = accent;
  return (
    <ol className="grid gap-[2cqw]" style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}>
      {points.map((p, i) => {
        const visible = i < shown;
        const active = i === shown - 1;
        return (
          <li
            key={p}
            className="relative"
            style={{
              opacity: visible ? 1 : 0,
              transform: visible ? 'none' : 'translateY(22px) scale(.92)',
              transition: `opacity .6s ease, transform .8s ${BOUNCE}`,
            }}
          >
            {i < points.length - 1 && (
              <span aria-hidden="true" className="absolute top-[2.25cqw] left-[5cqw] -right-[2cqw] h-[0.2cqw] overflow-hidden rounded-full bg-white/10">
                <span
                  className="absolute inset-0 origin-left transition-transform duration-1000 ease-in-out"
                  style={{ background: `linear-gradient(90deg, ${a}, ${b})`, transform: `scaleX(${i < shown - 1 ? 1 : 0})` }}
                />
              </span>
            )}
            <span
              className={cn('relative grid place-items-center rounded-full w-[4.5cqw] h-[4.5cqw] min-w-6 min-h-6 font-bold transition-all duration-500', !active && 'bg-slate-900 text-indigo-200 ring-1 ring-white/15')}
              style={{ ...size(1.8, 10), ...(active ? { background: `linear-gradient(135deg, ${a}, ${b})`, boxShadow: `0 0 2.5cqw ${a}` } : {}) }}
            >
              {active && <span className="absolute inset-0 rounded-full" style={{ background: a, animation: 'sa-pulse 2.4s ease-in-out infinite' }} />}
              <span className="relative">{i + 1}</span>
            </span>
            <p
              className={cn('mt-[1.6cqw] rounded-[1.1cqw] border p-[1.5cqw] leading-snug transition-all duration-500', active ? 'bg-white/[.09] text-white' : 'border-white/10 bg-white/[.035] text-white/70')}
              style={{ ...size(1.75, 10), ...(active ? { borderColor: `${a}80`, boxShadow: `0 0 3cqw -0.8cqw ${a}` } : {}) }}
            >
              {p}
            </p>
          </li>
        );
      })}
    </ol>
  );
}

/* ------------------------------------------------------------------------ stage -- */

// The explainer slide for the scene being narrated, as motion graphics: a living backdrop in the
// scene's accent, the heading revealed word by word, key points building up as the narration reaches
// them, and an animated illustration of what the scene is about. Everything is real text drawn by the
// page — the lesson's own words, never an image model's guess. A scene clip, when there is one, is a
// muted backdrop. Ambient motion pauses with the narration.
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
  const accent = ACCENTS[active % ACCENTS.length];
  const eyebrow = [context.course, context.module].filter(Boolean).join('  ·  ');
  const steps = scene.layout === 'steps' && scene.points.length > 1;
  // Up to three stages read well side by side; more become a vertical timeline.
  const flow = steps && scene.points.length <= 3;
  const Visual = VISUALS[active % VISUALS.length];
  const Icon = topicIcon(scene);
  const sceneProgress = Math.min(1, Math.max(0, (current - scene.start) / Math.max(0.1, scene.end - scene.start)));

  return (
    <div className={cn('sa-stage absolute inset-0 overflow-hidden bg-[#060714] text-white select-none', !playing && 'sa-paused')} onClick={onToggle}>
      <style>{STAGE_CSS}</style>
      <Backdrop accent={accent} />
      {scene.videoUrl && (
        <video
          key={scene.videoUrl}
          ref={backdrop}
          src={scene.videoUrl}
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover opacity-20 mix-blend-screen"
        />
      )}

      {/* header: where this lesson sits, and where we are in it */}
      <div className="absolute inset-x-0 top-0 z-10 px-[4.5cqw] pt-[3cqw]">
        <div className="flex items-center justify-between gap-[2cqw]">
          <div className="flex min-w-0 items-center gap-[1.2cqw]">
            <span
              className="grid shrink-0 place-items-center rounded-[0.9cqw] w-[3.2cqw] h-[3.2cqw] min-w-5 min-h-5 transition-all duration-1000"
              style={{ background: `linear-gradient(135deg, ${accent[0]}, ${accent[1]})`, boxShadow: `0 0 2cqw ${accent[1]}80` }}
            >
              <GraduationCap className="w-[60%] h-[60%]" />
            </span>
            <span className="truncate font-semibold uppercase tracking-[0.14em] text-indigo-100/80" style={size(1.2, 8)}>
              {eyebrow || 'Inspironics Academia'}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-[0.6cqw]" aria-label={`Scene ${active + 1} of ${scenes.length}`}>
            {scenes.map((s) => (
              <span key={s.index} className="relative h-[0.5cqw] min-h-1 overflow-hidden rounded-full bg-white/15 transition-all duration-500" style={{ width: s.index === active ? '4cqw' : '1.2cqw' }}>
                <span
                  className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-linear"
                  style={{ width: s.index < active ? '100%' : s.index === active ? `${sceneProgress * 100}%` : '0%', background: `linear-gradient(90deg, ${accent[0]}, ${accent[1]})` }}
                />
              </span>
            ))}
            <span className="ml-[0.8cqw] tabular-nums font-semibold text-white/70" style={size(1.2, 8)}>
              {String(active + 1).padStart(2, '0')} / {String(scenes.length).padStart(2, '0')}
            </span>
          </div>
        </div>
      </div>

      {/* each scene enters fresh: blurred in, with a light sweep across the frame */}
      <div key={active} className="sa-once absolute inset-0" style={once('sa-in', 0.7)}>
        <div
          aria-hidden="true"
          className="sa-once pointer-events-none absolute inset-y-0 z-20 w-[40%] skew-x-[-18deg]"
          style={{ left: '-50%', background: `linear-gradient(90deg, transparent, ${accent[0]}33, transparent)`, ...once('sa-sweep', 1.1, 0, 'ease-in-out') }}
        />

        {/* a slow push-in over the length of the scene, like a camera move */}
        <div className="absolute inset-0" style={{ animation: `sa-zoom ${Math.max(4, scene.end - scene.start)}s linear forwards` }}>
          {!flow && (
            <div className="absolute right-[5cqw] top-[12cqw] w-[24cqw] aspect-square">
              <Visual Icon={Icon} accent={accent} />
            </div>
          )}

          {/* the slide; the lower quarter is left clear for the subtitles and the controls */}
          <div className={cn('absolute left-0 top-[9.5cqw] bottom-[25%] px-[6cqw]', flow ? 'right-0' : 'right-[29cqw]')}>
            <FitBox deps={[active, scene.title, scene.points.length]}>
              <div
                className="sa-once flex items-center gap-[1cqw] font-semibold uppercase tracking-[0.2em]"
                style={{ ...size(1.2, 8), color: accent[1], ...once('sa-slide', 0.5, 0.1) }}
              >
                <span
                  className="sa-once h-[0.15cqw] min-h-px w-[3.5cqw] origin-left rounded-full"
                  style={{ background: `linear-gradient(90deg, ${accent[0]}, ${accent[1]})`, ...once('sa-grow-x', 0.6, 0.15) }}
                />
                Part {String(active + 1).padStart(2, '0')}
              </div>
              {/* a long heading wraps; FitBox keeps the points clear of the subtitles */}
              <Title text={scene.title} />
              <div className="mt-[2cqw]">
                {flow
                  ? <StepFlow points={scene.points} shown={shown} accent={accent} />
                  : <PointList points={scene.points} shown={shown} accent={accent} timeline={steps} />}
              </div>
            </FitBox>
          </div>
        </div>
      </div>
    </div>
  );
}
