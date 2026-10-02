import {
  BarChart3, BookOpen, Braces, Cloud, Cpu, Database, Layers, Network, Server, ShieldCheck, Workflow, Wrench,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Courses have no image field, so each gets a decorative illustration picked from its
// title (or a stable hash of its id). Purely presentational.
const THEMES = [
  { match: /react|front|ui|web|javascript|css|html/i, icon: Braces, from: '#312e81', via: '#4338ca', to: '#0e7490' },
  { match: /node|backend|api|server|express/i, icon: Server, from: '#064e3b', via: '#047857', to: '#1e3a8a' },
  { match: /cloud|aws|azure|gcp|devops|docker|kubernetes/i, icon: Cloud, from: '#1e1b4b', via: '#4338ca', to: '#0369a1' },
  { match: /data|python|analytics|sql|machine|ml|ai\b/i, icon: BarChart3, from: '#0c4a6e', via: '#1d4ed8', to: '#6d28d9' },
  { match: /secur|cyber|compliance|safety/i, icon: ShieldCheck, from: '#3b0764', via: '#6d28d9', to: '#be185d' },
  { match: /network|telecom|5g|wireless|rf/i, icon: Network, from: '#082f49', via: '#0e7490', to: '#4338ca' },
  { match: /database|storage/i, icon: Database, from: '#1e1b4b', via: '#6d28d9', to: '#0f766e' },
  { match: /hardware|embedded|chip|electr/i, icon: Cpu, from: '#172554', via: '#1d4ed8', to: '#0891b2' },
  { match: /process|workflow|operation|project/i, icon: Workflow, from: '#2e1065', via: '#5b21b6', to: '#0369a1' },
  { match: /maint|install|field|repair/i, icon: Wrench, from: '#431407', via: '#c2410c', to: '#6d28d9' },
];
const FALLBACK_ICONS = [Layers, BookOpen, Cpu, Workflow];

function hash(str = '') {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

export function courseTheme(course) {
  const found = THEMES.find((t) => t.match.test(course?.title || ''));
  if (found) return found;
  const h = hash(course?.id || course?.title);
  return { ...THEMES[h % THEMES.length], icon: FALLBACK_ICONS[h % FALLBACK_ICONS.length] };
}

export default function CourseArt({ course, className, compact = false }) {
  const { icon: Icon, from, via, to } = courseTheme(course);
  return (
    <div className={cn('relative overflow-hidden', className)} aria-hidden="true">
      <div
        className="absolute inset-0 transition-transform duration-500 ease-out group-hover:scale-[1.06]"
        style={{ background: `linear-gradient(135deg, ${from} 0%, ${via} 55%, ${to} 100%)` }}
      >
        <div
          className="absolute inset-0 opacity-25"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,.14) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.14) 1px, transparent 1px)',
            backgroundSize: compact ? '14px 14px' : '22px 22px',
          }}
        />
        <div className="absolute -right-6 -top-8 w-32 h-32 rounded-full bg-white/15 blur-2xl" />
        <div className="absolute -left-8 -bottom-10 w-32 h-32 rounded-full blur-2xl" style={{ background: to, opacity: 0.6 }} />
      </div>
      <div className="relative h-full w-full flex items-center justify-center">
        <div className={cn(
          'rounded-2xl bg-white/10 ring-1 ring-white/25 backdrop-blur-sm flex items-center justify-center shadow-lg shadow-black/20',
          compact ? 'w-11 h-11' : 'w-16 h-16',
        )}
        >
          <Icon className={cn('text-white drop-shadow', compact ? 'w-5 h-5' : 'w-8 h-8')} strokeWidth={1.75} />
        </div>
      </div>
    </div>
  );
}
