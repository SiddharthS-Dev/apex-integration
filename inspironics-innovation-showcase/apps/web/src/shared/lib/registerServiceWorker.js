/**
 * Registers the offline service worker (built by scripts/serviceWorker.mjs) —
 * production builds only, at the app's base path, so behind the Apex gateway
 * it is /showcase/sw.js with scope /showcase/ and never touches other apps.
 *
 * On sign-out the worker drops the API answers it kept for offline use, so the
 * next person on this browser does not read the last one's cached catalogue.
 */
import { appEvents } from '#shared/config'

/**
 * @param {{ base: string, enabled: boolean, nav?: any, win?: any }} opts
 * @returns {boolean} whether registration was attempted
 */
export function registerServiceWorker({ base, enabled, nav = globalThis.navigator, win = globalThis.window }) {
  if (!enabled || !win || !nav?.serviceWorker) return false
  const start = () => nav.serviceWorker.register(`${base}sw.js`, { scope: base }).catch(() => {})
  if (win.document?.readyState === 'complete') start()
  else win.addEventListener('load', start, { once: true })
  win.addEventListener(appEvents.signedOut, () => {
    nav.serviceWorker.controller?.postMessage({ type: 'clear-api-cache' })
  })
  return true
}
