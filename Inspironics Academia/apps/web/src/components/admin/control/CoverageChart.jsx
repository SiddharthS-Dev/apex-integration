import { useRef } from 'react';
import { useInView } from 'framer-motion';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { coverageSeries } from './controlData';

const SERIES = [
  { key: 'approved', label: 'Approved', color: '#34d399' },
  { key: 'review', label: 'Needs review', color: '#fbbf24' },
  { key: 'generating', label: 'Generating', color: '#38bdf8' },
  { key: 'pending', label: 'Not generated', color: '#64748b' },
];

export default function CoverageChart({ lessons }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, margin: '-40px' });
  const data = coverageSeries(lessons);
  const last = data.at(-1) || {};
  const total = SERIES.reduce((s, x) => s + (last[x.key] || 0), 0);
  const pctApproved = total ? Math.round(((last.approved || 0) / total) * 100) : 0;
  const generated = (last.approved || 0) + (last.review || 0) + (last.generating || 0);

  return (
    <section className="glass tone-idle p-4 sm:p-5 min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Content coverage</h2>
          <p className="text-xs text-muted-foreground">Lessons over the last 30 days, by current status</p>
        </div>
        <div className="flex items-center gap-4">
          <ul className="hidden sm:flex flex-wrap gap-3 text-xs">
            {SERIES.map((s) => (
              <li key={s.key} className="flex items-center gap-1.5 text-muted-foreground">
                <span className="w-2 h-2 rounded-full" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />{s.label}
              </li>
            ))}
          </ul>
          <div className="text-right">
            <div className="text-3xl font-bold tabular-nums leading-none">{pctApproved}%</div>
            <div className="text-[11px] text-muted-foreground">approved</div>
          </div>
        </div>
      </div>
      <div ref={ref} className="h-64 mt-4 -ml-3">
        {total === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">No lessons yet — process a playbook to build a course.</div>
        ) : inView && (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                {SERIES.map((s) => (
                  <linearGradient key={s.key} id={`cov-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={s.color} stopOpacity={0.55} />
                    <stop offset="100%" stopColor={s.color} stopOpacity={0.05} />
                  </linearGradient>
                ))}
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} interval={6} />
              <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={36} tick={{ fontSize: 11, fill: 'hsl(var(--muted-foreground))' }} />
              <Tooltip
                contentStyle={{ background: 'hsl(var(--popover))', border: '1px solid hsl(var(--border))', borderRadius: 10, fontSize: 12, color: 'hsl(var(--foreground))' }}
              />
              {SERIES.map((s) => (
                <Area
                  key={s.key} type="monotone" dataKey={s.key} name={s.label} stackId="1"
                  stroke={s.color} strokeWidth={2} fill={`url(#cov-${s.key})`} animationDuration={1200}
                  style={{ filter: `drop-shadow(0 0 4px ${s.color}66)` }}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-muted/40 px-4 py-3 text-sm">
        <span className="text-muted-foreground">Generation rate</span>
        <span><span className="font-semibold">{total ? Math.round((generated / total) * 100) : 0}%</span> <span className="text-muted-foreground">of lessons have content ({generated}/{total})</span></span>
      </div>
    </section>
  );
}
