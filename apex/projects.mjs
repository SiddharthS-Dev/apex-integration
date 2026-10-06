/**
 * The Apex registry: every project the shell knows how to mount.
 *
 * This is the single source of truth for ports and mount paths. The gateway
 * proxies/serves from it, start.bat launches from it, and each child app's
 * vite.config.js must agree with its `base` and `devPort` — if they drift, the
 * child renders at the wrong URL and its assets 404.
 */

/** Where the whole of Apex is reachable in dev. The only port you open. */
export const GATEWAY_PORT = 5173

/** Where `start.bat prod` serves the built output. */
export const PROD_PORT = 4173

/**
 * The interface the gateway listens on (APEX_HOST). Loopback by default, so
 * neither the dashboard nor any app behind it is reachable from the network
 * unless that is asked for — put a reverse proxy in front instead (README).
 */
export const GATEWAY_HOST = (process.env.APEX_HOST || '').trim() || '127.0.0.1'

/**
 * How long one sign-in lasts, in hours (APEX_SESSION_HOURS, default 12).
 *
 * Every app is started with the same value as its own session lifetime
 * (SESSION_TTL_HOURS), so no app session outlives the Apex one that issued it.
 */
export const SESSION_HOURS = (() => {
  const n = Number(process.env.APEX_SESSION_HOURS)
  return Number.isFinite(n) && n > 0 && n <= 24 * 30 ? n : 12
})()

/**
 * @typedef {object} Project
 * @property {string} id       Stable key, also the CSS accent hook on the dashboard.
 * @property {string} base     Mount path. Must match `base` in the child's vite.config.js.
 * @property {string} dir      Folder name under the repo root.
 * @property {number} devPort  The child's own vite dev server. Never opened directly.
 * @property {string} name
 * @property {string} tagline
 * @property {string} [webDir]  Where its vite app lives, under `dir` ('' = `dir` itself).
 * @property {(gateway: string, port: number) => Record<string, string>} [webEnv]
 *   Environment for its vite dev server and build, given the gateway's public
 *   URL and the port it listens on (HMR dials the port, not the public URL).
 * @property {string[]} [publicPaths] Exact paths served without the Apex
 *   sign-in. Each is inside this project's mount and never under its API.
 * @property {ProjectApi} [api] A backend the gateway routes to, beside the SPA.
 */

/**
 * A project's own API server.
 *
 * The gateway sends `base` to it with that prefix stripped, so the server
 * keeps seeing the `/api/…` paths it was written for. Putting it on the
 * gateway's origin rather than its own port is what lets a SameSite=Lax session
 * cookie reach it — including from an <iframe> — and it is also where OAuth
 * providers are told to send the browser back (see redirectUri below).
 *
 * @typedef {object} ProjectApi
 * @property {string} base   Path on the gateway, e.g. '/vault/api'.
 * @property {number} port   The API server's own port. Never opened directly.
 * @property {string} dir    Folder, under the project, the server runs from.
 * @property {string} entry  Its entry script, relative to `dir`.
 * @property {string[]} [nodeArgs] Extra node flags.
 * @property {boolean} [watch] Restart on source changes in dev (node --watch).
 * @property {string} oauthCallback Its Dropbox OAuth callback path on the gateway.
 * @property {string} sessionCookie  The cookie its session lives in. The Apex
 *   sign-in (apex/auth.mjs) signs in to every API with the one set of
 *   credentials and hands the browser each of these, so no app asks again.
 *   The gateway scopes it to Path=/<mount>/ and forwards it to this project
 *   only — never another app's, never apex_session.
 * @property {string} health  Its unauthenticated health route, on the gateway.
 *   The dashboard probes it to tell "web up, API down" from "all up".
 * @property {{ page: RegExp, api: string }} [publicVerify]  A public page the
 *   gateway serves itself when signed out, and the one API call it may make.
 * @property {(gateway: string, opts: ApiEnvOptions) => Record<string, string>} env
 *   Environment for the server, given the gateway's public URL. Each server
 *   has its own variable names (and all use PORT), so apex/run.mjs sets these
 *   per process — they override the matching lines in that server's .env.
 *   What every API shares (HOST, TRUST_PROXY, NODE_ENV) run.mjs adds itself.
 */

/**
 * @typedef {object} ApiEnvOptions
 * @property {boolean} secure   The public URL is https, so cookies must be Secure.
 * @property {boolean} local    The public URL is this machine (localhost, 127.0.0.1).
 * @property {string[]} origins Every browser origin Apex is reached at: the
 *   public one, plus http://localhost:<port> when that differs.
 * @property {string} sessionHours  SESSION_HOURS, as a string.
 */

/** @type {Project[]} */
export const PROJECTS = [
  {
    id: 'showcase',
    base: '/showcase',
    dir: 'inspironics-innovation-showcase',
    devPort: 5174,
    webDir: 'apps/web',
    webEnv: () => ({ VITE_BACKEND: 'api', VITE_API_BASE_URL: '/showcase' }),
    api: {
      base: '/showcase/api',
      port: 4176,
      dir: 'apps/api',
      entry: 'src/server.js',
      nodeArgs: ['--disable-warning=ExperimentalWarning'],
      // Not --watch: the standalone repo dropped it because it orphans processes on Windows.
      watch: false,
      oauthCallback: '/showcase/api/dropbox/oauth/callback',
      sessionCookie: 'insp_session',
      health: '/showcase/api/health',
      env: (gateway, { secure, local, origins, sessionHours }) => ({
        PORT: '4176',
        PUBLIC_API_URL: `${gateway}/showcase`,
        WEB_ORIGIN: `${gateway}/showcase`,
        // Behind the gateway the Host header is the API's own port, so its
        // same-origin check would refuse the browser's POSTs without this.
        EXTRA_ORIGINS: origins.join(','),
        DROPBOX_REDIRECT_URI: `${gateway}/showcase/api/dropbox/oauth/callback`,
        SESSION_TTL_HOURS: sessionHours,
        // Registration and reset codes are mailed, never echoed to the browser.
        EXPOSE_DEV_CODES: 'false',
        // The gateway serves the build in prod; the API must not serve it too.
        SERVE_WEB: 'false',
        // Its config refuses non-Secure cookies in production unless the public
        // URL is local or COOKIE_SECURE=false is said out loud. Say it only for
        // a local http URL, so a public http deployment still refuses to start.
        ...(secure ? { COOKIE_SECURE: 'true' } : local ? { COOKIE_SECURE: 'false' } : {}),
      }),
    },
    name: 'Innovation Showcase',
    // No count here: the catalogue grows with every sync. The dashboard shows
    // the live total when it can get it.
    tagline: 'An immersive gallery of intelligent-infrastructure blueprints, command decks and architecture systems.',
  },
  {
    id: 'vault',
    base: '/vault',
    dir: 'slide vault',
    devPort: 5175,
    webDir: 'apps/web',
    webEnv: () => ({ VITE_API_BASE_URL: '/vault' }),
    // Its index.html links /manifest.webmanifest, which vite rewrites under the
    // base. A browser fetches <link rel="manifest"> without cookies, so behind
    // the sign-in it would get a redirect to /login instead and log an error on
    // every page. The file holds a name, colours and icon paths — nothing private.
    publicPaths: ['/vault/manifest.webmanifest'],
    api: {
      base: '/vault/api',
      port: 4175,
      dir: 'apps/api',
      entry: 'src/index.js',
      watch: true,
      oauthCallback: '/vault/api/dropbox/oauth/callback',
      sessionCookie: 'sv_session',
      health: '/vault/api/health',
      env: (gateway, { secure, origins, sessionHours }) => ({
        PORT: '4175',
        APP_BASE_URL: `${gateway}/vault`,
        API_BASE_URL: `${gateway}/vault`,
        CORS_ORIGINS: origins.join(','),
        DROPBOX_REDIRECT_URI: `${gateway}/vault/api/dropbox/oauth/callback`,
        GOOGLE_REDIRECT_URI: `${gateway}/vault/api/auth/google/callback`,
        SESSION_TTL_HOURS: sessionHours,
        SESSION_COOKIE_SECURE: String(secure),
      }),
    },
    name: 'SlidesVault',
    tagline: 'Discover, search and view presentations across every team. Stream online, read offline.',
  },
  {
    id: 'academia',
    base: '/academia',
    dir: 'Inspironics Academia',
    devPort: 5176,
    webDir: 'apps/web',
    // Its vite.config.js reads the mount and dev server from these, so it still runs standalone at '/'
    // when they are unset — rather than hard-coding them the way the other two do.
    webEnv: (_gateway, port) => ({
      VITE_API_BASE_URL: '/academia',
      APEX_BASE: '/academia/',
      APEX_DEV_PORT: '5176',
      // HMR dials the port the gateway listens on — not the public URL's,
      // which behind a reverse proxy is 443 (or nothing at all).
      APEX_GATEWAY_PORT: String(port),
    }),
    api: {
      base: '/academia/api',
      port: 4177,
      dir: 'apps/api',
      entry: 'src/server.js',
      // Its own npm scripts load .env with this flag; run.mjs starts node directly, so pass it here.
      nodeArgs: ['--env-file-if-exists=.env', '--disable-warning=ExperimentalWarning'],
      // Not --watch, like the Showcase: it orphans processes on Windows.
      watch: false,
      oauthCallback: '/academia/api/dropbox/oauth/callback',
      sessionCookie: 'iea_session',
      health: '/academia/api/health',
      env: (gateway, { secure, sessionHours }) => ({
        PORT: '4177',
        APP_ORIGIN: gateway,
        APP_BASE_URL: `${gateway}/academia`,
        API_ORIGIN: gateway,
        DROPBOX_REDIRECT_URI: `${gateway}/academia/api/dropbox/oauth/callback`,
        SESSION_TTL_HOURS: sessionHours,
        COOKIE_SECURE: String(secure),
      }),
      /**
       * Certificates carry a link to /academia/verify/:id for anyone to check,
       * signed in or not. Signed out, the gateway answers that page itself
       * (apex/public/verify.html) and lets exactly this one API call through to
       * back it: POST, JSON, no session.
       */
      publicVerify: {
        page: /^\/academia\/verify\/[^/]+\/?$/,
        api: '/academia/api/functions/verifyCertificate',
      },
    },
    name: 'Inspironics Academia',
    tagline: 'Engineering playbooks turned into courses, tests and verifiable certificates.',
  },
]

/** The project whose API a request path belongs to, or null. Checked before projectFor(). */
export function apiFor(pathname) {
  return (
    PROJECTS.find((p) => p.api && (pathname === p.api.base || pathname.startsWith(`${p.api.base}/`))) || null
  )
}

/** The local address the gateway always answers at, whatever its public URL. */
export const localUrl = (port = GATEWAY_PORT) => `http://localhost:${port}`

/**
 * The gateway's public URL — what every OAuth redirect, origin and API base
 * handed to the apps is built from.
 *
 * APEX_PUBLIC_URL when Apex sits behind a reverse proxy (https://apex.example.com),
 * otherwise http://localhost:<port>. Always a bare origin, no trailing slash:
 * the apps are mounted at its root, so a path in it is ignored.
 */
export const gatewayUrl = (port = GATEWAY_PORT) => {
  const configured = (process.env.APEX_PUBLIC_URL || '').trim()
  if (configured) {
    try {
      const u = new URL(configured)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin
    } catch {
      /* not a URL — fall back to the local default */
    }
  }
  return localUrl(port)
}

/** Everything an API's env() needs to know about how the browser reaches it. */
export function apiEnvOptions(port = GATEWAY_PORT) {
  const pub = new URL(gatewayUrl(port))
  return {
    secure: pub.protocol === 'https:',
    local: ['localhost', '127.0.0.1', '[::1]'].includes(pub.hostname),
    origins: [...new Set([pub.origin, localUrl(port)])],
    sessionHours: String(SESSION_HOURS),
  }
}

/**
 * Every Dropbox redirect URI Apex uses on `port`. Each must be listed under
 * "Redirect URIs" in the Dropbox App Console — start.bat prints them.
 */
export const dropboxRedirectUris = (port = GATEWAY_PORT) =>
  PROJECTS.filter((p) => p.api?.oauthCallback).map((p) => ({
    project: p.name,
    uri: `${gatewayUrl(port)}${p.api.oauthCallback}`,
  }))

/** The project a request path belongs to, or null for the dashboard itself. */
export function projectFor(pathname) {
  return PROJECTS.find((p) => pathname === p.base || pathname.startsWith(`${p.base}/`)) || null
}

/** Every app session cookie name — what the gateway keeps apart per project. */
export const SESSION_COOKIES = PROJECTS.filter((p) => p.api?.sessionCookie).map((p) => p.api.sessionCookie)
