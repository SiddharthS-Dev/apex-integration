import { AlertTriangle, Cloud } from 'lucide-react';
import PageHeader from '@/components/PageHeader';
import LoadingState from '@/components/LoadingState';
import EmptyState from '@/components/EmptyState';
import DropboxConnectionCard from '@/components/admin/integrations/DropboxConnectionCard';
import SyncFolderPicker from '@/components/admin/integrations/SyncFolderPicker';
import MeetingsFolderPicker from '@/components/admin/integrations/MeetingsFolderPicker';
import SkippedFilesNotice from '@/components/admin/integrations/SkippedFilesNotice';
import MeetingsDropboxCard from '@/components/admin/integrations/MeetingsDropboxCard';
import CategorySourcesCard from '@/components/admin/integrations/CategorySourcesCard';
import SyncStatusPanel from '@/components/admin/integrations/SyncStatusPanel';
import SyncHistoryTable from '@/components/admin/integrations/SyncHistoryTable';
import EmailDeliveryCard from '@/components/admin/integrations/EmailDeliveryCard';
import useOAuthResultToast from '@/components/admin/integrations/useOAuthResultToast';
import {
  useDropboxStatus, useMeetingsDropboxStatus, useRefreshIntegrations, useSyncLogs, useSyncStatus,
} from '@/components/admin/integrations/integrationQueries';

export default function Integrations() {
  const refresh = useRefreshIntegrations();
  useOAuthResultToast(refresh);
  const dropbox = useDropboxStatus();
  const connected = !!(dropbox.data?.configured && dropbox.data?.connected);
  // Meetings may come through a Dropbox app of their own, connected separately.
  const meetingsDropbox = useMeetingsDropboxStatus({ enabled: !!dropbox.data?.configured });
  const meetingsOwnApp = !!meetingsDropbox.data?.configured;
  const meetingsConnected = meetingsOwnApp ? !!meetingsDropbox.data?.connected : connected;
  const anyConnected = connected || meetingsConnected;
  const sync = useSyncStatus(anyConnected);
  const logs = useSyncLogs(anyConnected, !!sync.data?.running);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
      <PageHeader title="Integrations" description="Connect Dropbox, keep playbooks and meeting transcripts in sync, and deliver email" icon={Cloud} />
      {dropbox.isLoading && <LoadingState label="Loading integrations…" />}
      {dropbox.error && <EmptyState icon={AlertTriangle} title="Could not load integrations" description={dropbox.error.message} />}
      {dropbox.data && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <DropboxConnectionCard status={dropbox.data} />
            {connected && <SkippedFilesNotice count={dropbox.data.ignored_count} />}
            {connected && <SyncFolderPicker rootPath={dropbox.data.root_path} />}
            {dropbox.data.configured && <MeetingsDropboxCard status={meetingsDropbox.data} />}
            {meetingsConnected && <MeetingsFolderPicker meetingsPath={dropbox.data.meetings_path || ''} ownApp={meetingsOwnApp} />}
          </div>
          {dropbox.data.configured && <CategorySourcesCard />}
          {anyConnected && <SyncStatusPanel status={sync.data} />}
          {anyConnected && <SyncHistoryTable logs={logs.data} />}
        </div>
      )}
      {/* Email doesn't depend on Dropbox: shown even when its status fails to load. */}
      <div className="mt-6"><EmailDeliveryCard /></div>
    </div>
  );
}
