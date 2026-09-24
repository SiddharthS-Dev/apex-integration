/**
 * One place for everything the app reads from the environment or treats as a
 * tunable constant.
 *
 * Nothing else in the codebase touches `import.meta.env`, so the set of things
 * a deployment can change is exactly the shape of `env` below — no hunting for
 * a stray flag in a component. The optional chain matters: `import.meta.env`
 * only exists under Vite, and the unit tests import these modules from plain
 * Node.
 */
const raw = import.meta.env ?? {}

const asOptionalString = (value) => {
  const str = typeof value === 'string' ? value.trim() : ''
  return str || ''
}

const asOptionalUrl = (value) => {
  const str = asOptionalString(value)
  if (!str) return ''

  try {
    const url = new URL(str)
    return url.toString()
  } catch {
    return ''
  }
}

const asBackend = (value) => {
  const str = asOptionalString(value).toLowerCase()
  return str === 'local' ? 'local' : 'api'
}

/**
 * '/' (same origin — the default, and what the session cookie needs), a
 * same-origin mount path such as '/showcase' (the Apex gateway serves the API
 * at /showcase/api), or an absolute base.
 */
const asApiBase = (value) => {
  const str = asOptionalString(value) || '/'
  if (str === '/') return '/'
  if (/^\/[\w\-/]+$/.test(str) && !str.startsWith('//')) return str.replace(/\/?$/, '/')
  return /^https?:\/\//i.test(str) ? str.replace(/\/?$/, '/') : '/'
}

/**
 * The path this app is mounted at, with a trailing slash ('/showcase/' behind
 * the Apex gateway, '/' when run standalone). Vite substitutes BASE_URL from
 * `base` in vite.config.js; the fallback is for the unit tests, which import
 * these modules from plain Node where `import.meta.env` does not exist.
 */
export const baseUrl = asOptionalString(raw.BASE_URL) || '/'

/** Joins a root-relative app path onto `baseUrl` without doubling the slash. */
export const withBase = (p = '') => `${baseUrl}${String(p).replace(/^\/+/, '')}`

export const env = {
  /**
   * Which backend the client talks to:
   *   'api'    the Inspironics API (Dropbox-synced catalog, server sessions)
   *   'local'  the bundled demo backend — static corpus, localStorage auth, no server
   */
  backend: asBackend(raw.VITE_BACKEND),
  /**
   * Base URL of the API. Same-origin ('/') is deliberate: the session is a
   * SameSite=Lax cookie, and a cross-origin base would still work for fetches
   * but the viewer <iframe> would load without the cookie and get a 401.
   */
  apiBaseUrl: asApiBase(raw.VITE_API_BASE_URL),
  /** Enables the real Google Identity button; falsy falls back to a demo sign-in. */
  googleClientId: asOptionalString(raw.VITE_GOOGLE_CLIENT_ID),
  mode: raw.MODE || 'production',
  isDev: !!raw.DEV,
  /** POST target for `shared/lib/reporter`. Unset means log-only. */
  errorEndpoint: asOptionalUrl(raw.VITE_ERROR_ENDPOINT),
}

/**
 * localStorage keys, versioned in the name.
 *
 * Bump the suffix when a stored shape changes incompatibly: an old value then
 * simply reads as absent rather than as corrupt.
 */
export const storageKeys = {
  authUsers: 'inspironics.auth.users.v1',
  authSession: 'inspironics.auth.session.v1',
  authPending: 'inspironics.auth.pending.v1',
  authReset: 'inspironics.auth.reset.v1',
  authDemoCode: 'inspironics.auth.democode.v1',
  customItems: 'inspironics.customItems.v1',
  /** API backend: non-secret mirror of the server session (the cookie itself is httpOnly). */
  apiSession: 'inspironics.api.session.v1',
  apiPending: 'inspironics.api.pending.v1',
  apiDevCode: 'inspironics.api.devcode.v1',
  explorerQuality: 'inspironics.explorer.quality.v1',
}

/** Auth policy. A server would own these; they live here until one does. */
export const authPolicy = {
  otpTtlMs: 10 * 60 * 1000,
  resetTtlMs: 15 * 60 * 1000,
  maxCodeAttempts: 5,
  /** OWASP's floor for PBKDF2-HMAC-SHA256. */
  pbkdf2Iterations: 210000,
  sessionHours: 24 * 7,
  guestSessionHours: 12,
}

/**
 * Where the corpus and its images come from.
 *
 * Both go through `withBase` because the app is mounted under /showcase/ by the
 * Apex gateway: a bare '/images/...' would leave this app's mount entirely and
 * hit the dashboard instead.
 */
export const showcaseConfig = {
  dataUrl: withBase('data/showcase.json'),
  imageBase: withBase('images'),
  pageSize: 48,
}
