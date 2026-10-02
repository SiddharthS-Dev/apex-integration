import { Flame, GraduationCap, Lock, Rocket, Target, Trophy } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { Panel, ProgressBar, SectionHeader, TONES } from '@/components/dashboard/DashParts';

const ICONS = { starter: Rocket, quiz: Target, hero: GraduationCap, consistent: Flame };

function Badge({ m }) {
  const Icon = ICONS[m.key];
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div tabIndex={0} className="group flex flex-col items-center text-center gap-1.5 min-w-0 rounded-xl p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <div
            className={cn(
              'relative w-11 h-11 flex items-center justify-center transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:scale-105 ring-1 ring-inset',
              '[clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)]',
              m.unlocked ? TONES[m.tone].tile : 'bg-muted text-muted-foreground ring-transparent grayscale',
            )}
          >
            <Icon className="w-5 h-5" />
          </div>
          <div className="text-[11px] font-semibold leading-tight w-full">{m.label}</div>
          <div className="text-[10px] text-muted-foreground inline-flex items-center gap-0.5">
            {!m.unlocked && <Lock className="w-2.5 h-2.5" />}{m.display}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent>{m.unlocked ? `Unlocked — ${m.hint}` : m.hint}</TooltipContent>
    </Tooltip>
  );
}

export default function Achievements({ streak, items }) {
  const streakPct = Math.min(100, Math.round((streak / 7) * 100));
  return (
    <Panel>
      <SectionHeader icon={Trophy} tone="orange" title="Your Achievements" subtitle="Milestones from your activity" />
      <div className="dash-panel p-3.5 flex items-center gap-3.5">
        <div className="w-14 h-14 shrink-0 flex items-center justify-center bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-lg shadow-orange-500/30 [clip-path:polygon(50%_0,93%_25%,93%_75%,50%_100%,7%_75%,7%_25%)]">
          <Flame className="w-7 h-7" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{streak > 0 ? `${streak} Day Streak` : 'No streak yet'}</div>
          <div className="text-xs text-muted-foreground">{streak >= 7 ? 'Consistent learner!' : 'Reach 7 days in a row'}</div>
          <div className="flex items-center gap-2 mt-2">
            <ProgressBar value={streakPct} tone="violet" />
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">{Math.min(streak, 7)} / 7</span>
          </div>
        </div>
      </div>
      <TooltipProvider delayDuration={150}>
        <div className="grid grid-cols-4 gap-1 mt-3">
          {items.map((m) => <Badge key={m.key} m={m} />)}
        </div>
      </TooltipProvider>
    </Panel>
  );
}
