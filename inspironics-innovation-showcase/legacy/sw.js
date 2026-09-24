/* Inspironics Innovation Showcase — service worker
   Provides offline caching when the site is served over http/https.
   (Service workers do not run from file:// — the page registers this only when hosted.) */
const CACHE = 'inspironics-showcase-v1';
const CORE = ['./', './index.html', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // cache-first for images (thumbs/full/originals), network-first for the rest
  if (/\.(webp|jpg|jpeg|png|svg)$/i.test(new URL(req.url).pathname)) {
    e.respondWith(
      caches.open(CACHE).then(c =>
        c.match(req).then(hit => hit || fetch(req).then(res => { c.put(req, res.clone()); return res; }).catch(() => hit))
      )
    );
  } else {
    e.respondWith(
      fetch(req).then(res => { const cp = res.clone(); caches.open(CACHE).then(c => c.put(req, cp)); return res; })
        .catch(() => caches.match(req))
    );
  }
});
