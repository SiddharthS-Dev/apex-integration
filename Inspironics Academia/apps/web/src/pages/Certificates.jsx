import { Link } from 'react-router-dom';
import { Award, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CertificateCard from '@/components/certificates/CertificateCard';
import RecertificationCard from '@/components/certificates/RecertificationCard';
import { standingOf } from '@/components/certificates/CertificateStanding';
import { useMyCertificates } from '@/components/dashboard/useLearnerData';
import { useMyRecertifications } from '@/lib/retention';

const OPEN = ['awaiting_course', 'pending', 'overdue'];
// Current certificates first, then those needing action, superseded ones last.
const RANK = { valid: 0, recert_required: 1, expired: 1, superseded: 2 };

export default function Certificates() {
  const { data: certificates = [], isLoading } = useMyCertificates();
  const { data: recerts = [] } = useMyRecertifications();
  const open = recerts.filter((r) => OPEN.includes(r.state));
  const sorted = [...certificates].sort((a, b) => (RANK[standingOf(a)] ?? 0) - (RANK[standingOf(b)] ?? 0));

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-8">
      <PageHeader icon={Award} title="Certificates" description="Verifiable proof of the courses you've mastered." />
      {open.length > 0 && (
        <section aria-labelledby="recert-heading" className="space-y-4">
          <div>
            <h2 id="recert-heading" className="text-lg font-semibold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-amber-500" /> Recertification</h2>
            <p className="text-sm text-muted-foreground">Playbooks change. Revisit what changed and pass the updated final test to keep your certification current.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {open.map((r) => <RecertificationCard key={r.id} recert={r} />)}
          </div>
        </section>
      )}
      {isLoading ? (
        <LoadingState label="Loading certificates…" />
      ) : certificates.length === 0 ? (
        <EmptyState
          icon={Award}
          title="No certificates yet"
          description="Pass a course's final test to earn a verifiable certificate."
          action={<Button asChild size="sm"><Link to="/tests">Go to tests</Link></Button>}
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sorted.map((c) => <CertificateCard key={c.id} certificate={c} />)}
        </div>
      )}
    </div>
  );
}
