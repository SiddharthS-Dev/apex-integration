import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { apiUrl } from '@/lib/mount';
import { fmtInt, fmtSeconds, fmtUsd, useHistory } from '@/lib/studio';
import { Choice } from './StudioFields';

const KINDS = [{ value: '', label: 'Everything' }, { value: 'ai', label: 'AI text' }, { value: 'tts', label: 'Voice-over' }, { value: 'render', label: 'Video renders' }];
const KIND_LABEL = { ai: 'AI text', tts: 'Voice-over', render: 'Render' };
const STATUS_VARIANT = { ok: 'default', cached: 'secondary', error: 'destructive', blocked: 'destructive', cancelled: 'outline' };

// Every generation the server recorded: AI calls, voice-overs and renders, with what each used.
export default function GenerationHistory() {
  const [kind, setKind] = useState('');
  const { data = [], isLoading } = useHistory(kind);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="w-56"><Choice id="gh-kind" value={kind} onChange={setKind} options={KINDS} /></div>
        <span className="text-sm text-muted-foreground">{isLoading ? 'Loading…' : `${data.length} most recent`}</span>
      </div>
      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead><TableHead>Type</TableHead><TableHead>For</TableHead><TableHead>Provider</TableHead><TableHead>Status</TableHead>
              <TableHead className="text-right">Tokens in / out</TableHead><TableHead className="text-right">Characters</TableHead><TableHead className="text-right">Video</TableHead>
              <TableHead className="text-right">Took</TableHead><TableHead className="text-right">Est. cost</TableHead><TableHead>Output</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.map((g) => (
              <TableRow key={g.id}>
                <TableCell className="whitespace-nowrap text-xs" title={g.id}>{new Date(g.created_at).toLocaleString()}</TableCell>
                <TableCell>{KIND_LABEL[g.kind] || g.kind}</TableCell>
                <TableCell className="max-w-48 truncate text-xs" title={g.error || ''}>{g.operation || '—'}</TableCell>
                <TableCell className="text-xs">{g.provider}{g.model ? <span className="text-muted-foreground"> · {g.model}</span> : null}</TableCell>
                <TableCell><Badge variant={STATUS_VARIANT[g.status] || 'outline'} className="capitalize" title={g.error || ''}>{g.status}</Badge></TableCell>
                <TableCell className="text-right tabular-nums text-xs">{g.kind === 'ai' ? `${fmtInt(g.input_tokens)} / ${fmtInt(g.output_tokens)}` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{g.kind === 'tts' ? fmtInt(g.characters) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{g.kind === 'render' && g.seconds ? fmtSeconds(g.seconds) : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{g.duration_ms ? `${(g.duration_ms / 1000).toFixed(1)} s` : '—'}</TableCell>
                <TableCell className="text-right tabular-nums text-xs">{g.status === 'cached' ? '$0' : fmtUsd(g.cost_usd)}</TableCell>
                <TableCell>{g.output_ref ? <a className="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={apiUrl(g.output_ref)} target="_blank" rel="noreferrer">Open <ExternalLink className="h-3 w-3" /></a> : '—'}</TableCell>
              </TableRow>
            ))}
            {!isLoading && !data.length && <TableRow><TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">Nothing generated yet.</TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
