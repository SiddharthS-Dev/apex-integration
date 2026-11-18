import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowRight, Compass, Info } from 'lucide-react';
import { api } from '@/api/client';
import { Button } from '@/components/ui/button';
import { coreAvailable } from '@/lib/core';

// Orientation for people whose access request was approved (Use Case 007, slice O4). The server builds
// it from the approved category and what exists today: steps that are not open yet say so, and modules
// that do not exist are named as such, never presented as opportunities. Finishing it records nothing
// but the time, and changes no access.
export default function OrientationCard() {
  const qc = useQueryClient();
  const enabled = coreAvailable && !!api.onboarding;
  const q = useQuery({ queryKey: ['onboarding', 'orientation'], queryFn: () => api.onboarding.orientation(), enabled, retry: false, staleTime: 60_000 });
  const o = q.data?.orientation;
  if (!enabled || !o || o.completed_at) return null;
  const finish = async () => {
    await api.onboarding.completeOrientation().catch(() => {});
    qc.invalidateQueries({ queryKey: ['onboarding', 'orientation'] });
  };
  return (
    <section aria-labelledby="orientation-title" className="rounded-2xl border border-border bg-card p-6 space-y-4">
      <div className="flex items-start gap-3">
        <Compass className="w-6 h-6 text-primary shrink-0" aria-hidden="true" />
        <div>
          <h2 id="orientation-title" className="text-lg font-semibold">Welcome to APEX — getting started as {o.category_label}</h2>
          <p className="text-sm text-muted-foreground">{o.notice}</p>
        </div>
      </div>
      <ol className="space-y-2">
        {o.steps.map((s, i) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border p-3">
            <div>
              <p className="font-medium">{i + 1}. {s.title}</p>
              <p className="text-sm text-muted-foreground">{s.description}</p>
            </div>
            {s.available && (
              <Button asChild size="sm" variant="outline"><Link to={s.path}>Open <ArrowRight className="w-4 h-4" aria-hidden="true" /></Link></Button>
            )}
          </li>
        ))}
      </ol>
      {!!o.not_available_yet.length && (
        <div className="rounded-xl bg-muted/50 p-3 text-sm">
          <p className="font-medium flex items-center gap-1.5"><Info className="w-4 h-4" aria-hidden="true" /> Not on the platform yet</p>
          <ul className="list-disc pl-5 text-muted-foreground mt-1 space-y-0.5">
            {o.not_available_yet.map((n) => <li key={n.code}>{n.text}</li>)}
          </ul>
        </div>
      )}
      <Button size="sm" variant="ghost" onClick={finish}>I'm done with the orientation</Button>
    </section>
  );
}
