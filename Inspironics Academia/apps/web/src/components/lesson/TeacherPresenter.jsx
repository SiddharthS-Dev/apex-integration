import { cn } from '@/lib/utils';

// An animated teacher who presents the slides: breathes, blinks, talks while the narration plays and
// points at the slide with a pointer now and then. Pure SVG + CSS (no assets), drawn in the scene's
// accent colours. Inside the slide stage, .sa-paused freezes every motion when the narration pauses,
// and reduced-motion users get the still pose (see SlideStage's STAGE_CSS).
const CSS = `
@keyframes tp-breathe { 0%,100% { transform: translateY(0) scaleY(1) } 50% { transform: translateY(-0.6%) scaleY(1.008) } }
@keyframes tp-blink { 0%,93%,100% { transform: scaleY(1) } 95% { transform: scaleY(0.1) } }
@keyframes tp-talk { 0%,100% { transform: scaleY(0.25) } 20% { transform: scaleY(1) } 40% { transform: scaleY(0.45) } 60% { transform: scaleY(0.9) } 80% { transform: scaleY(0.35) } }
@keyframes tp-point { 0%,62%,100% { transform: rotate(0deg) } 70%,86% { transform: rotate(-28deg) } }
@keyframes tp-nod { 0%,100% { transform: rotate(0deg) } 30% { transform: rotate(-2.5deg) } 65% { transform: rotate(2deg) } }
@keyframes tp-wave { 0% { transform: scale(.6); opacity: .7 } 100% { transform: scale(1.5); opacity: 0 } }
.tp-body { animation: tp-breathe 4.5s ease-in-out infinite; transform-origin: 50% 100%; transform-box: fill-box }
.tp-eye { animation: tp-blink 5s ease-in-out infinite; transform-origin: center; transform-box: fill-box }
.tp-mouth { transform-origin: center; transform-box: fill-box; transform: scaleY(0.25) }
.tp-talking .tp-mouth { animation: tp-talk .42s ease-in-out infinite }
.tp-talking .tp-head { animation: tp-nod 3.2s ease-in-out infinite; transform-origin: 50% 90%; transform-box: fill-box }
.tp-talking .tp-arm { animation: tp-point 7s ease-in-out infinite; transform-origin: 8% 6%; transform-box: fill-box }
.tp-wave { transform-origin: center; transform-box: fill-box; opacity: 0 }
.tp-talking .tp-wave { animation: tp-wave 1.6s ease-out infinite }
@media (prefers-reduced-motion: reduce) { .tp-root, .tp-root * { animation: none !important } }
`;

export default function TeacherPresenter({ playing, accent = ['#818cf8', '#a78bfa'], className }) {
  const [a, b] = accent;
  return (
    <div className={cn('tp-root pointer-events-none', playing && 'tp-talking', className)} aria-hidden="true">
      <style>{CSS}</style>
      <svg viewBox="0 0 200 260" className="h-full w-full overflow-visible drop-shadow-[0_1.5cqw_2cqw_rgba(0,0,0,.45)]">
        <defs>
          <linearGradient id="tp-jacket" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={a} />
            <stop offset="1" stopColor={b} />
          </linearGradient>
          <radialGradient id="tp-glow" cx="50%" cy="45%" r="55%">
            <stop offset="0" stopColor={b} stopOpacity=".45" />
            <stop offset="1" stopColor={b} stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* soft spotlight behind the teacher */}
        <ellipse cx="100" cy="150" rx="100" ry="115" fill="url(#tp-glow)" />

        <g className="tp-body">
          {/* torso: blazer over a shirt */}
          <path d="M38 260 C40 200 62 176 100 172 C138 176 160 200 162 260 Z" fill="url(#tp-jacket)" />
          <path d="M84 176 L100 214 L116 176 Z" fill="#f8fafc" />
          <path d="M96 182 L100 196 L104 182 L100 178 Z" fill="#1e1b4b" />
          <path d="M84 176 L72 200 L92 206 Z M116 176 L128 200 L108 206 Z" fill="#000" opacity=".12" />
          {/* a name badge */}
          <rect x="118" y="214" width="26" height="10" rx="3" fill="#f8fafc" opacity=".9" />

          {/* the pointing arm (rotates up towards the slide) */}
          <g className="tp-arm">
            <path d="M52 196 C34 206 26 224 30 238 L44 240 C44 226 50 214 62 206 Z" fill="url(#tp-jacket)" />
            <circle cx="36" cy="240" r="7" fill="#f2c4a0" />
            <line x1="34" y1="238" x2="-6" y2="196" stroke="#e2e8f0" strokeWidth="3" strokeLinecap="round" />
            <circle cx="-6" cy="196" r="3" fill={b} />
          </g>
          {/* the resting arm */}
          <path d="M148 196 C164 208 168 226 164 244 L150 244 C152 228 148 214 138 206 Z" fill="url(#tp-jacket)" />

          {/* neck and head */}
          <rect x="90" y="150" width="20" height="26" rx="8" fill="#e8b48f" />
          <g className="tp-head">
            {/* hair, back */}
            <path d="M58 98 C56 54 84 34 106 36 C134 38 150 62 146 102 C146 132 140 150 134 158 L66 158 C60 146 58 124 58 98 Z" fill="#2b1d16" />
            {/* face */}
            <ellipse cx="102" cy="108" rx="38" ry="44" fill="#f2c4a0" />
            {/* ears */}
            <ellipse cx="64" cy="112" rx="6" ry="9" fill="#e8b48f" />
            <ellipse cx="140" cy="112" rx="6" ry="9" fill="#e8b48f" />
            {/* fringe */}
            <path d="M64 96 C68 64 92 52 112 56 C126 58 138 68 142 86 C126 76 104 74 86 82 C76 86 68 92 64 96 Z" fill="#2b1d16" />
            {/* eyebrows */}
            <path d="M80 94 Q88 89 96 93 M108 93 Q116 89 124 94" stroke="#2b1d16" strokeWidth="3" fill="none" strokeLinecap="round" />
            {/* eyes */}
            <g className="tp-eye"><ellipse cx="88" cy="106" rx="4.2" ry="5" fill="#1e1b2e" /><circle cx="89.5" cy="104" r="1.3" fill="#fff" /></g>
            <g className="tp-eye"><ellipse cx="116" cy="106" rx="4.2" ry="5" fill="#1e1b2e" /><circle cx="117.5" cy="104" r="1.3" fill="#fff" /></g>
            {/* glasses */}
            <g stroke="#334155" strokeWidth="2" fill="#fff" fillOpacity=".08">
              <rect x="76" y="96" width="24" height="19" rx="7" />
              <rect x="104" y="96" width="24" height="19" rx="7" />
              <path d="M100 104 L104 104" fill="none" />
            </g>
            {/* nose and cheeks */}
            <path d="M102 112 Q99 121 104 123" stroke="#d29b78" strokeWidth="2" fill="none" strokeLinecap="round" />
            <circle cx="78" cy="124" r="5" fill="#f19c94" opacity=".35" />
            <circle cx="126" cy="124" r="5" fill="#f19c94" opacity=".35" />
            {/* mouth: opens and closes while the narration plays */}
            <ellipse className="tp-mouth" cx="102" cy="134" rx="9" ry="6" fill="#7f1d1d" />
            <path d="M92 132 Q102 138 112 132" stroke="#9f3a3a" strokeWidth="1.5" fill="none" strokeLinecap="round" opacity=".6" />
          </g>
        </g>

        {/* sound waves next to the mouth while speaking */}
        <g fill="none" stroke={a} strokeWidth="2">
          <circle className="tp-wave" cx="150" cy="128" r="10" />
          <circle className="tp-wave" cx="150" cy="128" r="10" style={{ animationDelay: '.8s' }} />
        </g>
      </svg>
    </div>
  );
}
