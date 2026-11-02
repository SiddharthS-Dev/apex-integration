import { AlertTriangle, CheckCircle2, Clock, Hourglass, RefreshCw, ShieldCheck, TimerOff } from 'lucide-react';
import { cn } from '@/lib/utils';

function Tile({ icon: Icon, label, value, hint, accent }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 min-w-0">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className={cn('w-4 h-4 shrink-0', accent)} /> <span className="truncate">{label}</span>
      </div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{value ?? '—'}</div>
      {hint && <div className="text-[11px] text-muted-foreground truncate">{hint}</div>}
    </div>
  );
}

export default function ComplianceKpis({ kpis }) {
  return (
    <div className="grid gap-3 grid-cols-2 md:grid-cols-4 xl:grid-cols-7">
      <Tile
        icon={ShieldCheck} accent="text-emerald-500" label="Compliance rate"
        value={kpis.compliance_rate == null ? '—' : `${kpis.compliance_rate}%`}
        hint={`${kpis.certified_learners} certified learner${kpis.certified_learners === 1 ? '' : 's'}`}
      />
      <Tile icon={CheckCircle2} accent="text-emerald-500" label="Valid" value={kpis.valid} hint={`of ${kpis.certificates} current holdings`} />
      <Tile icon={RefreshCw} accent="text-amber-500" label="Recert required" value={kpis.recert_required} hint="Playbook changed" />
      <Tile icon={TimerOff} accent="text-rose-500" label="Expired" value={kpis.expired} hint="Validity ended" />
      <Tile icon={Hourglass} accent="text-sky-500" label="Open recerts" value={kpis.open_recerts} hint="Awaiting course or due" />
      <Tile icon={AlertTriangle} accent="text-rose-500" label="Overdue" value={kpis.overdue} hint="Past due date" />
      <Tile icon={Clock} accent="text-violet-500" label="Completed (30d)" value={kpis.completed_30d} hint="Recertified recently" />
    </div>
  );
}
