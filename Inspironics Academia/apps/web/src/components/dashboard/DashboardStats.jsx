import { Link } from 'react-router-dom';
import { Award, BookOpen, CheckCircle2, ChevronRight, Target } from 'lucide-react';
import { CountUp, IconTile, ProgressBar } from '@/components/dashboard/DashParts';

function KpiCard({ to, icon, tone, label, value, suffix, hint, pct, pctLabel }) {
  return (
    <Link to={to} className="group dash-panel dash-hover p-4 sm:p-5 flex flex-col gap-3 min-w-0">
      <div className="flex items-start gap-3">
        <IconTile icon={icon} tone={tone} />
        <div className="min-w-0 flex-1">
          <div className="text-xs sm:text-sm text-muted-foreground truncate">{label}</div>
          <div className="text-2xl sm:text-[28px] font-bold leading-tight tracking-tight">
            {value == null ? '—' : <CountUp value={value} suffix={suffix} />}
          </div>
          <div className="text-xs text-muted-foreground truncate">{hint}</div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>
      {pct != null && (
        <div className="flex items-center gap-3 mt-auto">
          <ProgressBar value={pct} tone={tone} />
          <span className="text-xs font-medium text-muted-foreground tabular-nums shrink-0 min-w-[2.5rem] text-right">{pctLabel ?? `${pct}%`}</span>
        </div>
      )}
    </Link>
  );
}

export default function DashboardStats({ stats }) {
  const { inProgress, completed, started, avgScore, avgProgress, attempts, certificates } = stats;
  const completedPct = started ? Math.round((completed / started) * 100) : 0;
  const certifiedPct = completed ? Math.min(100, Math.round((certificates / completed) * 100)) : null;

  return (
    <div className="grid gap-3 sm:gap-4 grid-cols-1 min-[420px]:grid-cols-2 lg:grid-cols-4 xl:grid-cols-2 2xl:grid-cols-4">
      <KpiCard
        to="/my-learning" icon={BookOpen} tone="blue" label="In progress" value={inProgress}
        hint={inProgress === 1 ? 'Course in progress' : 'Courses in progress'}
        pct={inProgress ? avgProgress : 0} pctLabel={inProgress ? `${avgProgress}%` : '0%'}
      />
      <KpiCard
        to="/my-learning" icon={CheckCircle2} tone="green" label="Completed" value={completed}
        hint={started ? `${completed} of ${started} started` : 'Finished or passed'}
        pct={completedPct}
      />
      <KpiCard
        to="/tests" icon={Target} tone="violet" label="Avg quiz score" value={avgScore} suffix="%"
        hint={`Across ${attempts} attempt${attempts === 1 ? '' : 's'}`}
        pct={avgScore ?? 0} pctLabel={avgScore == null ? '—' : `${avgScore}%`}
      />
      <KpiCard
        to="/certificates" icon={Award} tone="cyan" label="Certificates" value={certificates}
        hint="Earned so far"
        pct={certifiedPct ?? 0} pctLabel={certifiedPct == null ? '—' : `${certifiedPct}%`}
      />
    </div>
  );
}
