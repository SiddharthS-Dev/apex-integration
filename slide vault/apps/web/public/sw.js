/**
 * SlidesVault service worker — the app shell, offline.
 *
 * The offline library keeps decks in IndexedDB, but without this the app
 * itself (index.html and its scripts) cannot load with no network, so those
 * downloads are unreachable exactly when they are needed.
 *
 * What it caches, and what it never touches:
 *   - Navigations: network first, so a deploy is picked up on the next load;
 *     the cached index.html is only the fallback when the network fails. It can
 *     therefore never pin an old build in place.
 *   - Built assets (/assets/*, hashed names): cache first — a hashed file
 *     never changes. The full list comes from precache-manifest.json, written
 *     by the build, so route chunks never visited online still work offline.
 *   - The API (<scope>api/…), auth, anything cross-origin and anything that
 *     is not a GET: never intercepted, never cached. Session-bound responses
 *     and presentation bytes do not belong in a cache shared by whoever uses
 *     this browser next.
 *
 * Scope is the folder this script is served from — /vault/ under Apex — so
 * every path below is relative to it.
 */
const VERSION = 'v1';
const CACHE = `slidesvault-shell-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const INDEX_URL = new URL('index.html', SCOPE).href;
const MANIFEST_URL = new URL('precache-manifest.json', SCOPE).href;
const API_PREFIX = new URL('api/', SCOPE).pathname;
const REFRESH_EVERY_MS = 60 * 60 * 1000;

let lastRefresh = 0;

/** Brings the cache in line with the build currently deployed. */
async function refreshPrecache() {
  lastRefresh = Date.now();
  const response = await fetch(MANIFEST_URL, { cache: 'no-store', credentials: 'same-origin' });
  if (!response.ok) return;
  const files = await response.json();
  if (!Array.isArray(files)) return;

  const wanted = new Set(files.map((file) => new URL(file, SCOPE).href));
  wanted.add(INDEX_URL);
  const cache = await caches.open(CACHE);

  for (const url of wanted) {
    if (await cache.match(url)) continue;
    try {
      const fresh = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
      if (fresh.ok && !fresh.redirected) await cache.put(url, fresh);
    } catch {
      // One missing file must not abort the rest; it is fetched on demand.
    }
  }
  // Files from builds that are no longer deployed.
  for (const request of await cache.keys()) {
    if (!wanted.has(request.url) && request.url !== INDEX_URL) await cache.delete(request);
  }
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const index = await fetch(INDEX_URL, { cache: 'no-cache', credentials: 'same-origin' });
        if (index.ok && !index.redirected) await cache.put(INDEX_URL, index);
      } catch {
        /* offline at install: the first online navigation fills it in */
      }
      await refreshPrecache().catch(() => {});
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith('slidesvault-shell-') && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })()
  );
});

/** Requests this worker leaves to the network, untouched. */
function bypass(request, url) {
  if (request.method !== 'GET') return true;
  if (url.origin !== self.location.origin) return true;
  if (!url.pathname.startsWith(SCOPE.pathname)) return true;
  if (url.pathname.startsWith(API_PREFIX)) return true;
  if (request.headers.has('range')) return true;
  return false;
}

async function navigate(request) {
  try {
    const response = await fetch(request);
    // A good page of ours refreshes the cached shell. A redirect (the gateway
    // sending a signed-out browser to its sign-in page) or an error is passed
    // through, never cached.
    if (response.ok && !response.redirected && (response.headers.get('content-type') || '').includes('text/html')) {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(INDEX_URL, copy)).catch(() => {});
      if (Date.now() - lastRefresh > REFRESH_EVERY_MS) refreshPrecache().catch(() => {});
    }
    return response;
  } catch (error) {
    const cached = await caches.match(INDEX_URL);
    if (cached) return cached;
    throw error;
  }
}

async function asset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  // Only hashed build output is immutable enough to keep without asking again.
  if (response.ok && !response.redirected && new URL(request.url).pathname.includes('/assets/')) {
    const copy = response.clone();
    caches.open(CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (bypass(request, url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(navigate(request));
    return;
  }
  event.respondWith(asset(request));
});
