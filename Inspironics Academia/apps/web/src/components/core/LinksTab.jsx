import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Link2, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import ActionDialog from '@/components/core/ActionDialog';
import { CoreHint, CoreQueryError } from '@/components/core/CoreNotice';
import { SelectField, TextField } from '@/components/core/Field';
import UserPicker from '@/components/core/UserPicker';
import { APPS, formatWhen, useUserLabel } from '@/lib/core';

const STATUS_OPTIONS = [
  { value: 'proposed', label: 'Waiting for review' },
  { value: 'confirmed', label: 'Confirmed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'all', label: 'All' },
];
const EVIDENCE = { admin_review: 'Proposed by an admin', import_consistent: 'Import (consistent records)', possession: 'Proved by the account holder' };

function Person({ id, fallback = '—' }) {
  const label = useUserLabel(id);
  if (!id) return <span className="text-muted-foreground">{fallback}</span>;
  return <span title={id}>{label || <span className="font-mono text-xs">{id.slice(0, 8)}…</span>}</span>;
}

function ProposeDialog({ open, onOpenChange, onDone }) {
  const [person, setPerson] = useState(null);
  const [app, setApp] = useState('');
  const [appUserId, setAppUserId] = useState('');
  const [note, setNote] = useState('');
  const reset = () => { setPerson(null); setApp(''); setAppUserId(''); setNote(''); };
  const submit = async () => {
    await api.core.proposeLink({ core_user_id: person.id, app, app_user_id: appUserId.trim(), note: note.trim() || null });
    toast.success('Link proposed. Another administrator must confirm it.');
    reset();
    onDone?.();
  };
  return (
    <ActionDialog
      open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Propose an account link" submitLabel="Propose link" onSubmit={submit}
      description="Say which app account belongs to this person. A different administrator reviews and confirms it."
      validate={() => (!person ? 'Choose a person.' : !app ? 'Choose an app.' : !appUserId.trim() ? 'Enter the app account ID.' : '')}
    >
      <UserPicker label="APEX person" value={person} onChange={setPerson} />
      <SelectField label="App" value={app} onChange={setApp} options={Object.entries(APPS).map(([value, label]) => ({ value, label }))} />
      <div className="space-y-1.5">
        <Label htmlFor="link-app-user">App account ID</Label>
        <Input id="link-app-user" value={appUserId} onChange={(e) => setAppUserId(e.target.value)} maxLength={200} aria-describedby="link-app-user-hint" autoComplete="off" />
        <p id="link-app-user-hint" className="text-xs text-muted-foreground">The user ID in that app's own records, not an email address.</p>
      </div>
      <TextField label="Note for the reviewer" value={note} onChange={setNote} placeholder="How you checked this is the same person" />
    </ActionDialog>
  );
}

function ConfirmLinkDialog({ link, onOpenChange, onDone }) {
  const submit = async () => {
    await api.core.confirmLink(link.id);
    toast.success('Link confirmed');
    onDone?.();
  };
  return (
    <ActionDialog
      open={!!link} onOpenChange={onOpenChange} title="Confirm this link?" submitLabel="Confirm link" onSubmit={submit}
      description={link ? `${APPS[link.app] || link.app} account ${link.app_user_id} will be treated as this person's account. It grants no roles.` : ''}
    >
      {link && <p className="text-sm">Person: <Person id={link.core_user_id} /></p>}
      {link?.note && <p className="text-sm text-muted-foreground">Proposer's note: {link.note}</p>}
    </ActionDialog>
  );
}

function RejectLinkDialog({ link, onOpenChange, onDone }) {
  const [note, setNote] = useState('');
  const submit = async () => {
    await api.core.rejectLink(link.id, { note: note.trim() });
    toast.success('Link rejected');
    setNote('');
    onDone?.();
  };
  return (
    <ActionDialog
      open={!!link} onOpenChange={(o) => { if (!o) setNote(''); onOpenChange(o); }} destructive
      title={link?.status === 'confirmed' ? 'Remove this confirmed link?' : 'Reject this link?'}
      submitLabel={link?.status === 'confirmed' ? 'Remove link' : 'Reject link'} onSubmit={submit}
      description={link ? `${APPS[link.app] || link.app} account ${link.app_user_id}. Nothing in the app account itself is changed.` : ''}
      validate={() => (note.trim() ? '' : 'Add a note explaining the decision.')}
    >
      <TextField label="Note" required value={note} onChange={setNote} />
    </ActionDialog>
  );
}

export default function LinksTab() {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const [status, setStatus] = useState('proposed');
  const [proposing, setProposing] = useState(false);
  const [confirming, setConfirming] = useState(null);
  const [rejecting, setRejecting] = useState(null);
  const links = useQuery({
    queryKey: ['core', 'links', status],
    queryFn: () => api.core.links(status === 'all' ? undefined : status),
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['core', 'links'] });
    qc.invalidateQueries({ queryKey: ['core', 'user'] });
    qc.invalidateQueries({ queryKey: ['core', 'audit'] });
  };

  return (
    <div className="space-y-4">
      <CoreHint title="How account links work">
        A link says that an account in the Innovation Showcase or SlidesVault belongs to a person in APEX. Matching email addresses are not proof: check with the person or the records before proposing. A link never grants roles. One administrator proposes; a different administrator confirms.
      </CoreHint>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="w-56">
          <SelectField label="Show" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
        </div>
        <Button size="sm" onClick={() => setProposing(true)}><Plus /> Propose a link</Button>
      </div>
      {links.isLoading && <LoadingState label="Loading links…" />}
      {links.error && <CoreQueryError error={links.error} title="Could not load links" />}
      {links.data && (links.data.length ? (
        <div className="rounded-2xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow><TableHead>Person</TableHead><TableHead>App account</TableHead><TableHead>Status</TableHead><TableHead>Proposed</TableHead><TableHead>Reviewed</TableHead><TableHead className="text-right">Actions</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {links.data.map((l) => {
                const mine = !!l.proposed_by && l.proposed_by === me?.id;
                return (
                  <TableRow key={l.id}>
                    <TableCell><Person id={l.core_user_id} /></TableCell>
                    <TableCell><span className="font-medium">{APPS[l.app] || l.app}</span><span className="block text-xs text-muted-foreground font-mono">{l.app_user_id}</span></TableCell>
                    <TableCell>
                      <Badge variant={l.status === 'confirmed' ? 'default' : l.status === 'rejected' ? 'outline' : 'secondary'}>{l.status}</Badge>
                      <span className="block text-xs text-muted-foreground mt-1">{EVIDENCE[l.evidence] || l.evidence}</span>
                    </TableCell>
                    <TableCell className="text-xs">
                      <span className="whitespace-nowrap">{formatWhen(l.proposed_at)}</span>
                      <span className="block text-muted-foreground">by {l.proposed_by ? (mine ? 'you' : <Person id={l.proposed_by} />) : 'import tool'}</span>
                      {l.note && <span className="block text-muted-foreground max-w-[14rem] truncate" title={l.note}>“{l.note}”</span>}
                    </TableCell>
                    <TableCell className="text-xs">
                      {l.reviewed_at ? <><span className="whitespace-nowrap">{formatWhen(l.reviewed_at)}</span><span className="block text-muted-foreground">by <Person id={l.reviewed_by} /></span></> : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-col items-end gap-1">
                        <div className="flex justify-end gap-1.5">
                          {l.status === 'proposed' && (
                            <Button size="sm" onClick={() => setConfirming(l)} disabled={mine} aria-describedby={mine ? `own-${l.id}` : undefined}><Check /> Confirm</Button>
                          )}
                          {l.status !== 'rejected' && (
                            <Button size="sm" variant="outline" onClick={() => setRejecting(l)}><X /> {l.status === 'confirmed' ? 'Remove' : 'Reject'}</Button>
                          )}
                        </div>
                        {mine && l.status === 'proposed' && <span id={`own-${l.id}`} className="text-xs text-muted-foreground max-w-[14rem]">You proposed this link, so a different administrator must confirm it.</span>}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      ) : <EmptyState icon={Link2} title={status === 'proposed' ? 'Nothing waiting for review' : 'No links'} description="Proposed links appear here until an administrator confirms or rejects them." />)}
      <ProposeDialog open={proposing} onOpenChange={setProposing} onDone={refresh} />
      <ConfirmLinkDialog link={confirming} onOpenChange={(o) => !o && setConfirming(null)} onDone={refresh} />
      <RejectLinkDialog link={rejecting} onOpenChange={(o) => !o && setRejecting(null)} onDone={refresh} />
    </div>
  );
}
