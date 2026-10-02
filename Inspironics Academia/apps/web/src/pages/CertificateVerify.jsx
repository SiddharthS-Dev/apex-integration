import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ShieldCheck, ShieldX } from 'lucide-react';
import { api } from '@/api/client';
import AuthLayout from '@/components/auth/AuthLayout';
import LoadingState from '@/components/LoadingState';

function Detail({ label, value, mono = false }) {
  return (
    <div className="flex justify-between gap-4 py-2.5 text-sm">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={mono ? 'font-mono text-xs text-right break-all' : 'font-medium text-right'}>{value}</span>
    </div>
  );
}

function Verified({ data }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300 flex items-center justify-center">
        <ShieldCheck className="w-8 h-8" />
      </div>
      <h1 className="text-2xl font-bold mt-4">Certificate verified</h1>
      <p className="text-sm text-muted-foreground mt-1">Issued by Inspironics Engineering Academy</p>
      <div className="w-full mt-6 divide-y divide-border text-left">
        <Detail label="Learner" value={data.user_name || '—'} />
        <Detail label="Course" value={data.course_title || '—'} />
        <Detail label="Score" value={`${Math.round(data.score || 0)}%`} />
        <Detail label="Completed" value={data.completion_date ? format(new Date(data.completion_date), 'MMMM d, yyyy') : '—'} />
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
