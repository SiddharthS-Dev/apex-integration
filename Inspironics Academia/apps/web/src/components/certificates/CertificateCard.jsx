import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import { Award, Copy, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyVerifyLink } from '@/components/certificates/verifyLink';
import { CertificateStatusBadge, standingOf } from '@/components/certificates/CertificateStanding';
import { cn } from '@/lib/utils';

export default function CertificateCard({ certificate }) {
  const date = certificate.completion_date || certificate.created_date;
  const status = standingOf(certificate);
  return (
    <div className={cn('rounded-2xl border border-border bg-card p-5 flex flex-col gap-4 relative overflow-hidden', status === 'superseded' && 'opacity-75')}>
      <div className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', status === 'valid' ? 'from-indigo-500 to-violet-600' : 'from-amber-400 to-rose-500')} />
      <div className="flex items-start gap-3">
        <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white flex items-center justify-center shrink-0">
          <Award className="w-5 h-5" />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold leading-snug line-clamp-2">{certificate.course_title || 'Course certificate'}</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {date ? format(new Date(date), 'MMMM d, yyyy') : '—'}
            {certificate.playbook_version && <> · Playbook {certificate.playbook_version}</>}
          </p>
          <CertificateStatusBadge certificate={certificate} status={status} className="mt-2" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div className="rounded-xl bg-muted/60 p-3">
          <div className="text-xs text-muted-foreground">Score</div>
          <div className="font-semibold">{Math.round(certificate.score || 0)}%</div>
        </div>
        <div className="rounded-xl bg-muted/60 p-3 min-w-0">
          <div className="text-xs text-muted-foreground">Certificate ID</div>
          <div className="font-mono text-xs font-medium truncate" title={certificate.certificate_id}>{certificate.certificate_id || '—'}</div>
        </div>
      </div>
      <div className="flex gap-2 mt-auto">
        <Button asChild size="sm" className="flex-1">
          <Link to={`/certificate/${certificate.course_id}`}><ExternalLink /> View</Link>
        </Button>
        <Button size="sm" variant="outline" onClick={() => copyVerifyLink(certificate.certificate_id)} disabled={!certificate.certificate_id}>
          <Copy /> Copy verify link
        </Button>
      </div>
    </div>
  );
}
