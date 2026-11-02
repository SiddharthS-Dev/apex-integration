import { BrainCircuit, CalendarClock, CheckCircle2, Flame, Sparkles, Target } from 'lucide-react';
import { CountUp, IconTile } from '@/components/dashboard/DashParts';

function Tile({ icon, tone, label, value, suffix, hint }) {
  return (
    <div className="dash-panel p-4 flex items-start gap-3 min-w-0">
      <IconTile icon={icon} tone={tone} size="sm" />
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground truncate">{label}</div>
        <div className="text-2xl font-bold leading-tight tracking-tight">
          {value == null ? '—' : <CountUp value={value} suffix={suffix} />}
        </div>
        <div className="text-[11px] text-muted-foreground truncate">{hint}</div>
      </div>
    </div>
  );
}

export default function ReviewStats({ stats, newToday }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
      <Tile icon={CalendarClock} tone="orange" label="Due now" value={stats.due_today} hint={stats.overdue ? `${stats.overdue} overdue` : 'Scheduled for today'} />
      <Tile icon={Sparkles} tone="cyan" label="New today" value={newToday} hint={`${stats.new_available} unseen in total`} />
      <Tile icon={CheckCircle2} tone="green" label="Reviewed today" value={stats.reviewed_today} hint={`${stats.reviews_30d} in 30 days`} />
      <Tile
        icon={Target} tone="violet" label="Retention" value={stats.retention_30d} suffix="%"
        hint={stats.retention_30d == null ? 'Review more to measure' : 'Recalled, last 30 days'}
      />
      <Tile icon={Flame} tone="orange" label="Review streak" value={stats.streak} hint={stats.streak === 1 ? 'day' : 'days in a row'} />
      <Tile icon={BrainCircuit} tone="blue" label="Mature cards" value={stats.mature} hint={`of ${stats.learned} learned (21d+ interval)`} />
    </div>
  );
}
