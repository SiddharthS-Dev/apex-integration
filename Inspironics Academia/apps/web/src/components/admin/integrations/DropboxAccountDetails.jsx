import { AlertTriangle, CheckCircle2, Users } from 'lucide-react';
import { formatDate } from '@/components/admin/adminFormat';

export default function DropboxAccountDetails({ status }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
        <span className="font-medium">{status.account_name || 'Dropbox account'}</span>
        {status.team && (
          <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">
            <Users className="w-3 h-3" /> {status.team_name || 'Team'}
          </span>
        )}
      </div>
      {status.account_email && <p className="text-sm text-muted-foreground">{status.account_email}</p>}
      <p className="text-xs text-muted-foreground">Connected {formatDate(status.connected_at)}</p>
      {status.needs_reconnect && (
        <p className="flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle className="w-4 h-4" /> Dropbox rejected the stored credentials — reconnect to resume syncing.
        </p>
      )}
    </div>
  );
}
