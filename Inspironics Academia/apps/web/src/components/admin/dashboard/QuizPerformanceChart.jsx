import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import ChartCard, { AXIS_TICK, TOOLTIP_PROPS } from '@/components/admin/dashboard/ChartCard';

const TYPES = [
  { key: 'lesson', label: 'Lesson quiz' },
  { key: 'chapter', label: 'Chapter test' },
  { key: 'final', label: 'Final test' },
];

function buildSeries(attempts) {
  return TYPES.map(({ key, label }) => {
    const items = attempts.filter((a) => (a.type || 'lesson') === key);
    const n = items.length;
    return {
      type: label,
      average: n ? Math.round(items.reduce((s, a) => s + (a.percentage || 0), 0) / n) : 0,
      passRate: n ? Math.round((items.filter((a) => a.passed).length / n) * 100) : 0,
      attempts: n,
    };
  });
}

export default function QuizPerformanceChart({ attempts = [] }) {
  const data = buildSeries(attempts);
  return (
    <ChartCard title="Test performance" description="Average score and pass rate by test type" empty={!attempts.length}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
          <XAxis dataKey="type" tick={AXIS_TICK} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} tick={AXIS_TICK} tickLine={false} axisLine={false} unit="%" />
          <Tooltip {...TOOLTIP_PROPS} formatter={(value, name) => [`${value}%`, name]} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="average" name="Avg score" fill="hsl(var(--chart-1))" radius={[6, 6, 0, 0]} maxBarSize={32} />
          <Bar dataKey="passRate" name="Pass rate" fill="hsl(var(--chart-4))" radius={[6, 6, 0, 0]} maxBarSize={32} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}
