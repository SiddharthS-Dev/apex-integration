import { format } from 'date-fns';
import { AlertTriangle, CheckCircle2, Clock, Replace } from 'lucide-react';
import { certificateStatus } from '@academy/shared';
import { localDay } from '@/lib/progress';
import { cn } from '@/lib/utils';

export const STANDING = {
  valid: { label: 'Valid', icon: CheckCircle2, className: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' },
  recert_required: { label: 'Recertification required', icon: AlertTriangle, className: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300' },
  expired: { label: 'Expired', icon: Clock, className: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300' },
  superseded: { label: 'Superseded', icon: Replace, className: 'bg-muted text-muted-foreground' },
};

// What a non-current certificate means, for the holder and for someone verifying it.
export const STANDING_NOTICE = {
  recert_required: 'The playbook this certificate covers has changed. It is not current until the holder recertifies.',
  expired: 'This certificate has passed its validity date. It is not current until the holder recertifies.',
  superseded: 'This certificate has been replaced by a newer one.',
};

export const standingOf = (cert) => certificateStatus(cert, localDay());

const fmt = (iso) => format(new Date(`${iso}T12:00:00`), 'MMM d, yyyy');

export function CertificateStatusBadge({ certificate, status = standingOf(certificate), className }) {
  const s = STANDING[status] || STANDING.valid;
  const Icon = s.icon;
  const until = status === 'valid' && certificate?.expires_date ? ` until ${fmt(certificate.expires_date)}` : '';
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', s.className, className)}>
      <Icon className="w-3 h-3" /> {s.label}{until}
    </span>
  );
}

/** Banner for a certificate that is no longer current (renders nothing for a valid one). */
export function StandingNotice({ status, supersededBy, className }) {
  if (!STANDING_NOTICE[status]) return null;
  const Icon = STANDING[status].icon;
  return (
    <div className={cn('flex items-start gap-2 rounded-xl border p-3 text-sm', status === 'superseded'
      ? 'border-border bg-muted/60 text-muted-foreground'
      : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300', className)}
    >
      <Icon className="w-4 h-4 shrink-0 mt-0.5" />
      <span>
        {STANDING_NOTICE[status]}
        {status === 'superseded' && supersededBy && <> Current certificate: <span className="font-mono text-xs">{supersededBy}</span>.</>}
      </span>
    </div>
  );
}
