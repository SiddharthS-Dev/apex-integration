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
 */

/** @type {Project[]} */
export const PROJECTS = [
  {
    id: 'showcase',
    base: '/showcase',
    dir: 'inspironics-innovation-showcase',
    devPort: 5174,
    name: 'Innovation Showcase',
    tagline: 'An immersive gallery of 235 intelligent-infrastructure blueprints, command decks and architecture systems.',
  },
  {
    id: 'vault',
    base: '/vault',
    dir: 'slide vault',
    devPort: 5175,
    name: 'SlidesVault',
    tagline: 'Discover, search and view presentations across every team. Stream online, read offline.',
  },
]

/** The project a request path belongs to, or null for the dashboard itself. */
export function projectFor(pathname) {
  return PROJECTS.find((p) => pathname === p.base || pathname.startsWith(`${p.base}/`)) || null
}
