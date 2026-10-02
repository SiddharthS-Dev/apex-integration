import { Link } from 'react-router-dom';
import { Award } from 'lucide-react';
import { Button } from '@/components/ui/button';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CertificateCard from '@/components/certificates/CertificateCard';
import { useMyCertificates } from '@/components/dashboard/useLearnerData';

export default function Certificates() {
  const { data: certificates = [], isLoading } = useMyCertificates();

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader icon={Award} title="Certificates" description="Verifiable proof of the courses you've mastered." />
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
          {certificates.map((c) => <CertificateCard key={c.id} certificate={c} />)}
        </div>
      )}
    </div>
  );
}
