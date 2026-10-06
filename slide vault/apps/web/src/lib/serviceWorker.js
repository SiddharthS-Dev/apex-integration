/**
 * Registers public/sw.js, the offline app shell.
 *
 * Production builds only: under the Vite dev server the worker would cache
 * modules that change on every save. A worker left behind by an earlier
 * production run on the same origin is removed in development for the same
 * reason.
 *
 * The script and its scope both come from BASE_URL — /vault/sw.js with scope
 * /vault/ under Apex, /sw.js and / standalone — so the worker never claims a
 * path outside this app's mount.
 */
const BASE = import.meta.env.BASE_URL || '/';

let registered = false;

export function registerServiceWorker() {
  if (registered || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  registered = true;

  if (!import.meta.env.PROD) {
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) =>
        registrations
          .filter((registration) => new URL(registration.scope).pathname === BASE)
          .forEach((registration) => registration.unregister())
      )
      .catch(() => {});
    return;
  }

  navigator.serviceWorker
    .register(`${BASE}sw.js`, { scope: BASE, updateViaCache: 'none' })
    .catch((error) => {
      // Not fatal: the app works online without it. Retried on the next sign-in.
      registered = false;
      console.warn('[SlidesVault] Offline shell unavailable', error);
    });
}
