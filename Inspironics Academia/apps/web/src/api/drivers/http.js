// HTTP driver: talks to the Academy API on the same origin (Vite proxies /api → :4000 in dev).
// Same-origin matters: the session is a SameSite=Lax cookie, so a cross-origin API would break
// embedded content (iframes, <video>, <audio>) that relies on the cookie.

const BASE = (import.meta.env.VITE_API_BASE_URL || '/').replace(/\/$/, '');

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

async function request(method, path, { body, query, raw, headers } = {}) {
  const url = new URL(`${BASE}/api${path}`, window.location.origin);
  if (query) for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: raw ? headers : { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: raw ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) throw new ApiError(res.status, data?.error || res.statusText || 'Request failed', data?.details);
  return data;
}

function entityHandler(name) {
  const base = `/entities/${name}`;
  return {
    list: (sort, limit, skip) => request('GET', base, { query: { sort, limit, skip } }),
    filter: (q, sort, limit, skip) => request('GET', base, { query: { q: JSON.stringify(q || {}), sort, limit, skip } }),
    get: (id) => request('GET', `${base}/${id}`),
    create: (data) => request('POST', base, { body: data }),
    bulkCreate: (items) => request('POST', `${base}/bulk`, { body: items }),
    update: (id, data) => request('PATCH', `${base}/${id}`, { body: data }),
    delete: (id) => request('DELETE', `${base}/${id}`),
    deleteMany: (q) => request('POST', `${base}/delete-many`, { body: { query: q } }),
  };
}

export function createHttpDriver() {
  const entityCache = new Map();
  return {
    kind: 'api',
    entities: new Proxy({}, {
      get(_t, name) {
        if (typeof name !== 'string') return undefined;
        if (!entityCache.has(name)) entityCache.set(name, entityHandler(name));
        return entityCache.get(name);
      },
    }),

    auth: {
      me: () => request('GET', '/auth/me'),
      loginViaEmailPassword: (email, password) => request('POST', '/auth/login', { body: { email, password } }),
      register: ({ email, password, full_name }) => request('POST', '/auth/register', { body: { email, password, full_name } }),
      async logout(redirectUrl) {
        try { await request('POST', '/auth/logout'); } finally { if (redirectUrl) window.location.href = redirectUrl; }
      },
      updateMe: (data) => request('PATCH', '/auth/me', { body: data }),
      changePassword: ({ currentPassword, newPassword }) => request('POST', '/auth/change-password', { body: { currentPassword, newPassword } }),
      resetPasswordRequest: (email) => request('POST', '/auth/reset-password-request', { body: { email } }),
      resetPassword: ({ resetToken, newPassword }) => request('POST', '/auth/reset-password', { body: { resetToken, newPassword } }),
      // Returns { user, temporary_password, email_sent } — without email the admin hands the password over.
      inviteUser: (email, role, fullName, audience) => request('POST', '/auth/invite', { body: { email, role, full_name: fullName, audience } }),
      loginHistory: (opts = {}) => request('GET', '/auth/login-history', { query: opts }),
    },

    // Axios-like { data } shape so call sites read `const { data } = await api.functions.invoke(...)`.
    functions: {
      invoke: async (name, payload = {}) => ({ data: await request('POST', `/functions/${name}`, { body: payload }) }),
    },

    files: {
      // Returns { file_uri, size, file_name, file_type } — store file_uri as Playbook.file_url.
      upload: (file) => request('POST', '/files', {
        raw: true,
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      }),
      // Server path (content proxy) — never a storage or Dropbox URL.
      playbookContentUrl: (playbookId, { download = false } = {}) => `${BASE}/api/playbooks/${playbookId}/content${download ? '?download=1' : ''}`,
    },

    meetings: {
      // Creates the Meeting (status 'uploaded') from a Teams transcript; run processMeeting next.
      upload: (file) => request('POST', '/meetings/upload', {
        raw: true,
        body: file,
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
      }),
      // Server path for the original transcript file (admins only).
      contentUrl: (meetingId) => `${BASE}/api/meetings/${meetingId}/content`,
    },

    dropbox: {
      status: () => request('GET', '/dropbox/status'),
      // Full-page navigation: the API redirects to Dropbox consent, then back to /admin/integrations.
      connect: () => { window.location.href = `${BASE}/api/dropbox/oauth/start`; },
      disconnect: () => request('POST', '/dropbox/disconnect'),
      updateSettings: (settings) => request('PATCH', '/dropbox/settings', { body: settings }),
      listFolders: (path = '') => request('GET', '/dropbox/folders', { query: { path } }),
      // Lets files deleted with "keep out of future syncs" sync again → { cleared }
      clearIgnored: () => request('POST', '/dropbox/ignored/clear'),
      // The Dropbox app meeting transcripts come through, when one is set up (its own connection).
      meetings: {
        status: () => request('GET', '/dropbox/meetings/status'),
        connect: () => { window.location.href = `${BASE}/api/dropbox/meetings/oauth/start`; },
        disconnect: () => request('POST', '/dropbox/meetings/disconnect'),
        listFolders: (path = '') => request('GET', '/dropbox/meetings/folders', { query: { path } }),
      },
      // Category sources: a category's own Dropbox folder, and app when it has one.
      sources: {
        list: () => request('GET', '/dropbox/sources'),
        connect: (key) => { window.location.href = `${BASE}/api/dropbox/sources/${encodeURIComponent(key)}/oauth/start`; },
        disconnect: (key) => request('POST', `/dropbox/sources/${encodeURIComponent(key)}/disconnect`),
        listFolders: (key, path = '') => request('GET', `/dropbox/sources/${encodeURIComponent(key)}/folders`, { query: { path } }),
        setFolder: (key, path) => request('PATCH', `/dropbox/sources/${encodeURIComponent(key)}`, { body: { path } }),
      },
    },

    sync: {
      status: () => request('GET', '/sync/status'),
      runNow: () => request('POST', '/sync/run'),
      logs: (limit = 50) => request('GET', '/sync/logs', { query: { limit } }),
    },

    // Email delivery (admin). In-app notifications are the Notification entity.
    notifications: {
      emailStatus: () => request('GET', '/notifications/email/status'),
      sendTestEmail: (to) => request('POST', '/notifications/email/test', { body: { to } }),
    },

    system: {
      config: () => request('GET', '/config'),
      metrics: () => request('GET', '/metrics'),
    },
  };
}
