import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartCard, { AXIS_TICK, TOOLTIP_PROPS } from '@/components/admin/dashboard/ChartCard';

// Average completion % per course, top 8 courses by enrollment.
function buildSeries(progress, courses) {
  const byCourse = {};
  progress.forEach((p) => {
    const entry = (byCourse[p.course_id] ||= { sum: 0, count: 0 });
    entry.sum += p.percentage || 0;
    entry.count += 1;
  });
  const titles = Object.fromEntries(courses.map((c) => [c.id, c.title]));
  return Object.entries(byCourse)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 8)
    .map(([id, { sum, count }]) => {
      const title = titles[id] || 'Unknown course';
      return { course: title.length > 16 ? `${title.slice(0, 15)}…` : title, fullTitle: title, completion: Math.round(sum / count), learners: count };
    });
}

export default function CompletionChart({ progress = [], courses = [] }) {
  const data = buildSeries(progress, courses);
  return (
    <ChartCard title="Completion by course" description="Average learner completion %" empty={!data.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="course" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />
          <Tooltip
            {...TOOLTIP_PROPS}
            labelFormatter={(_, payload) => payload?.[0]?.payload?.fullTitle || ''}
            formatter={(value, _name, item) => [`${value}% (${item.payload.learners} learners)`, 'Completion']}
          />
          <Bar dataKey="completion" fill="hsl(var(--chart-2))" radius={[6, 6, 0, 0]} maxBarSize={40} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
