import { useState } from 'react';
import { BarChart3 } from 'lucide-react';
import EmptyState from '@/components/EmptyState';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Avatar } from '@/components/meetings/MeetingBits';

const minutes = (s) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} s`);

/**
 * Talk share per speaker: one series, so one hue and no legend; thin bars from a shared baseline,
 * value labels at the bar ends, a tooltip on hover/focus, and the table below as the table view.
 */
export default function ParticipationTab({ meeting }) {
  const stats = meeting.speaker_stats || [];
  const [hover, setHover] = useState(null);
  if (!stats.length) return <EmptyState icon={BarChart3} title="No participation data" description="It appears once the transcript has been processed." />;
  const max = Math.max(...stats.map((s) => s.share), 1);
  const participants = meeting.participants || stats.map((s) => s.name);

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-border bg-card p-5">
        <h2 className="font-semibold">Share of the conversation</h2>
        <p className="mb-5 text-xs text-muted-foreground">Percentage of all words spoken in the meeting.</p>
        <ul className="space-y-3" role="list">
          {stats.map((s) => (
            <li
              key={s.name}
              className="relative grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
              onMouseEnter={() => setHover(s.name)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(s.name)}
              onBlur={() => setHover(null)}
              tabIndex={0}
              aria-label={`${s.name}: ${s.share}% of words, ${s.turns} turns, ${minutes(s.seconds)}`}
            >
              <span className="flex min-w-0 items-center gap-2 text-sm">
                <Avatar name={s.name} participants={participants} size="h-6 w-6 text-[10px]" />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="relative flex h-6 items-center">
                <span
                  className="h-3 rounded-r-[4px] transition-opacity"
                  style={{ width: `${(s.share / max) * 88}%`, background: 'hsl(var(--chart-1))', opacity: hover && hover !== s.name ? 0.45 : 1 }}
                />
                <span className="ml-2 text-xs font-medium tabular-nums">{s.share}%</span>
              </span>
              {hover === s.name && (
                <span role="tooltip" className="pointer-events-none absolute right-0 -top-9 z-10 rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-md">
                  <span className="font-medium">{s.name}</span> · {s.turns} turns · {s.words.toLocaleString()} words · {minutes(s.seconds)}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <div className="overflow-x-auto rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Speaker</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Turns</TableHead>
              <TableHead className="text-right">Words</TableHead>
              <TableHead className="text-right">Speaking time</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map((s) => (
              <TableRow key={s.name}>
                <TableCell className="font-medium">{s.name}</TableCell>
                <TableCell className="text-right tabular-nums">{s.share}%</TableCell>
                <TableCell className="text-right tabular-nums">{s.turns}</TableCell>
                <TableCell className="text-right tabular-nums">{s.words.toLocaleString()}</TableCell>
                <TableCell className="text-right tabular-nums">{minutes(s.seconds)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">Speaking time is estimated from the transcript's timestamps.</p>
    </div>
  );
}
