import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { format, subDays } from 'date-fns';
import ChartCard, { AXIS_TICK, TOOLTIP_PROPS } from '@/components/admin/dashboard/ChartCard';

// Daily new enrollments (CourseProgress created_date) over the last 30 days.
function buildSeries(progress) {
  const days = Array.from({ length: 30 }, (_, i) => subDays(new Date(), 29 - i));
  const buckets = Object.fromEntries(days.map((d) => [format(d, 'yyyy-MM-dd'), 0]));
  progress.forEach((p) => {
    if (!p.created_date) return;
    const key = format(new Date(p.created_date), 'yyyy-MM-dd');
    if (key in buckets) buckets[key] += 1;
  });
  return days.map((d) => ({ day: format(d, 'MMM d'), enrollments: buckets[format(d, 'yyyy-MM-dd')] }));
}

export default function EnrollmentChart({ progress = [] }) {
  const data = buildSeries(progress);
  return (
    <ChartCard title="Enrollments" description="New course enrollments, last 30 days" empty={!progress.length}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="enrollFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="hsl(var(--chart-1))" stopOpacity={0.35} />
              <stop offset="100%" stopColor="hsl(var(--chart-1))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="day" tick={AXIS_TICK} tickLine={false} axisLine={false} interval={6} />
          <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <Tooltip {...TOOLTIP_PROPS} />
          <Area type="monotone" dataKey="enrollments" name="Enrollments" stroke="hsl(var(--chart-1))" strokeWidth={2} fill="url(#enrollFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
