import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, Plus, ShieldOff } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import LoadingState from '@/components/LoadingState';
import { CoreQueryError } from '@/components/core/CoreNotice';
import { GrantRoleDialog, RevokeRoleDialog, TransitionRoleDialog } from '@/components/core/RoleDialogs';
import { APPS, formatWhen, roleLabel, scopeText, useOrganizations } from '@/lib/core';

function Section({ title, description, action, children }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">{title}</h3>
          {description && <p className="text-xs text-muted-foreground mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

const None = ({ children }) => <p className="text-sm text-muted-foreground">{children}</p>;

/** One person's access: active roles (with actions), role history, memberships, links, sign-in providers. */
export default function UserDetail({ userId }) {
  const { user: me } = useAuth();
  const qc = useQueryClient();
  const { names: orgNames } = useOrganizations();
  const detail = useQuery({ queryKey: ['core', 'user', userId], queryFn: () => api.core.user(userId), retry: false });
  const [grantOpen, setGrantOpen] = useState(false);
  const [revoke, setRevoke] = useState(null);
  const [transition, setTransition] = useState(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['core', 'user', userId] });
    qc.invalidateQueries({ queryKey: ['core', 'audit'] });
  };

  if (detail.isLoading) return <LoadingState label="Loading person…" />;
  if (detail.error) return <CoreQueryError error={detail.error} title="Could not load this person" />;
  const d = detail.data;
  const isSelf = d.user.id === me?.id;
  const history = d.role_history || [];
  const byId = Object.fromEntries(history.map((r) => [r.id, r]));
  const activeIds = new Set((d.roles || []).map((r) => r.id));
  const past = history.filter((r) => !activeIds.has(r.id)).sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
  const ownAdmin = (r) => isSelf && r.role === 'platform_admin';

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-xl font-bold">{d.user.full_name || d.user.email}</h2>
          {isSelf && <Badge variant="secondary">You</Badge>}
          {d.user.disabled ? <Badge variant="destructive">Disabled — roles not in effect</Badge> : null}
        </div>
        <p className="text-sm text-muted-foreground">{d.user.email}</p>
      </div>

      <Section
        title="Active roles"
        description="What this person can do now. Membership and Staff alone give no admin rights."
        action={<Button size="sm" onClick={() => setGrantOpen(true)}><Plus /> Grant role</Button>}
      >
        {d.roles?.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Scope</TableHead><TableHead>Since</TableHead><TableHead>Granted via</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
            <TableBody>
              {d.roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{roleLabel(r.role)}</TableCell>
                  <TableCell>{scopeText(r.scope_type, r.scope_id, orgNames)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatWhen(r.valid_from)}</TableCell>
                  <TableCell>{byId[r.id]?.granted_via || '—'}</TableCell>
                  <TableCell className="text-right">
                    {ownAdmin(r) ? (
                      <span className="text-xs text-muted-foreground">Your own admin role can only be changed by another administrator.</span>
                    ) : (
                      <div className="flex justify-end gap-1.5">
                        <Button size="sm" variant="outline" onClick={() => setTransition(r)} aria-label={`Change ${roleLabel(r.role)} role`}><ArrowRightLeft /> Change</Button>
                        <Button size="sm" variant="outline" onClick={() => setRevoke(r)} aria-label={`Revoke ${roleLabel(r.role)} role`}><ShieldOff /> Revoke</Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <None>No active roles.</None>}
      </Section>

      <Section title="Role history" description="Ended assignments are kept, never deleted.">
        {past.length ? (
          <Table>
            <TableHeader><TableRow><TableHead>Role</TableHead><TableHead>Scope</TableHead><TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Via</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader>
            <TableBody>
              {past.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{roleLabel(r.role)}</TableCell>
                  <TableCell>{scopeText(r.scope_type, r.scope_id, orgNames)}</TableCell>
                  <TableCell className="whitespace-nowrap">{formatWhen(r.valid_from)}</TableCell>
                  <TableCell className="whitespace-nowrap">{r.valid_to ? formatWhen(r.valid_to) : <span className="text-muted-foreground">Open, not in effect</span>}</TableCell>
                  <TableCell>{r.granted_via}</TableCell>
                  <TableCell className="max-w-[16rem] truncate" title={r.reason || ''}>{r.reason || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        ) : <None>No ended roles.</None>}
      </Section>

      <div className="grid gap-5 xl:grid-cols-2">
        <Section title="Organisation memberships" description="Manage memberships in the Organisations tab.">
          {d.memberships?.length ? (
            <ul className="space-y-2 text-sm">
              {d.memberships.map((m) => (
                <li key={m.id} className="flex flex-wrap justify-between gap-2">
                  <span className="font-medium">{m.organization_name || orgNames[m.organization_id] || m.organization_id}{m.title ? <span className="font-normal text-muted-foreground"> · {m.title}</span> : null}</span>
                  <span className="text-xs text-muted-foreground">since {formatWhen(m.valid_from)}</span>
                </li>
              ))}
            </ul>
          ) : <None>Not a member of any organisation.</None>}
        </Section>

        <Section title="Linked app accounts" description="Reviewed links to Showcase or SlidesVault accounts. Links grant no roles.">
          {d.links?.length ? (
            <ul className="space-y-2 text-sm">
              {d.links.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center justify-between gap-2">
                  <span><span className="font-medium">{APPS[l.app] || l.app}</span> <span className="text-muted-foreground">account {l.app_user_id}</span></span>
                  <Badge variant={l.status === 'confirmed' ? 'default' : l.status === 'rejected' ? 'outline' : 'secondary'}>{l.status}</Badge>
                </li>
              ))}
            </ul>
          ) : <None>No links.</None>}
        </Section>
      </div>

      <Section title="Sign-in providers" description="External sign-in linked to this account (provider only).">
        {d.external_identities?.length ? (
          <ul className="text-sm space-y-1">
            {d.external_identities.map((e, i) => <li key={`${e.provider}-${i}`}><span className="font-medium capitalize">{e.provider}</span> <span className="text-muted-foreground">· verified {formatWhen(e.verified_at)}</span></li>)}
          </ul>
        ) : <None>None. Password sign-in only.</None>}
      </Section>

      <GrantRoleDialog open={grantOpen} onOpenChange={setGrantOpen} detail={d} isSelf={isSelf} onDone={refresh} />
      <RevokeRoleDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} assignment={revoke} orgNames={orgNames} onDone={refresh} />
      <TransitionRoleDialog open={!!transition} onOpenChange={(o) => !o && setTransition(null)} assignment={transition} orgNames={orgNames} isSelf={isSelf} onDone={refresh} />
    </div>
  );
}
