import { useQuery } from '@tanstack/react-query';
import { Loader2, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { Badge } from '@/components/ui/badge';
import { CoreUnavailable } from '@/components/core/CoreNotice';
import { APPS, coreAvailable, coreErrorText, formatWhen, roleLabel, scopeText } from '@/lib/core';

/** "My access": the signed-in user's own roles, memberships and confirmed account links (read-only). */
export default function MyAccessCard() {
  const me = useQuery({ queryKey: ['core', 'me'], queryFn: () => api.core.me(), enabled: coreAvailable, retry: false });
  const orgNames = Object.fromEntries((me.data?.memberships || []).map((m) => [m.organization_id, m.organization_name]));

  let body;
  if (!coreAvailable) body = <CoreUnavailable compact />;
  else if (me.isLoading) body = <p className="text-sm text-muted-foreground flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</p>;
  else if (me.error) body = <p className="text-sm text-muted-foreground">{me.error.status === 404 ? 'Not available on this server yet.' : coreErrorText(me.error)}</p>;
  else {
    const { roles = [], memberships = [], links = [] } = me.data;
    body = (
      <div className="grid gap-4 sm:grid-cols-3 text-sm">
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Roles</h4>
          {roles.length ? (
            <ul className="space-y-1.5">
              {roles.map((r) => (
                <li key={r.id}><span className="font-medium">{roleLabel(r.role)}</span><span className="block text-xs text-muted-foreground">{scopeText(r.scope_type, r.scope_id, orgNames)} · since {formatWhen(r.valid_from)}</span></li>
              ))}
            </ul>
          ) : <p className="text-muted-foreground">No roles.</p>}
        </div>
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Organisations</h4>
          {memberships.length ? (
            <ul className="space-y-1.5">
              {memberships.map((m) => <li key={m.id}><span className="font-medium">{m.organization_name}</span>{m.title && <span className="block text-xs text-muted-foreground">{m.title}</span>}</li>)}
            </ul>
          ) : <p className="text-muted-foreground">None.</p>}
        </div>
        <div>
          <h4 className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-2">Linked app accounts</h4>
          {links.length ? (
            <ul className="space-y-1.5">
              {links.map((l) => <li key={l.id} className="flex items-center gap-2"><span className="font-medium">{APPS[l.app] || l.app}</span><Badge variant="secondary">confirmed</Badge></li>)}
            </ul>
          ) : <p className="text-muted-foreground">None.</p>}
        </div>
      </div>
    );
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-5 space-y-4" aria-labelledby="my-access-title">
      <div>
        <h3 id="my-access-title" className="font-semibold flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /> My access</h3>
        <p className="text-xs text-muted-foreground mt-0.5">What your APEX account can do, set by administrators. Ask an administrator if something looks wrong.</p>
      </div>
      {body}
    </section>
  );
}
