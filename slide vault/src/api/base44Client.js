import { localClient } from './localClient';

/**
 * Resolves the backend the app talks to.
 *
 * - With VITE_BASE44_APP_ID set, the real @base44/sdk client is loaded and used,
 *   which talks to the deployed entities and the serverless functions in base44/.
 * - Without it, a local backend (localStorage + seeded catalog) is used so the
 *   app runs end to end on a laptop with no cloud account.
 *
 * The SDK is imported through a variable specifier so the bundle never requires
 * the package to be installed in local mode.
 */
const APP_ID = import.meta.env.VITE_BASE44_APP_ID;
const SDK_SPECIFIER = '@base44/sdk';

let clientPromise = null;

async function createRemoteClient() {
  const mod = await import(/* @vite-ignore */ SDK_SPECIFIER);
  const create = mod.createClient || mod.default?.createClient || mod.default;
  const client = create({
    appId: APP_ID,
    requiresAuth: true,
  });
  return { mode: 'base44', ...client };
}

export function getClientSync() {
  return localClient;
}

export async function getClient() {
  if (!APP_ID) return localClient;
  if (!clientPromise) {
    clientPromise = createRemoteClient().catch((err) => {
      // A missing/broken SDK must not take the whole app down — fall back loudly.
      console.error('[SlidesVault] Base44 SDK unavailable, falling back to local backend.', err);
      return localClient;
    });
  }
  return clientPromise;
}

export const isLocalMode = !APP_ID;

/** Proxies a named area of the client so callers can use it before it resolves. */
function lazyArea(area) {
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (key === 'then') return undefined;
        return new Proxy(
          {},
          {
            get(_t2, method) {
              if (method === 'then') return undefined;
              return async (...args) => {
                const client = await getClient();
                const target = client[area]?.[key];
                if (!target || typeof target[method] !== 'function') {
                  throw new Error(`${area}.${String(key)}.${String(method)} is not available`);
                }
                return target[method](...args);
              };
            },
          }
        );
      },
    }
  );
}

export const lazyEntities = lazyArea('entities');
