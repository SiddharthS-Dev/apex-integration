import { Link } from 'react-router-dom';
import { ArrowRight, Check, Flame } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

function HeroIllustration() {
  return (
    <svg viewBox="0 0 220 170" className="w-full h-full" aria-hidden="true">
      <defs>
        <linearGradient id="hero-screen" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#6366f1" />
          <stop offset="1" stopColor="#0ea5e9" />
        </linearGradient>
        <linearGradient id="hero-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a5b4fc" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
        <radialGradient id="hero-glow">
          <stop offset="0" stopColor="#8b5cf6" stopOpacity=".55" />
          <stop offset="1" stopColor="#8b5cf6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="110" cy="140" rx="100" ry="26" fill="url(#hero-glow)" />
      {/* books */}
      <rect x="40" y="118" width="140" height="12" rx="3" fill="#4f46e5" />
      <rect x="48" y="106" width="124" height="12" rx="3" fill="#0ea5e9" />
      <rect x="44" y="120" width="132" height="2" fill="#c7d2fe" opacity=".6" />
      {/* laptop */}
      <rect x="64" y="42" width="98" height="62" rx="6" fill="#1e1b4b" stroke="url(#hero-base)" strokeWidth="2" />
      <rect x="70" y="48" width="86" height="50" rx="3" fill="url(#hero-screen)" opacity=".9" />
      <rect x="76" y="56" width="34" height="4" rx="2" fill="#e0e7ff" opacity=".85" />
      <rect x="76" y="64" width="24" height="4" rx="2" fill="#e0e7ff" opacity=".55" />
      <rect x="76" y="72" width="30" height="4" rx="2" fill="#e0e7ff" opacity=".55" />
      <path d="M124 70 l14 -7 l14 7 l-14 7 z" fill="#fff" />
      <path d="M130 73 v6 c0 3 16 3 16 0 v-6 l-8 4 z" fill="#e0e7ff" />
      <path d="M150 71 v8" stroke="#fff" strokeWidth="1.5" />
      <path d="M56 104 h114 l-6 6 h-102 z" fill="url(#hero-base)" />
      {/* plant */}
      <path d="M30 118 v-22" stroke="#22d3ee" strokeWidth="2" />
      <path d="M30 104 c-12 -2 -16 -12 -14 -18 c8 2 14 8 14 18 z" fill="#06b6d4" opacity=".85" />
      <path d="M30 98 c10 -4 16 -14 14 -22 c-8 4 -14 12 -14 22 z" fill="#22d3ee" opacity=".85" />
      <rect x="22" y="114" width="16" height="16" rx="3" fill="#312e81" />
      {/* sparkles */}
      <circle cx="186" cy="40" r="2.5" fill="#c4b5fd" />
      <circle cx="44" cy="46" r="2" fill="#67e8f9" />
      <circle cx="194" cy="92" r="1.8" fill="#a5b4fc" />
    </svg>
  );
}

function StreakCard({ streak, week }) {
  return (
    <div className="rounded-2xl border border-[hsl(var(--dash-line))] bg-white/60 dark:bg-slate-950/40 backdrop-blur p-4 sm:p-5 w-full lg:w-[340px] shrink-0">
      <div className="flex items-center gap-3">
        <div className="relative w-12 h-12 rounded-2xl bg-orange-500/10 ring-1 ring-inset ring-orange-500/30 flex items-center justify-center">
          <Flame className={cn('w-7 h-7 text-orange-500', streak > 0 && 'motion-safe:animate-pulse')} />
        </div>
        <div className="min-w-0">
          <div className="text-xs text-muted-foreground">Learning streak</div>
          <div className="text-2xl font-bold leading-tight tabular-nums">
            {streak} <span className="text-base font-semibold">{streak === 1 ? 'day' : 'days'}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {streak > 0 ? 'Keep it going!' : 'Complete a lesson or quiz to start one.'}
          </div>
        </div>
      </div>
      <ol className="mt-4 grid grid-cols-7 gap-1" aria-label="Activity this week">
        {week.map((d) => (
          <li key={d.key} className="flex flex-col items-center gap-1.5">
            <span
              title={d.active ? `Active on ${d.label}` : `No activity on ${d.label}`}
              className={cn(
                'w-6 h-6 rounded-full flex items-center justify-center transition-colors',
                d.active
                  ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/40'
                  : 'border border-[hsl(var(--dash-line))] bg-muted/50',
                d.isToday && !d.active && 'border-primary/60',
                d.isFuture && 'opacity-50',
              )}
            >
              {d.active && <Check className="w-3.5 h-3.5" strokeWidth={3} />}
            </span>
            <span className={cn('text-[11px] text-muted-foreground', d.isToday && 'text-foreground font-semibold')}>{d.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function WelcomeHero({ name, streak, week, resume, hasProgress }) {
  const tag = streak > 0 ? 'Keep going!' : hasProgress ? 'Welcome back' : "Let's get started";
  return (
    <section className="dash-panel relative overflow-hidden p-5 sm:p-6">
      <div
        className="pointer-events-none absolute inset-0 opacity-90"
        style={{ background: 'radial-gradient(60% 90% at 20% 0%, hsl(var(--dash-glow) / .22), transparent 70%), radial-gradient(40% 70% at 70% 100%, hsl(var(--dash-cyan) / .12), transparent 70%)' }}
      />
      <div className="relative flex flex-col lg:flex-row lg:items-center gap-6">
        <div className="hidden 2xl:block w-48 h-36 shrink-0">
          <HeroIllustration />
        </div>
        <div className="flex-1 min-w-0">
          <span className="inline-flex items-center rounded-full bg-primary/15 text-primary ring-1 ring-inset ring-primary/30 px-2.5 py-0.5 text-xs font-medium">
            {tag}
          </span>
          <h1 className="mt-3 text-2xl sm:text-3xl font-bold tracking-tight">
            Welcome back{name ? `, ${name}` : ''} <span className="inline-block origin-[70%_70%] motion-safe:hover:animate-[wave_1s_ease-in-out]">👋</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground max-w-lg">
            Your learning journey continues. Build new skills, earn certifications, and achieve your goals.
          </p>
          <Button asChild className="mt-5 group shadow-lg shadow-primary/25 transition-transform active:scale-[0.98]">
            <Link to={resume.to}>
              {resume.label}
              <ArrowRight className="transition-transform group-hover:translate-x-0.5" />
            </Link>
          </Button>
        </div>
        <StreakCard streak={streak} week={week} />
      </div>
    </section>
  );
}
