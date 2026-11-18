import { localClient } from './localClient';
import { apiClient, isApiMode } from './apiClient';

/**
 * Resolves the backend the app talks to.
 *
 * - With VITE_API_BASE_URL set, the SlidesVault API server (`apps/api`) is used: its own session
 *   auth, the synced catalog, and all Dropbox traffic proxied through the backend. Under Apex this is
 *   always the case.
 * - With VITE_DEMO_MODE=true (and no API URL), a local backend (localStorage + a seeded demo
 *   catalog) is used so the app runs end to end on a laptop with no server.
 *
 * The demo backend is opt-in, never a fallback: a build with no backend configured reports the
 * problem instead of quietly serving seeded demo data and demo accounts.
 *
 * Both backends expose the same shape, so no page or hook knows which one is in play.
 */
const DEMO = /^(1|true|yes)$/i.test(String(import.meta.env.VITE_DEMO_MODE ?? '').trim());

export const isLocalMode = !isApiMode && DEMO;
export { isApiMode };

/** 'api' | 'local' | 'none' — for the few places that must adapt. */
export const backendMode = isApiMode ? 'api' : isLocalMode ? 'local' : 'none';

/** The error every caller sees when there is no usable backend. */
function backendUnavailable(message) {
  const error = new Error(message);
  error.code = 'BACKEND_UNAVAILABLE';
  return error;
}

export async function getClient() {
  if (isApiMode) return apiClient;
  if (isLocalMode) return localClient;
  throw backendUnavailable(
    'No backend is configured for this build. Set VITE_API_BASE_URL (the SlidesVault API) or VITE_DEMO_MODE=true for the local demo.'
  );
}

/** The synchronously-known client, or null when none is configured. */
export function getClientSync() {
  if (isApiMode) return apiClient;
  return isLocalMode ? localClient : null;
}
