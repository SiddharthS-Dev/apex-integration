import { useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, ScrollText } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import { CoreQueryError } from '@/components/core/CoreNotice';
import { useDebounced } from '@/components/core/UserPicker';
import { AUDIT_ACTIONS, formatWhen, useUserLabel } from '@/lib/core';

const PAGE = 25;

function Actor({ event }) {
  const label = useUserLabel(event.actor_user_id);
  if (!event.actor_user_id) return <span className="text-muted-foreground">{event.actor_kind}</span>;
  return <span title={event.actor_user_id}>{label || `${event.actor_user_id.slice(0, 8)}…`}</span>;
}

function Detail({ detail }) {
  if (detail == null) return <span className="text-muted-foreground">—</span>;
  const text = typeof detail === 'string' ? detail : JSON.stringify(detail, null, 2);
  return (
    <details>
      <summary className="cursor-pointer text-xs text-primary">Show</summary>
      <pre className="mt-1 max-w-[22rem] whitespace-pre-wrap break-all text-xs bg-muted rounded-md p-2">{text}</pre>
    </details>
  );
}

/** Append-only Core audit log, newest first, with exact-match filters on action and target. */
export default function AuditTab() {
  const [action, setAction] = useState('');
  const [target, setTarget] = useState('');
  const [page, setPage] = useState(0);
  const a = useDebounced(action.trim());
  const t = useDebounced(target.trim());
  // One extra row tells us whether a next page exists (the API returns no total).
  const events = useQuery({
    queryKey: ['core', 'audit', a, t, page],
    queryFn: () => api.core.auditEvents({ action: a, target_id: t, limit: PAGE + 1, offset: page * PAGE }),
    placeholderData: keepPreviousData,
  });
  const rows = (events.data || []).slice(0, PAGE);
  const hasNext = (events.data || []).length > PAGE;
  const setFilter = (fn) => (e) => { fn(e.target.value); setPage(0); };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1.5 w-64">
          <Label htmlFor="audit-action">Action</Label>
          <Input id="audit-action" list="audit-actions" value={action} onChange={setFilter(setAction)} placeholder="e.g. role.granted" autoComplete="off" />
          <datalist id="audit-actions">{AUDIT_ACTIONS.map((x) => <option key={x} value={x} />)}</datalist>
        </div>
        <div className="space-y-1.5 w-80">
          <Label htmlFor="audit-target">Target ID</Label>
          <Input id="audit-target" value={target} onChange={setFilter(setTarget)} placeholder="Exact ID of a role, membership, link…" autoComplete="off" />
        </div>
        {(action || target) && <Button variant="ghost" size="sm" onClick={() => { setAction(''); setTarget(''); setPage(0); }}>Clear filters</Button>}
      </div>
      <p className="text-xs text-muted-foreground">Filters match exactly. Every change to people, organisations, roles and links is recorded here and cannot be edited.</p>
      {events.isLoading && <LoadingState label="Loading audit log…" />}
      {events.error && <CoreQueryError error={events.error} title="Could not load the audit log" />}
      {events.data && (rows.length ? (
        <div className="rounded-2xl border border-border bg-card">
          <Table aria-describedby="audit-page">
            <TableHeader><TableRow><TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Action</TableHead><TableHead>Target</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((e) => (
                <TableRow key={e.id} className="align-top">
                  <TableCell className="whitespace-nowrap text-xs">{formatWhen(e.at)}</TableCell>
                  <TableCell className="text-sm"><Actor event={e} /></TableCell>
                  <TableCell><Badge variant="outline" className="font-mono">{e.action}</Badge></TableCell>
                  <TableCell className="text-xs">
                    {e.target_type || '—'}
                    {e.target_id && (
                      <button type="button" className="block font-mono text-primary hover:underline" title="Filter by this target" onClick={() => { setTarget(e.target_id); setPage(0); }}>
                        {e.target_id.slice(0, 8)}…
                      </button>
                    )}
                  </TableCell>
                  <TableCell><Detail detail={e.detail} /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState icon={ScrollText} title="No audit events" description={action || target ? 'Nothing matches these filters.' : 'Nothing has been recorded yet.'} />)}
      <div className="flex items-center justify-between gap-2">
        <p id="audit-page" className="text-xs text-muted-foreground" aria-live="polite">{rows.length ? `Showing ${page * PAGE + 1}–${page * PAGE + rows.length}` : ''}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page === 0 || events.isFetching} onClick={() => setPage((p) => p - 1)}><ChevronLeft /> Newer</Button>
          <Button size="sm" variant="outline" disabled={!hasNext || events.isFetching} onClick={() => setPage((p) => p + 1)}>Older <ChevronRight /></Button>
        </div>
      </div>
    </div>
  );
}
