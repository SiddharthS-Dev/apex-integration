/**
 * Backend adapter for the SlidesVault API server (`server/`).
 *
 * Selected by setting `VITE_API_BASE_URL`. It presents exactly the interface
 * the rest of the app already consumes — entities, functions, auth,
 * integrations — so no page or hook knows which backend is in play.
 *
 * The rule this file exists to enforce: the browser never talks to Dropbox.
 * Every Dropbox operation is a call to our own API, authenticated with an
 * http-only session cookie the JavaScript here cannot read.
 */

const RAW = (import.meta.env.VITE_API_BASE_URL ?? '').trim();

/**
 * "/" means the API is served under this same origin — in development through
 * the Vite proxy, in production behind one domain. It normalises to an empty
 * prefix, so every request below stays a same-origin path.
 *
 * Same-origin is the preferred arrangement rather than a detail: the session
 * is a SameSite=Lax cookie, which a browser does not attach to a cross-site
 * request. Pointed at another origin, the fetches here would still work (CORS
 * allows them) but the presentation <iframe> would load without the cookie and
 * come back 401.
 */
const BASE = RAW === '/' ? '' : RAW.replace(/\/+$/, '');

/** The app's own mount ('/' standalone, '/vault/' under Apex), for navigations. */
const APP_BASE = import.meta.env.BASE_URL || '/';

/** Bare fetch against the API, with the session cookie attached. */
async function call(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    // The session is an http-only cookie; without this it is simply not sent.
    credentials: 'include',
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      'X-Requested-With': 'SlidesVault',
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal,
  });

  const contentType = response.headers.get('content-type') ?? '';
  const payload = contentType.includes('application/json') ? await response.json().catch(() => null) : null;

  if (!response.ok) {
    // The server sends a message meant for a person; use it rather than
    // inventing our own from the status code.
    const error = new Error(payload?.error || `Request failed (${response.status}).`);
    error.status = response.status;
    error.code = payload?.code;
    error.retryable = payload?.retryable ?? false;
    throw error;
  }

  return payload;
}

const get = (path) => call(path);
const post = (path, body = {}) => call(path, { method: 'POST', body });

/** A path on the API, made absolute so it works from the app's own origin. */
const absolute = (path) => (path?.startsWith('/') ? `${BASE}${path}` : path ?? '');

const query = (params) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
};

/* -------------------------------------------------------------- entities */

/**
 * The catalog is read-only from the browser: it is a projection of Dropbox,
 * and the only way to change it is to change Dropbox and sync.
 */
const readOnly = (name) => () => {
  throw new Error(
    `${name} is maintained by the Dropbox synchronization service and cannot be edited from the app.`
  );
};

/**
 * The server stores thumbnail URLs as paths on the API (`/api/assets/…`). The
 * cards drop them straight into an <img>, so they need the same prefix as every
 * other call — without it they miss the API entirely when BASE is not empty
 * (under Apex, where the API is reached at /vault/api).
 */
const withAbsoluteUrls = (item) =>
  item?.thumbnail_url ? { ...item, thumbnail_url: absolute(item.thumbnail_url) } : item;

const presentationEntity = {
  entityName: 'Presentation',
  async list(sort = '-updated_at', limit = 200, skip = 0) {
    const { items } = await get(`/api/presentations${query({ sort, limit, offset: skip })}`);
    return items.map(withAbsoluteUrls);
  },
  async filter(criteria = {}, sort = '-updated_at', limit = 200, skip = 0) {
    const { items } = await get(`/api/presentations${query({ sort, limit, offset: skip, status: criteria.status })}`);
    // The server filters by status and sorts; anything more specific is a
    // client-side concern over an already-small page.
    return items.map(withAbsoluteUrls).filter((item) =>
      Object.entries(criteria).every(([key, value]) =>
        key === 'status' ? true : String(item[key] ?? '') === String(value)
      )
    );
  },
  get: async (id) => withAbsoluteUrls(await get(`/api/presentations/${encodeURIComponent(id)}`)),
  create: readOnly('Presentation'),
  bulkCreate: readOnly('Presentation'),
  update: readOnly('Presentation'),
  delete: readOnly('Presentation'),
};

const listEntity = (name, path, key = 'items') => ({
  entityName: name,
  async list(_sort, limit = 200, skip = 0) {
    const payload = await get(`${path}${query({ limit, offset: skip })}`);
    return payload[key] ?? payload;
  },
  async filter(_criteria, _sort, limit = 200, skip = 0) {
    const payload = await get(`${path}${query({ limit, offset: skip })}`);
    return payload[key] ?? payload;
  },
  get: readOnly(name),
  create: readOnly(name),
  bulkCreate: readOnly(name),
  update: readOnly(name),
  delete: readOnly(name),
});

const entities = {
  Presentation: presentationEntity,
  SyncLog: listEntity('SyncLog', '/api/sync-logs'),
  PresentationAnalytics: listEntity('PresentationAnalytics', '/api/analytics'),
  LoginHistory: listEntity('LoginHistory', '/api/login-history'),
  DropboxConfig: {
    entityName: 'DropboxConfig',
    list: async () => [await get('/api/dropbox-config')],
    filter: async () => [await get('/api/dropbox-config')],
    get: () => get('/api/dropbox-config'),
    create: readOnly('DropboxConfig'),
    bulkCreate: readOnly('DropboxConfig'),
    update: readOnly('DropboxConfig'),
    delete: readOnly('DropboxConfig'),
  },
  User: {
    entityName: 'User',
    list: () => get('/api/auth/users'),
    filter: () => get('/api/auth/users'),
    get: readOnly('User'),
    create: readOnly('User'),
    bulkCreate: readOnly('User'),
    update: readOnly('User'),
    delete: readOnly('User'),
  },
};

/* ------------------------------------------------------------- functions */

/**
 * The backend-function surface the app already calls, mapped onto REST.
 *
 * `dropboxAuth` keeps its action-dispatch shape so DropboxSettings does not
 * have to care which backend it is talking to.
 */
const functions = {
  async dropboxAuth(payload = {}) {
    const action = payload.action ?? 'status';
    switch (action) {
      case 'getAuthUrl':
        return get('/api/dropbox/auth/url');
      case 'exchange':
        return post('/api/dropbox/oauth/exchange', { code: payload.code, state: payload.state });
      case 'test':
        return post('/api/dropbox/test');
      case 'reconnect':
        return post('/api/dropbox/reconnect');
      case 'revoke':
      case 'disconnect':
        return post('/api/dropbox/disconnect');
      case 'list_folders':
        return get(`/api/dropbox/folders${query({ path: payload.path })}`);
      case 'set_root_folder':
        return post('/api/dropbox/folder', { root_folder: payload.root_folder });
      case 'health':
        return get('/api/dropbox/health');
      case 'logs':
        return get(`/api/dropbox/sync/logs${query({ limit: payload.limit })}`);
      case 'audit':
        return get(`/api/dropbox/audit${query({ limit: payload.limit })}`);
      case 'status':
      default:
        return get('/api/dropbox/status');
    }
  },

  syncDropbox: (payload = {}) =>
    post('/api/dropbox/sync', { trigger: payload.trigger ?? 'manual', force: payload.force === true }),

  async getPresentationStream(payload = {}) {
    const id = encodeURIComponent(payload.presentation_id ?? payload.id);
    const preview = await get(`/api/dropbox/files/${id}/preview`);

    // The server describes the preview; the viewer just wants something it can
    // put in an iframe. Two things have to be reconciled here:
    //
    //  - A PDF or HTML file is proxied rather than converted, so the response
    //    carries only `streamUrl`. Passing the response through untouched
    //    leaves `url` undefined and the viewer reports that nothing came back.
    //  - Both `url` and `streamUrl` are paths on the API, not absolute URLs.
    //    The app and the API are different origins in development, so a bare
    //    path would resolve against the app and 404.
    //
    // Preferring `url` keeps the cached, already-rendered PDF when there is
    // one and falls back to the live proxy otherwise.
    const path = preview?.url || preview?.streamUrl;
    return { ...preview, url: path ? absolute(path) : '' };
  },

  getDownloadLinks: (payload = {}) =>
    get(`/api/dropbox/files/${encodeURIComponent(payload.presentation_id ?? payload.id)}/download`),

  renameUntitledPresentations: (payload = {}) =>
    post('/api/dropbox/files/rename-untitled', {
      // Dry run unless the caller explicitly says otherwise — the same default
      // the server enforces, restated here so a bug on either side is safe.
      dryRun: payload.dryRun !== false,
      limit: payload.limit ?? 50,
    }),

  trackView: (payload = {}) =>
    post('/api/analytics/view', {
      presentation_id: payload.presentation_id ?? payload.id,
      reading_seconds: payload.reading_seconds ?? 0,
      offline: payload.offline === true,
    }),

  // Sign-in is already recorded server-side by the login endpoint; this exists
  // so the shared call site keeps working.
  recordLogin: async () => ({ recorded: true }),
};

/* ------------------------------------------------------------------ auth */

const auth = {
  async me() {
    try {
      return await get('/api/auth/me');
    } catch (error) {
      if (error.status === 401) return null;
      throw error;
    }
  },

  async isAuthenticated() {
    return Boolean(await auth.me());
  },

  async login({ email, password }) {
    const { user } = await post('/api/auth/login', { email, password });
    return user;
  },

  async register({ email, password, full_name }) {
    const { user } = await post('/api/auth/register', { email, password, full_name });
    return user;
  },

  async logout(redirectUrl) {
    await post('/api/auth/logout');
    if (redirectUrl) window.location.href = redirectUrl;
    return { ok: true };
  },

  updateMyUserData: async () => {
    throw new Error('Profile editing is not available on this backend.');
  },

  /**
   * Which sign-in methods this deployment offers, so the screen can stop
   * advertising one that cannot work.
   */
  async capabilities() {
    try {
      return await get('/api/auth/config');
    } catch {
      // An unreachable API is reported elsewhere; for the sign-in screen the
      // safe answer is the method that needs no configuration.
      return { password: true, google: false };
    }
  },

  /**
   * A full-page redirect, not a fetch.
   *
   * OAuth is a chain of top-level navigations — here, to Google, to our
   * callback, back to the app — and it is the callback that sets the session
   * cookie. An XHR cannot follow a cross-origin redirect chain, so this hands
   * the browser over and never returns.
   */
  loginWithGoogle(nextPath) {
    const next = typeof nextPath === 'string' && nextPath.startsWith('/') ? nextPath : '';
    const url = absolute('/api/auth/google/start');
    window.location.href = next ? `${url}?next=${encodeURIComponent(next)}` : url;
    // The page is being replaced. Resolving would let the caller clear its
    // spinner and navigate during the hand-off, so this never settles.
    return new Promise(() => {});
  },

  // The OTP and password-reset flows belong to an identity provider; this
  // backend deliberately does not implement them.
  sendOtp: () => {
    throw new Error('One-time codes are not configured for this backend.');
  },
  verifyOtp: () => {
    throw new Error('One-time codes are not configured for this backend.');
  },
  resetPasswordRequest: () => {
    throw new Error('Password reset is not configured for this backend.');
  },
  resetPassword: () => {
    throw new Error('Password reset is not configured for this backend.');
  },
  redirectToLogin: (nextUrl) => {
    window.location.href = nextUrl || `${APP_BASE}login`;
  },
};

/* ---------------------------------------------------------- integrations */

const integrations = {
  Core: {
    // AI runs server-side, inside the sync pipeline, where the API key lives.
    InvokeLLM: async () => {
      throw new Error('AI calls are made by the backend, not the browser.');
    },
    UploadFile: async () => {
      throw new Error('Uploads are not available on this backend.');
    },
  },
};

export const apiClient = {
  mode: 'api',
  baseUrl: BASE,
  entities,
  functions,
  auth,
  integrations,
  /** Absolute URL for a server-hosted asset or content path. */
  resolveUrl: absolute,
};

// Set at all — including to "/" — selects this backend. Testing BASE instead
// would read same-origin mode as "not configured" and fall back to the demo.
export const isApiMode = RAW !== '';
