import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { FileText, Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import { Avatar } from '@/components/meetings/MeetingBits';
import { formatClock } from '@/lib/meetings';
import { cn } from '@/lib/utils';

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function Highlight({ text, term }) {
  if (!term) return text;
  const parts = text.split(new RegExp(`(${escape(term)})`, 'gi'));
  return parts.map((p, i) => (i % 2
    ? <mark key={i} className="rounded bg-amber-200 px-0.5 text-foreground dark:bg-amber-500/40">{p}</mark>
    : <Fragment key={i}>{p}</Fragment>));
}

/** The transcript turn by turn. `focusTime` (seconds) scrolls to and flashes the turn said then. */
export default function TranscriptTab({ transcript, isLoading, participants = [], focusTime }) {
  const [q, setQ] = useState('');
  const [speaker, setSpeaker] = useState('all');
  const refs = useRef({});
  const segments = useMemo(() => transcript?.segments || [], [transcript]);
  const term = q.trim();

  const focusIndex = useMemo(() => {
    if (focusTime == null) return -1;
    let idx = -1;
    segments.forEach((s, i) => { if (s.start != null && s.start <= focusTime + 0.5) idx = i; });
    return idx;
  }, [segments, focusTime]);

  useEffect(() => {
    if (focusIndex < 0) return;
    setQ('');
    setSpeaker('all');
    const id = setTimeout(() => refs.current[focusIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80);
    return () => clearTimeout(id);
  }, [focusIndex]);

  if (isLoading) return <LoadingState label="Loading transcript…" />;
  if (!segments.length) return <EmptyState icon={FileText} title="No transcript" description="The transcript appears here once the meeting has been processed." />;

  const shown = segments
    .map((s, i) => ({ ...s, i }))
    .filter((s) => (speaker === 'all' || s.speaker === speaker) && (!term || s.text.toLowerCase().includes(term.toLowerCase())));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input id="transcript-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search what was said" className="pl-9" />
        </div>
        <Select value={speaker} onValueChange={setSpeaker}>
          <SelectTrigger className="w-full sm:w-52" aria-label="Speaker"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Everyone</SelectItem>
            {participants.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground tabular-nums">{shown.length} of {segments.length} turns</span>
      </div>
      <ol className="space-y-1 rounded-2xl border border-border bg-card p-2 sm:p-3">
        {shown.length === 0 && <li className="p-4 text-sm text-muted-foreground">Nothing matches.</li>}
        {shown.map((s) => (
          <li
            key={s.i}
            ref={(el) => { refs.current[s.i] = el; }}
            className={cn('flex gap-3 rounded-xl p-3 transition-colors', s.i === focusIndex && 'bg-amber-100/70 ring-1 ring-amber-300 dark:bg-amber-500/10 dark:ring-amber-500/40')}
          >
            <Avatar name={s.speaker} participants={participants} size="h-8 w-8 text-xs" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold">{s.speaker}</span>
                {s.start != null && <span className="text-xs text-muted-foreground tabular-nums">{formatClock(s.start)}</span>}
              </div>
              <p className="mt-0.5 max-w-[80ch] text-sm leading-relaxed"><Highlight text={s.text} term={term} /></p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
