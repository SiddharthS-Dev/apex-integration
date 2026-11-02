import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { AlertTriangle, CalendarClock, Loader2, PlayCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import ComplianceKpis from '@/components/admin/compliance/ComplianceKpis';
import PlaybookPolicyTable from '@/components/admin/compliance/PlaybookPolicyTable';
import RecertificationTable from '@/components/admin/compliance/RecertificationTable';
import { localDay } from '@/lib/progress';

const KEY = ['compliance-report'];

function ExpiringList({ items }) {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <h2 className="font-semibold mb-1 flex items-center gap-2"><CalendarClock className="w-4 h-4 text-amber-500" /> Expiring within 30 days</h2>
      <p className="text-xs text-muted-foreground mb-4">Holders are reminded automatically before expiry.</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing expiring soon.</p>
      ) : (
        <ul className="divide-y divide-border">
          {[...items].sort((a, b) => a.expires_date.localeCompare(b.expires_date)).map((c) => (
            <li key={c.id} className="py-2.5 flex items-center justify-between gap-3 text-sm">
              <div className="min-w-0">
                <div className="font-medium truncate">{c.user_name || '—'}</div>
                <div className="text-xs text-muted-foreground truncate">{c.course_title}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs tabular-nums">{format(new Date(`${c.expires_date}T12:00:00`), 'MMM d, yyyy')}</div>
                <div className="text-[11px] text-muted-foreground tabular-nums">{c.days_left === 0 ? 'today' : `in ${c.days_left}d`}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminCompliance() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await api.functions.invoke('getComplianceReport', { today: localDay() })).data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: KEY });

  const runChecks = async () => {
    setRunning(true);
    try {
      const { data: s } = await api.functions.invoke('runComplianceChecks', { today: localDay() });
      toast.success('Compliance checks finished', {
        description: `${s.expired} expired · ${s.expiring} expiring soon · ${s.due_soon} due soon · ${s.overdue} overdue`,
      });
      refresh();
    } catch (e) {
      toast.error(e?.message || 'Could not run the checks');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <PageHeader
        icon={ShieldCheck}
        title="Certification Compliance"
        description="Who is current, who must recertify after a playbook change, and what is about to expire."
        actions={(
          <Button size="sm" variant="outline" onClick={runChecks} disabled={running}>
            {running ? <Loader2 className="animate-spin" /> : <PlayCircle />} Run checks now
          </Button>
        )}
      />
      {isLoading && <LoadingState label="Building the compliance report…" />}
      {error && <EmptyState icon={AlertTriangle} title="Could not load the compliance report" description={error.message} />}
      {data && (
        <>
          <ComplianceKpis kpis={data.kpis} />
          <PlaybookPolicyTable playbooks={data.playbooks} onSaved={refresh} />
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] items-start">
            <RecertificationTable rows={data.recertifications} today={data.today} onChanged={refresh} />
            <ExpiringList items={data.expiring} />
          </div>
        </>
      )}
    </div>
  );
}
