/** The admin console's calls. Every one is authorised server-side (`requireAdmin`). */
import { apiRequest, apiUrl } from '#shared/lib/apiClient.js'

export const adminApi = {
  dropboxStatus: () => apiRequest('/api/dropbox/status'),
  /** A top-level navigation, so the SameSite=Lax session cookie goes with it. */
  connectUrl: () => apiUrl('/api/dropbox/oauth/start'),
  disconnect: () => apiRequest('/api/dropbox/disconnect', { method: 'POST', body: {} }),
  folders: (path = '') => apiRequest(`/api/dropbox/folders?path=${encodeURIComponent(path)}`),
  setRootPath: (rootPath) => apiRequest('/api/dropbox/settings', { method: 'PUT', body: { rootPath } }),
  runSync: () => apiRequest('/api/dropbox/sync', { method: 'POST', body: {} }),
  syncStatus: () => apiRequest('/api/dropbox/sync'),
  syncLogs: (limit = 25) => apiRequest(`/api/entities/sync-logs?limit=${limit}`),
  analytics: (days = 30) => apiRequest(`/api/entities/analytics?days=${days}`),
  loginHistory: (limit = 100) => apiRequest(`/api/entities/login-history?limit=${limit}`),
  users: () => apiRequest('/api/admin/users'),
  updateUser: (id, patch) => apiRequest(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch }),
  config: () => apiRequest('/api/admin/config'),
  cache: () => apiRequest('/api/admin/cache'),
  clearCache: () => apiRequest('/api/admin/cache', { method: 'DELETE' }),
}
