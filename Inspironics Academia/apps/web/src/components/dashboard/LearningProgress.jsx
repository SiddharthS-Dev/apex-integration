import { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useInView } from 'framer-motion';
import { BarChart3, ClipboardList } from 'lucide-react';
import {
  Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CountUp, DashEmpty, Panel, SectionHeader } from '@/components/dashboard/DashParts';
import { attemptSeries } from '@/components/dashboard/dashboardData';

const RANGES = [7, 14, 30];

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const { attempts, score } = payload[0].payload;
  return (
    <div className="rounded-lg border border-[hsl(var(--dash-line))] bg-popover/95 backdrop-blur px-3 py-2 text-xs shadow-xl">
      <div className="font-semibold mb-1">{label}</div>
      <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-sm bg-violet-500" />{attempts} attempt{attempts === 1 ? '' : 's'}</div>
      <div className="flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-cyan-400" />{score == null ? 'No score' : `${score}% avg score`}</div>
    </div>
  );
}

function Stat({ label, value, suffix, tone }) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground truncate">{label}</div>
      <div className={cn('text-lg font-bold leading-tight', tone)}>
        {value == null ? '—' : <CountUp value={value} suffix={suffix} />}
      </div>
    </div>
  );
}

export default function LearningProgress({ attempts, completed }) {
  const [span, setSpan] = useState(7);
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-60px' });
  const data = useMemo(() => attemptSeries(attempts, span), [attempts, span]);
  const inRange = data.reduce((s, d) => s + d.attempts, 0);
  const scored = data.filter((d) => d.score != null);
  const avg = inRange ? Math.round(data.reduce((s, d) => s + (d.score ?? 0) * d.attempts, 0) / inRange) : null;

  return (
    <Panel className="flex flex-col min-w-0">
      <SectionHeader
        icon={BarChart3}
        title="Learning Progress"
        subtitle="Quiz & test activity"
        action={(
          <div role="group" aria-label="Date range" className="flex rounded-lg border border-[hsl(var(--dash-line))] p-0.5 text-[11px] shrink-0">
            {RANGES.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setSpan(r)}
                aria-pressed={span === r}
                className={cn(
                  'px-2 py-1 rounded-md font-medium transition-colors',
                  span === r ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {r}d
              </button>
            ))}
          </div>
        )}
      />
      <div ref={ref} className="h-44 2xl:h-auto 2xl:flex-1 2xl:min-h-44 -ml-2">
        {attempts.length === 0 ? (
          <DashEmpty
            icon={ClipboardList}
            title="No quiz activity yet"
            description="Your quiz and test results will chart here."
            action={<Button asChild size="sm" variant="outline"><Link to="/tests">Go to tests</Link></Button>}
            className="ml-2 h-full py-4"
          />
        ) : inView && (
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="lp-bar" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor="#8b5cf6" stopOpacity={0.95} />
                  <stop offset="1" stopColor="#6366f1" stopOpacity={0.35} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} stroke="hsl(var(--dash-line))" strokeDasharray="3 3" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval="preserveStartEnd" minTickGap={8} />
              <YAxis yAxisId="n" allowDecimals={false} tickLine={false} axisLine={false} width={28} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
              <YAxis yAxisId="pct" orientation="right" domain={[0, 100]} hide />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--dash-glow) / 0.08)' }} />
              <Bar yAxisId="n" dataKey="attempts" fill="url(#lp-bar)" radius={[4, 4, 0, 0]} maxBarSize={18} animationDuration={900} />
              <Line
                yAxisId="pct" type="monotone" dataKey="score" connectNulls stroke="#22d3ee" strokeWidth={2.5}
                dot={{ r: 3, fill: '#22d3ee', strokeWidth: 0 }} activeDot={{ r: 5 }} animationDuration={1100}
              />
            </ComposedChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-4 pt-4 border-t border-[hsl(var(--dash-line))] grid grid-cols-3 gap-3">
        <Stat label={`Attempts (${span}d)`} value={inRange} />
        <Stat label={`Avg score (${span}d)`} value={scored.length ? avg : null} suffix="%" tone="text-cyan-600 dark:text-cyan-300" />
        <Stat label="Courses done" value={completed} tone="text-emerald-600 dark:text-emerald-300" />
      </div>
    </Panel>
  );
}
