import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';

// Data hooks for AI Studio. Job status is polled from the server (real progress, never simulated).

export const STUDIO_KEY = ['studio-ai'];

export function useStudioConfig() {
  return useQuery({ queryKey: [...STUDIO_KEY, 'config'], queryFn: () => api.studio.config(), staleTime: 60_000 });
}

export function useUsage() {
  return useQuery({ queryKey: [...STUDIO_KEY, 'usage'], queryFn: () => api.studio.usage(), refetchInterval: 30_000 });
}

export function useHistory(kind) {
  return useQuery({ queryKey: [...STUDIO_KEY, 'history', kind || 'all'], queryFn: () => api.studio.history({ kind: kind || undefined, limit: 200 }), refetchInterval: 30_000 });
}

export function useProjects() {
  return useQuery({ queryKey: [...STUDIO_KEY, 'projects'], queryFn: () => api.studio.projects() });
}

export function useProject(id) {
  return useQuery({ queryKey: [...STUDIO_KEY, 'project', id], queryFn: () => api.studio.project(id), enabled: !!id });
}

const ACTIVE = new Set(['queued', 'processing']);
export const jobActive = (job) => !!job && ACTIVE.has(job.status);

/** Polls a job every 1.5 s while it is queued or running. */
export function useJob(id) {
  return useQuery({
    queryKey: [...STUDIO_KEY, 'job', id],
    queryFn: () => api.studio.job(id),
    enabled: !!id,
    refetchInterval: (q) => (jobActive(q.state.data) ? 1500 : false),
  });
}

/** The latest render job for a record (lesson, meeting or project). */
export function useLatestJob(refType, refId) {
  return useQuery({
    queryKey: [...STUDIO_KEY, 'jobs', refType, refId],
    queryFn: async () => (await api.studio.jobs({ ref_type: refType, ref_id: refId, limit: 1 }))[0] || null,
    enabled: !!refId,
    refetchInterval: (q) => (jobActive(q.state.data) ? 1500 : false),
  });
}

export function useRefreshStudio() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: STUDIO_KEY });
}

export function useStorage() {
  return useQuery({ queryKey: [...STUDIO_KEY, 'storage'], queryFn: () => api.studio.storage(), staleTime: 30_000 });
}

export function useStorageOverview() {
  return useQuery({ queryKey: [...STUDIO_KEY, 'storage-overview'], queryFn: () => api.studio.storageOverview(), staleTime: 30_000 });
}

export function useDropboxAccounts(enabled = true) {
  return useQuery({ queryKey: [...STUDIO_KEY, 'dropbox-accounts'], queryFn: () => api.studio.dropboxAccounts(), enabled, staleTime: 60_000 });
}

/** Binary units, as the file system counts them (1 MB = 1,048,576 bytes). */
export const fmtBytes = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  if (v < 1024) return `${v} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let x = v / 1024;
  let i = 0;
  while (x >= 1024 && i < units.length - 1) { x /= 1024; i++; }
  return `${x.toFixed(x < 10 ? 2 : 1)} ${units[i]}`;
};
export const fmtDate = (s) => (s ? new Date(s).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—');

export const fmtUsd =(v) => (v == null ? '—' : Number(v) === 0 ? '$0.00' : `$${Number(v).toFixed(Number(v) < 1 ? 4 : 2)}`);
export const fmtInt = (v) => (v == null ? '—' : Number(v).toLocaleString());
export const fmtSeconds = (s) => {
  const t = Math.round(Number(s) || 0);
  return t >= 60 ? `${Math.floor(t / 60)}m ${t % 60}s` : `${t}s`;
};
