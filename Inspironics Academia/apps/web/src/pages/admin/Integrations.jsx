import { AlertTriangle, Cloud } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import DropboxConnectionCard from '@/components/admin/integrations/DropboxConnectionCard';
import SyncFolderPicker from '@/components/admin/integrations/SyncFolderPicker';
import SyncStatusPanel from '@/components/admin/integrations/SyncStatusPanel';
import SyncHistoryTable from '@/components/admin/integrations/SyncHistoryTable';
import useOAuthResultToast from '@/components/admin/integrations/useOAuthResultToast';
import {
  useDropboxStatus, useRefreshIntegrations, useSyncLogs, useSyncStatus,
} from '@/components/admin/integrations/integrationQueries';

export default function Integrations() {
  const refresh = useRefreshIntegrations();
  useOAuthResultToast(refresh);
  const dropbox = useDropboxStatus();
  const connected = !!(dropbox.data?.configured && dropbox.data?.connected);
  const sync = useSyncStatus(connected);
  const logs = useSyncLogs(connected, !!sync.data?.running);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Integrations" description="Connect Dropbox and keep the playbook library in sync" icon={Cloud} />
      {dropbox.isLoading && <LoadingState label="Loading integrations…" />}
      {dropbox.error && <EmptyState icon={AlertTriangle} title="Could not load integrations" description={dropbox.error.message} />}
      {dropbox.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DropboxConnectionCard status={dropbox.data} />
            {connected && <SyncFolderPicker rootPath={dropbox.data.root_path} />}
          </div>
          {connected && <SyncStatusPanel status={sync.data} />}
          {connected && <SyncHistoryTable logs={logs.data} />}
        </div>
      )}
    </div>
  );
}
