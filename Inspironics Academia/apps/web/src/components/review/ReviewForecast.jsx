import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AXIS_TICK, TOOLTIP_PROPS } from '@/components/admin/dashboard/ChartCard';
import { Panel, SectionHeader } from '@/components/dashboard/DashParts';
import { CalendarDays } from 'lucide-react';

const dayLabel = (iso, i) => (i === 0 ? 'Today' : new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' }));

// Cards coming due over the next seven days (today includes anything overdue). One series, so the
// title names it and there is no legend; exact counts are in the tooltip and the screen-reader table.
export default function ReviewForecast({ forecast = [] }) {
  const data = forecast.map((f, i) => ({ ...f, label: dayLabel(f.date, i) }));
  const total = forecast.reduce((n, f) => n + f.count, 0);
  return (
    <Panel>
      <SectionHeader icon={CalendarDays} title="Due this week" subtitle={`${total} card${total === 1 ? '' : 's'} over the next 7 days`} />
      <div className="h-40" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 5, left: -24, bottom: 0 }} barCategoryGap="28%">
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
            <XAxis dataKey="label" tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <YAxis allowDecimals={false} tick={AXIS_TICK} tickLine={false} axisLine={false} />
            <Tooltip {...TOOLTIP_PROPS} formatter={(v) => [v, 'Cards due']} />
            <Bar dataKey="count" name="Cards due" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} maxBarSize={36} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <table className="sr-only">
        <caption>Cards due per day</caption>
        <tbody>{data.map((d) => <tr key={d.date}><th scope="row">{d.date}</th><td>{d.count}</td></tr>)}</tbody>
      </table>
    </Panel>
  );
}
