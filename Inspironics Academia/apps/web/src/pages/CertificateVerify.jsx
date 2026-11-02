import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ShieldAlert, ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/api/client';
import AuthLayout from '@/components/auth/AuthLayout';
import LoadingState from '@/components/LoadingState';
import { STANDING, StandingNotice } from '@/components/certificates/CertificateStanding';

function Detail({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right break-all' : 'font-medium text-right'}>{value}</span>
    </div>
  );
}

// Genuine but no longer current (superseded, expired, playbook changed) is shown as such, not as valid.
function Verified({ data }) {
  const status = data.status || 'valid';
  const current = status === 'valid';
  return (
    <div className="flex flex-col items-center text-center">
      <div className={current
        ? 'w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 flex items-center justify-center'
        : 'w-16 h-16 rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300 flex items-center justify-center'}
      >
        {current ? <ShieldCheck className="w-8 h-8" /> : <ShieldAlert className="w-8 h-8" />}
      </div>
      <h1 className="text-2xl font-bold mt-4">{current ? 'Certificate verified' : 'Certificate not current'}</h1>
      <p className="text-sm text-muted-foreground mt-1">Issued by Inspironics Engineering Academy</p>
      <StandingNotice status={status} supersededBy={data.superseded_by} className="w-full mt-4 text-left" />
      <div className="w-full mt-6 divide-y divide-border text-left">
        <Detail label="Status" value={STANDING[status]?.label || status} />
        <Detail label="Learner" value={data.user_name || '—'} />
        <Detail label="Course" value={data.course_title || '—'} />
        <Detail label="Score" value={`${Math.round(data.score || 0)}%`} />
        <Detail label="Completed" value={data.completion_date ? format(new Date(data.completion_date), 'MMMM d, yyyy') : '—'} />
        {data.expires_date && <Detail label={status === 'expired' ? 'Expired' : 'Valid until'} value={format(new Date(`${data.expires_date}T12:00:00`), 'MMMM d, yyyy')} />}
        <Detail label="Certificate ID" value={data.certificate_id} mono />
      </div>
    </div>
  );
}

function Invalid({ certificateId }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-rose-100 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300 flex items-center justify-center">
        <ShieldX className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold mt-4">Certificate not found</h1>
      <p className="text-sm text-muted-foreground mt-1">
        We couldn't verify <span className="font-mono">{certificateId}</span>. Check the link or ask the holder for a new one.
      </p>
    </div>
  );
}

export default function CertificateVerify() {
  const { certificateId } = useParams();
  const { data, isLoading } = useQuery({
    queryKey: ['verify-certificate', certificateId],
    retry: false,
    queryFn: async () => {
      try {
        const res = await api.functions.invoke('verifyCertificate', { certificate_id: certificateId });
        return res?.data || { valid: false };
      } catch {
        return { valid: false };
      }
    },
  });

  return (
    <AuthLayout wide footer={<Link to="/login" className="text-primary hover:underline">Learn with Inspironics</Link>}>
      {isLoading ? <LoadingState label="Verifying certificate…" /> : data?.valid ? <Verified data={data} /> : <Invalid certificateId={certificateId} />}
    </AuthLayout>
  );
}
