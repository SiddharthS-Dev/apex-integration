import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { fmtInt, fmtSeconds, fmtUsd, useRefreshStudio, useUsage } from '@/lib/studio';
import { Field, Notice } from './StudioFields';

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const LIMIT_FIELDS = [
  { key: 'aiDailyRequests', label: 'AI requests per day', unit: 'requests' },
  { key: 'aiMonthlyBudgetUsd', label: 'Monthly AI budget', unit: 'USD (estimated)' },
  { key: 'ttsMonthlyChars', label: 'Voice-over per month', unit: 'characters' },
  { key: 'videoMonthlyMinutes', label: 'Video rendering per month', unit: 'minutes' },
];

// Real usage from the generation log: this month and today, by provider, against the limits.
export default function UsageBudget() {
  const { data: u, isLoading } = useUsage();
  const refresh = useRefreshStudio();
  const [limits, setLimits] = useState({});
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (u?.limits) setLimits(Object.fromEntries(Object.entries(u.limits).map(([k, v]) => [k, v ?? '']))); }, [u?.limits]);
  if (isLoading || !u) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const m = u.month;

  const save = async () => {
    setSaving(true);
    try {
      await api.studio.setLimits(Object.fromEntries(Object.entries(limits).map(([k, v]) => [k, v === '' ? null : Number(v)])));
      toast.success('Limits saved');
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not save the limits');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Estimated spend this month" value={fmtUsd(u.estimated_spend_usd)} sub={u.budget_remaining_usd == null ? 'No monthly budget set' : `${fmtUsd(u.budget_remaining_usd)} of the budget left`} />
        <Stat label="AI requests this month" value={fmtInt(m.ai.requests)} sub={`${fmtInt(m.ai.input_tokens)} in · ${fmtInt(m.ai.output_tokens)} out tokens · ${fmtInt(m.ai.cached)} cached`} />
        <Stat label="Voice-over this month" value={`${fmtInt(m.tts.characters)} chars`} sub={`${fmtInt(m.tts.requests)} clips · ${fmtInt(m.tts.cached)} reused from cache`} />
        <Stat label="Video rendered this month" value={fmtSeconds(m.render.seconds)} sub={`${fmtInt(m.render.requests)} renders · runs on this server (no API cost)`} />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="AI requests today" value={fmtInt(u.today.ai.requests)} sub={u.ai_requests_left_today == null ? 'No daily limit' : `${fmtInt(u.ai_requests_left_today)} left today`} />
        <Stat label="Failed or blocked (month)" value={fmtInt(m.ai.failed + m.tts.failed + m.render.failed)} sub="Not billed as successful work" />
        <Stat label="Served from cache (month)" value={fmtInt(m.ai.cached + m.tts.cached)} sub="Requests answered at no cost" />
      </div>
      {(m.ai.unpriced > 0 || m.tts.unpriced > 0) && <Notice tone="warn">{fmtInt(m.ai.unpriced + m.tts.unpriced)} requests this month have no known price, so they are counted but not included in the estimated spend. {u.pricing_note}</Notice>}

      <section className="space-y-2">
        <h2 className="font-semibold">By provider (this month)</h2>
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead>Type</TableHead><TableHead>Provider</TableHead><TableHead className="text-right">Requests</TableHead><TableHead className="text-right">Tokens in / out</TableHead><TableHead className="text-right">Characters</TableHead><TableHead className="text-right">Video</TableHead><TableHead className="text-right">Est. cost</TableHead></TableRow></TableHeader>
            <TableBody>
              {u.providers.map((p) => (
                <TableRow key={`${p.kind}-${p.provider}`}>
                  <TableCell>{p.kind}</TableCell><TableCell>{p.provider}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtInt(p.n)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.kind === 'ai' ? `${fmtInt(p.input_tokens)} / ${fmtInt(p.output_tokens)}` : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.kind === 'tts' ? fmtInt(p.characters) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.kind === 'render' ? fmtSeconds(p.seconds) : '—'}</TableCell>
                  <TableCell className="text-right tabular-nums">{fmtUsd(p.cost_usd)}</TableCell>
                </TableRow>
              ))}
              {!u.providers.length && <TableRow><TableCell colSpan={7} className="py-6 text-center text-sm text-muted-foreground">No paid generations this month.</TableCell></TableRow>}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="space-y-3 rounded-2xl border border-border bg-card p-5">
        <div>
          <h2 className="font-semibold">Limits</h2>
          <p className="text-sm text-muted-foreground">When a limit is reached, new paid generations stop with a clear message; everything already generated stays available. Leave a field empty for no limit.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {LIMIT_FIELDS.map((f) => (
            <Field key={f.key} label={f.label} htmlFor={`lim-${f.key}`} hint={f.unit}>
              <Input id={`lim-${f.key}`} type="number" min="0" step="any" value={limits[f.key] ?? ''} onChange={(e) => setLimits((l) => ({ ...l, [f.key]: e.target.value }))} placeholder="No limit" />
            </Field>
          ))}
        </div>
        <Button onClick={save} disabled={saving}><Save /> Save limits</Button>
      </section>
    </div>
  );
}
