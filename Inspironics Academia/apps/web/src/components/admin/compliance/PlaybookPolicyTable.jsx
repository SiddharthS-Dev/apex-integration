import { useState } from 'react';
import { Loader2, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';

const rateClass = (r) => (r == null ? 'text-muted-foreground' : r >= 90 ? 'text-emerald-600 dark:text-emerald-300' : r >= 70 ? 'text-amber-600 dark:text-amber-300' : 'text-rose-600 dark:text-rose-300');

function policyText(p) {
  const parts = [p.recert_on_change ? 'Recertify on change' : 'No recert on change'];
  parts.push(p.cert_validity_months ? `valid ${p.cert_validity_months} mo` : 'no expiry');
  parts.push(`${p.recert_grace_days}d grace`);
  return parts.join(' · ');
}

function PolicyDialog({ playbook, onClose, onSaved }) {
  const [form, setForm] = useState({
    recert_on_change: playbook.recert_on_change,
    cert_validity_months: String(playbook.cert_validity_months),
    recert_grace_days: String(playbook.recert_grace_days),
  });
  const [saving, setSaving] = useState(false);
  const months = Number(form.cert_validity_months);
  const grace = Number(form.recert_grace_days);
  const invalid = !Number.isInteger(months) || months < 0 || months > 120 || !Number.isInteger(grace) || grace < 1 || grace > 365;

  const save = async (e) => {
    e.preventDefault();
    if (invalid) return;
    setSaving(true);
    try {
      await api.entities.Playbook.update(playbook.id, { recert_on_change: form.recert_on_change, cert_validity_months: months, recert_grace_days: grace });
      toast.success('Certification policy saved');
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err?.message || 'Could not save the policy');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Certification policy</DialogTitle>
          <DialogDescription>{playbook.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="pol-change">Recertify when the playbook changes</Label>
              <p className="text-xs text-muted-foreground">A new version that adds, removes or rewrites chapters opens recertification for certified learners.</p>
            </div>
            <Switch id="pol-change" checked={form.recert_on_change} onCheckedChange={(v) => setForm((f) => ({ ...f, recert_on_change: v }))} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pol-months">Validity (months)</Label>
              <Input id="pol-months" type="number" min={0} max={120} value={form.cert_validity_months} onChange={(e) => setForm((f) => ({ ...f, cert_validity_months: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">0 = never expires. Applies to new certificates.</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pol-grace">Grace period (days)</Label>
              <Input id="pol-grace" type="number" min={1} max={365} value={form.recert_grace_days} onChange={(e) => setForm((f) => ({ ...f, recert_grace_days: e.target.value }))} />
              <p className="text-[11px] text-muted-foreground">Time to recertify once due.</p>
            </div>
          </div>
          {invalid && <p className="text-xs text-destructive">Validity must be 0–120 months and the grace period 1–365 days.</p>}
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose}>Cancel</Button>
            <Button type="submit" size="sm" disabled={saving || invalid}>{saving && <Loader2 className="animate-spin" />} Save policy</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PlaybookPolicyTable({ playbooks, onSaved }) {
  const [editing, setEditing] = useState(null);
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-1">By playbook</h2>
      <p className="text-xs text-muted-foreground mb-4">Compliance is the share of certified learners whose newest certificate is still valid.</p>
      {playbooks.length === 0 ? (
        <p className="text-sm text-muted-foreground">No playbooks yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Playbook</TableHead>
                <TableHead>Policy</TableHead>
                <TableHead className="text-right">Certified</TableHead>
                <TableHead className="text-right">Valid</TableHead>
                <TableHead className="text-right">Open</TableHead>
                <TableHead className="text-right">Overdue</TableHead>
                <TableHead className="text-right">Compliance</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {playbooks.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="font-medium max-w-[16rem]">
                    <div className="truncate" title={p.title}>{p.title}</div>
                    {p.version && <div className="text-[11px] text-muted-foreground">Version {p.version}</div>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{policyText(p)}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.certified}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.valid}</TableCell>
                  <TableCell className="text-right tabular-nums">{p.open_recerts}</TableCell>
                  <TableCell className={cn('text-right tabular-nums', p.overdue > 0 && 'text-rose-600 dark:text-rose-300 font-medium')}>{p.overdue}</TableCell>
                  <TableCell className={cn('text-right tabular-nums font-medium', rateClass(p.compliance_rate))}>
                    {p.compliance_rate == null ? '—' : `${p.compliance_rate}%`}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(p)}><Settings2 /> Policy</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {editing && <PolicyDialog playbook={editing} onClose={() => setEditing(null)} onSaved={onSaved} />}
    </section>
  );
}
