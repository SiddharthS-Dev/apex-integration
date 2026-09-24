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
 * @typedef {object} Project
 * @property {string} id       Stable key, also the CSS accent hook on the dashboard.
 * @property {string} base     Mount path. Must match `base` in the child's vite.config.js.
 * @property {string} dir      Folder name under the repo root.
 * @property {number} devPort  The child's own vite dev server. Never opened directly.
 * @property {string} name
 * @property {string} tagline
 * @property {string} [webDir]  Where its vite app lives, under `dir` ('' = `dir` itself).
 * @property {(gateway: string) => Record<string, string>} [webEnv]
 *   Environment for its vite dev server and build, given the gateway's URL.
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
 * @property {(gateway: string) => Record<string, string>} env
 *   Environment for the server, given the gateway's URL. Each server has its
 *   own variable names (and both use PORT), so apex/run.mjs sets these per
 *   process — they override the matching lines in that server's .env.
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
      env: (gateway) => ({
        PORT: '4176',
        PUBLIC_API_URL: `${gateway}/showcase`,
        WEB_ORIGIN: `${gateway}/showcase`,
        // Behind the gateway the Host header is the API's own port, so its
        // same-origin check would refuse the browser's POSTs without this.
        EXTRA_ORIGINS: gateway,
        DROPBOX_REDIRECT_URI: `${gateway}/showcase/api/dropbox/oauth/callback`,
      }),
    },
    name: 'Innovation Showcase',
    tagline: 'An immersive gallery of 235 intelligent-infrastructure blueprints, command decks and architecture systems.',
  },
  {
    id: 'vault',
    base: '/vault',
    dir: 'slide vault',
    devPort: 5175,
    webDir: 'apps/web',
    webEnv: () => ({ VITE_API_BASE_URL: '/vault' }),
    api: {
      base: '/vault/api',
      port: 4175,
      dir: 'apps/api',
      entry: 'src/index.js',
      watch: true,
      oauthCallback: '/vault/api/dropbox/oauth/callback',
      sessionCookie: 'sv_session',
      env: (gateway) => ({
        PORT: '4175',
        APP_BASE_URL: `${gateway}/vault`,
        API_BASE_URL: `${gateway}/vault`,
        CORS_ORIGINS: gateway,
        DROPBOX_REDIRECT_URI: `${gateway}/vault/api/dropbox/oauth/callback`,
        GOOGLE_REDIRECT_URI: `${gateway}/vault/api/auth/google/callback`,
      }),
    },
    name: 'SlidesVault',
    tagline: 'Discover, search and view presentations across every team. Stream online, read offline.',
  },
]

/** The project whose API a request path belongs to, or null. Checked before projectFor(). */
export function apiFor(pathname) {
  return (
    PROJECTS.find((p) => p.api && (pathname === p.api.base || pathname.startsWith(`${p.api.base}/`))) || null
  )
}

/** The gateway's URL on `port` — what every OAuth redirect and API base is built from. */
export const gatewayUrl = (port = GATEWAY_PORT) => `http://localhost:${port}`

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
