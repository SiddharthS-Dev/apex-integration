import { useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Download, Loader2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

export const STATE_LABEL = {
  awaiting_course: 'Awaiting course',
  pending: 'Pending',
  overdue: 'Overdue',
  completed: 'Completed',
  waived: 'Waived',
};
const STATE_STYLE = {
  awaiting_course: 'bg-muted text-muted-foreground',
  pending: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  overdue: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  waived: 'bg-muted text-muted-foreground',
};
const FILTERS = [['open', 'Open'], ['overdue', 'Overdue'], ['pending', 'Pending'], ['awaiting_course', 'Awaiting course'], ['completed', 'Completed'], ['waived', 'Waived'], ['all', 'All']];
const OPEN = ['awaiting_course', 'pending', 'overdue'];

const fmt = (iso) => (iso ? format(new Date(`${iso}T12:00:00`), 'MMM d, yyyy') : '—');

function dueText(r) {
  if (!r.due_date) return '—';
  if (!OPEN.includes(r.state)) return fmt(r.due_date);
  if (r.days_left < 0) return `${fmt(r.due_date)} (${-r.days_left}d late)`;
  return `${fmt(r.due_date)} (${r.days_left}d)`;
}

const CSV_COLUMNS = [
  ['Learner', (r) => r.user_name], ['Playbook', (r) => r.playbook_title], ['Reason', (r) => r.reason],
  ['State', (r) => STATE_LABEL[r.state] || r.state], ['From version', (r) => r.from_version], ['To version', (r) => r.to_version],
  ['Changed chapters', (r) => (r.changed_chapters || []).join('; ')], ['Due date', (r) => r.due_date],
  ['Completed', (r) => r.completed_date], ['Old certificate', (r) => r.certificate_id], ['New certificate', (r) => r.new_certificate_id],
  ['Waiver note', (r) => r.waived_reason],
];

function downloadCsv(rows, today) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [CSV_COLUMNS.map(([h]) => h), ...rows.map((r) => CSV_COLUMNS.map(([, get]) => get(r)))].map((line) => line.map(cell).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `recertifications-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function WaiveDialog({ recert, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.functions.invoke('waiveRecertification', { id: recert.id, reason: reason.trim() });
      toast.success(`Recertification waived for ${recert.user_name || 'the learner'}`);
      onDone();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not waive the recertification');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Waive recertification</DialogTitle>
          <DialogDescription>
            {recert.user_name} · {recert.playbook_title}. Their certificate counts as current again{recert.reason === 'expired' ? ' with a fresh validity period' : ''}.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="waive-reason">Reason</Label>
            <Textarea id="waive-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} required placeholder="e.g. Changes don't affect this learner's role" />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || !reason.trim()}>{saving && <Loader2 className="animate-spin" />} Waive</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function RecertificationTable({ rows, today, onChanged }) {
  const [state, setState] = useState('open');
  const [search, setSearch] = useState('');
  const [waiving, setWaiving] = useState(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => (state === 'all' ? true : state === 'open' ? OPEN.includes(r.state) : r.state === state))
      .filter((r) => !q || `${r.user_name} ${r.playbook_title}`.toLowerCase().includes(q))
      // Most urgent first: overdue, then by due date; undated last.
      .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  }, [rows, state, search]);

  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <div className="flex flex-col lg:flex-row lg:items-center gap-3 mb-4">
        <h2 className="font-semibold lg:mr-auto">Recertifications</h2>
        <div className="relative lg:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search learner or playbook…" className="pl-9" aria-label="Search recertifications" />
        </div>
        <Select value={state} onValueChange={setState}>
          <SelectTrigger className="lg:w-44" aria-label="Filter by state"><SelectValue /></SelectTrigger>
          <SelectContent>{FILTERS.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}</SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => downloadCsv(visible, today)} disabled={!visible.length}><Download /> Export CSV</Button>
      </div>
      {visible.length === 0 ? (
        <p className="text-sm text-muted-foreground py-6 text-center">No recertifications match.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Learner</TableHead>
                <TableHead>Playbook</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Due</TableHead>
                <TableHead>Changed</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium whitespace-nowrap">{r.user_name || '—'}</TableCell>
                  <TableCell className="max-w-[14rem] truncate" title={r.playbook_title}>{r.playbook_title}</TableCell>
                  <TableCell className="text-xs whitespace-nowrap">
                    {r.reason === 'expired' ? 'Expired' : `Changed ${r.from_version || ''}${r.to_version ? ` → ${r.to_version}` : ''}`}
                  </TableCell>
                  <TableCell>
                    <span className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', STATE_STYLE[r.state])}>{STATE_LABEL[r.state] || r.state}</span>
                  </TableCell>
                  <TableCell className={cn('text-xs whitespace-nowrap tabular-nums', r.state === 'overdue' && 'text-rose-600 dark:text-rose-300 font-medium')}>{dueText(r)}</TableCell>
                  <TableCell className="text-xs max-w-[16rem] truncate" title={(r.changed_chapters || []).join(', ')}>
                    {(r.changed_chapters || []).join(', ') || '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    {OPEN.includes(r.state) && <Button size="sm" variant="ghost" onClick={() => setWaiving(r)}>Waive</Button>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {waiving && <WaiveDialog recert={waiving} onClose={() => setWaiving(null)} onDone={onChanged} />}
    </section>
  );
}
