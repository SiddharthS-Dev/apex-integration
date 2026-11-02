import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

// Shared react-query keys and hooks for the Integrations page.
export const DROPBOX_STATUS_KEY = ['dropbox-status'];
export const SYNC_STATUS_KEY = ['sync-status'];
export const MEETINGS_DROPBOX_KEY = ['dropbox-meetings-status'];
export const SYNC_LOGS_KEY = ['sync-logs'];

export function useDropboxStatus({ enabled = true } = {}) {
  return useQuery({ queryKey: DROPBOX_STATUS_KEY, queryFn: () => api.dropbox.status(), enabled });
}

// The meetings Dropbox app (configured / connected / its redirect URI).
export function useMeetingsDropboxStatus({ enabled = true } = {}) {
  return useQuery({ queryKey: MEETINGS_DROPBOX_KEY, queryFn: () => api.dropbox.meetings.status(), enabled });
}

// Polls fast (3 s) while a run is in progress, otherwise every 30 s.
export function useSyncStatus(enabled = true) {
  return useQuery({
    queryKey: SYNC_STATUS_KEY,
    queryFn: () => api.sync.status(),
    enabled,
    refetchInterval: (query) => (query.state.data?.running ? 3000 : 30000),
  });
}

export function useSyncLogs(enabled = true, running = false) {
  return useQuery({
    queryKey: SYNC_LOGS_KEY,
    queryFn: () => api.sync.logs(50),
    enabled,
    refetchInterval: running ? 3000 : 30000,
  });
}

export function useRefreshIntegrations() {
  const qc = useQueryClient();
  return () => Promise.all([DROPBOX_STATUS_KEY, MEETINGS_DROPBOX_KEY, SYNC_STATUS_KEY, SYNC_LOGS_KEY].map((queryKey) => qc.invalidateQueries({ queryKey })));
}
