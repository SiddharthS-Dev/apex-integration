import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, Plus, UserMinus, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { cn } from '@/lib/utils';
import EmptyState from '@/components/EmptyState';
import LoadingState from '@/components/LoadingState';
import ActionDialog from '@/components/core/ActionDialog';
import { CoreHint, CoreQueryError } from '@/components/core/CoreNotice';
import { TextField } from '@/components/core/Field';
import UserPicker from '@/components/core/UserPicker';
import { formatWhen, useOrganizations } from '@/lib/core';

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);

function CreateOrganisationDialog({ open, onOpenChange, onDone }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const reset = () => { setName(''); setSlug(''); setSlugTouched(false); };
  const shownSlug = slugTouched ? slug : slugify(name);
  const submit = async () => {
    const org = await api.core.createOrganization({ name: name.trim(), slug: shownSlug, kind: 'internal' });
    toast.success(`${org.name} created`);
    reset();
    onDone?.(org);
  };
  return (
    <ActionDialog
      open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="New organisation" submitLabel="Create organisation" onSubmit={submit}
      description="Internal organisations only."
      validate={() => (!name.trim() ? 'Enter a name.' : !/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(shownSlug) ? 'The short name may use lower-case letters, digits and dashes.' : '')}
    >
      <div className="space-y-1.5">
        <Label htmlFor="org-name">Name</Label>
        <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={200} required />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="org-slug">Short name (slug)</Label>
        <Input id="org-slug" value={shownSlug} onChange={(e) => { setSlugTouched(true); setSlug(e.target.value.toLowerCase()); }} maxLength={64} aria-describedby="org-slug-hint" />
        <p id="org-slug-hint" className="text-xs text-muted-foreground">Unique. Lower-case letters, digits and dashes.</p>
      </div>
      <div className="space-y-1">
        <p className="text-sm font-medium">Kind</p>
        <p className="text-sm">Internal</p>
        <p className="text-xs text-muted-foreground">Partner and institution organisations are not available yet: external organisations are held pending policy.</p>
      </div>
    </ActionDialog>
  );
}

function AddMemberDialog({ open, onOpenChange, org, memberIds, onDone }) {
  const [person, setPerson] = useState(null);
  const [title, setTitle] = useState('');
  const reset = () => { setPerson(null); setTitle(''); };
  const submit = async () => {
    await api.core.addMember(org.id, { user_id: person.id, title: title.trim() || null });
    toast.success(`${person.full_name || person.email} added to ${org.name}`);
    reset();
    onDone?.();
  };
  return (
    <ActionDialog
      open={open} onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title={`Add a member to ${org?.name || ''}`} submitLabel="Add member" onSubmit={submit}
      description="Membership alone grants no roles or admin rights. Grant roles separately in the People tab."
      validate={() => (person ? '' : 'Choose a person.')}
    >
      <UserPicker value={person} onChange={setPerson} excludeIds={memberIds} />
      <div className="space-y-1.5">
        <Label htmlFor="member-title">Title <span className="text-muted-foreground font-normal">(optional)</span></Label>
        <Input id="member-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Engineer, Intern" />
      </div>
    </ActionDialog>
  );
}

function EndMembershipDialog({ membership, orgName, onOpenChange, onDone }) {
  const [reason, setReason] = useState('');
  const submit = async () => {
    const out = await api.core.endMembership(membership.id, { reason: reason.trim() || null });
    const n = out?.closed_assignments?.length || 0;
    toast.success(`Membership ended${n ? `; ${n} organisation role${n === 1 ? '' : 's'} ended too` : ''}`);
    setReason('');
    onDone?.();
  };
  return (
    <ActionDialog
      open={!!membership} onOpenChange={(o) => { if (!o) setReason(''); onOpenChange(o); }}
      destructive submitLabel="End membership" title="End this membership?" onSubmit={submit}
      description={membership ? `${membership.full_name || membership.email} will no longer be a member of ${orgName}.` : ''}
    >
      <p className="text-sm rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
        This also ends every role this person holds in {orgName} (for example Staff or Organisation admin). Platform-wide and app roles are not affected. Ended records stay in the history.
      </p>
      <TextField label="Reason" value={reason} onChange={setReason} />
    </ActionDialog>
  );
}

function Members({ org }) {
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ['core', 'members', org.id], queryFn: () => api.core.members(org.id), retry: false });
  const [adding, setAdding] = useState(false);
  const [ending, setEnding] = useState(null);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['core', 'members', org.id] });
    qc.invalidateQueries({ queryKey: ['core', 'user'] });
    qc.invalidateQueries({ queryKey: ['core', 'audit'] });
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3" aria-labelledby="org-members-title">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="org-members-title" className="font-semibold">{org.name} · members</h3>
          <p className="text-xs text-muted-foreground">{org.slug} · {org.kind} · {org.status}</p>
        </div>
        <Button size="sm" onClick={() => setAdding(true)} disabled={org.status !== 'active'}><UserPlus /> Add member</Button>
      </div>
      {members.isLoading && <LoadingState label="Loading members…" />}
      {members.error && <CoreQueryError error={members.error} title="Could not load members" />}
      {members.data && (members.data.length ? (
        <Table>
          <TableHeader><TableRow><TableHead>Person</TableHead><TableHead>Title</TableHead><TableHead>Since</TableHead><TableHead className="text-right"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
          <TableBody>
            {members.data.map((m) => (
              <TableRow key={m.id}>
                <TableCell><span className="font-medium">{m.full_name || m.email}</span>{m.full_name && <span className="block text-xs text-muted-foreground">{m.email}</span>}</TableCell>
                <TableCell>{m.title || '—'}</TableCell>
                <TableCell className="whitespace-nowrap">{formatWhen(m.valid_from)}</TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setEnding(m)} aria-label={`End membership of ${m.full_name || m.email}`}><UserMinus /> End</Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : <p className="text-sm text-muted-foreground">No members yet.</p>)}
      <AddMemberDialog open={adding} onOpenChange={setAdding} org={org} memberIds={(members.data || []).map((m) => m.user_id)} onDone={refresh} />
      <EndMembershipDialog membership={ending} orgName={org.name} onOpenChange={(o) => !o && setEnding(null)} onDone={refresh} />
    </section>
  );
}

export default function OrganisationsTab() {
  const qc = useQueryClient();
  const orgs = useOrganizations();
  const [selected, setSelected] = useState(null);
  const [creating, setCreating] = useState(false);
  const current = (orgs.data || []).find((o) => o.id === selected) || null;

  return (
    <div className="space-y-4">
      <CoreHint>
        Organisations group people. Being a member gives no permissions by itself; roles do. Only internal organisations can be created for now; partner and institution organisations are not available yet.
      </CoreHint>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)] items-start">
        <section className="rounded-2xl border border-border bg-card p-4 space-y-3" aria-labelledby="orgs-title">
          <div className="flex items-center justify-between gap-2">
            <h3 id="orgs-title" className="font-semibold">Organisations</h3>
            <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus /> New</Button>
          </div>
          {orgs.isLoading && <LoadingState label="Loading…" />}
          {orgs.error && <CoreQueryError error={orgs.error} title="Could not load organisations" />}
          {orgs.data && (orgs.data.length ? (
            <ul className="space-y-1" aria-label="Organisations">
              {orgs.data.map((o) => (
                <li key={o.id}>
                  <button
                    type="button" onClick={() => setSelected(o.id)} aria-current={selected === o.id ? 'true' : undefined}
                    className={cn('w-full text-left px-2 py-2 rounded-lg text-sm hover:bg-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring', selected === o.id && 'bg-primary/10')}
                  >
                    <span className="font-medium">{o.name}</span>
                    <span className="ml-2 inline-flex gap-1 align-middle">
                      <Badge variant="outline">{o.kind}</Badge>
                      {o.status !== 'active' && <Badge variant="destructive">{o.status}</Badge>}
                    </span>
                    <span className="block text-xs text-muted-foreground">{o.slug}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">No organisations yet.</p>)}
        </section>
        <div className="min-w-0">
          {current ? <Members org={current} /> : <EmptyState icon={Building2} title="Choose an organisation" description="Pick one on the left to see and manage its members." />}
        </div>
      </div>
      <CreateOrganisationDialog
        open={creating} onOpenChange={setCreating}
        onDone={(org) => { qc.invalidateQueries({ queryKey: ['core', 'organizations'] }); qc.invalidateQueries({ queryKey: ['core', 'audit'] }); setSelected(org.id); }}
      />
    </div>
  );
}
