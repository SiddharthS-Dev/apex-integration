import { useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Award } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/lib/AuthContext';
import { Button } from '@/components/ui/button';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import CertificateDocument from '@/components/certificates/CertificateDocument';
import CertificateActions from '@/components/certificates/CertificateActions';
import { verifyUrlFor } from '@/components/certificates/verifyLink';

const PRINT_CSS = '@page { size: A4 landscape; margin: 0; } @media print { body { background: #fff !important; } .certificate-sheet { box-shadow: none !important; } }';

export default function CertificateView() {
  const { courseId } = useParams();
  const { user } = useAuth();
  const sheetRef = useRef(null);
  const { data: certificate, isLoading } = useQuery({
    queryKey: ['certificate', user?.id, courseId],
    enabled: !!user?.id,
    queryFn: async () => (await api.entities.Certificate.filter({ user_id: user.id, course_id: courseId }, '-created_date', 1))[0] || null,
  });

  if (isLoading) return <LoadingState label="Loading certificate…" />;
  if (!certificate) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <EmptyState
          icon={Award}
          title="No certificate for this course yet"
          description="Pass the final test to earn your verifiable certificate."
          action={<Button asChild size="sm"><Link to={`/test/final/${courseId}`}>Take the final test</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <style>{PRINT_CSS}</style>
      <div className="no-print flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <Button asChild size="sm" variant="ghost" className="self-start">
          <Link to="/certificates"><ArrowLeft /> All certificates</Link>
        </Button>
        <CertificateActions targetRef={sheetRef} certificate={certificate} />
      </div>
      <div className="max-w-5xl mx-auto">
        <CertificateDocument
          ref={sheetRef}
          certificate={certificate}
          learnerName={certificate.user_name || user?.full_name || user?.email}
          verifyUrl={verifyUrlFor(certificate.certificate_id)}
        />
      </div>
    </div>
  );
}
