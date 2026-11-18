/**
 * The offline service worker: what the build emits, how the worker routes
 * requests (run in a sandbox with fake caches and fetch), and that the page
 * registers it only in production, under the app's base path.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import vm from 'node:vm'
import { serviceWorkerPlugin, serviceWorkerSource } from '../scripts/serviceWorker.mjs'
import { installBrowserStubs } from './helpers.mjs'

installBrowserStubs()
const { registerServiceWorker } = await import('../src/shared/lib/registerServiceWorker.js')

const ORIGIN = 'http://gw.local'

/** Boot the generated worker in a sandbox; returns a `dispatch(url, init)` that resolves to the response, or null if not intercepted. */
function bootWorker(source, { online }) {
  const listeners = {}
  const store = new Map() // cacheName -> Map(url -> body)
  const keyOf = (r) => (typeof r === 'string' ? new URL(r, ORIGIN).href : r.url)
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map())
    const m = store.get(name)
    return {
      addAll: async (urls) => urls.forEach((u) => m.set(keyOf(u), `cached:${u}`)),
      put: async (req, res) => m.set(keyOf(req), `cached-api:${await res.text()}`),
    }
  }
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (n) => store.delete(n),
    match: async (req, { cacheName } = {}) => {
      const body = store.get(cacheName)?.get(keyOf(req))
      return body === undefined ? undefined : new Response(body)
    },
  }
  const fetch = async (req) => {
    if (!online) throw new TypeError('Failed to fetch')
    const url = keyOf(req)
    return new Response(`net:${url}`, { headers: { 'content-type': url.includes('/api/') ? 'application/json' : 'text/plain' } })
  }
  const self = {
    location: new URL(`${ORIGIN}/showcase/sw.js`),
    addEventListener: (type, fn) => (listeners[type] = fn),
    skipWaiting: async () => {},
    clients: { claim: async () => {} },
  }
  vm.runInNewContext(source, { self, caches, fetch, URL, Response, Promise, console })
  const lifecycle = async (type, data) => {
    let wait
    listeners[type]({ data, waitUntil: (p) => (wait = p) })
    await wait
  }
  const dispatch = async (url, { mode = 'cors', method = 'GET' } = {}) => {
    let responded = null
    listeners.fetch({ request: { url: new URL(url, ORIGIN).href, mode, method }, respondWith: (p) => (responded = p) })
    if (!responded) return null
    const res = await responded
    return res.text()
  }
  return { lifecycle, dispatch, store, setOnline: (v) => (online = v) }
}

const SOURCE = serviceWorkerSource({ base: '/showcase/', precache: ['index.html', 'assets/index-abc.js', 'assets/index-abc.js', 'favicon.svg'], version: 'v1' })

test('the generated worker precaches the shell under the base path', async () => {
  assert.match(SOURCE, /"\/showcase\/assets\/index-abc\.js"/)
  const w = bootWorker(SOURCE, { online: true })
  await w.lifecycle('install')
  assert.deepEqual([...w.store.get('insp-shell-v1').keys()], [`${ORIGIN}/showcase/index.html`, `${ORIGIN}/showcase/assets/index-abc.js`, `${ORIGIN}/showcase/favicon.svg`])
})

test('offline: navigations get the cached index.html, assets come from the cache, API answers are replayed', async () => {
  const w = bootWorker(SOURCE, { online: true })
  await w.lifecycle('install')
  assert.equal(await w.dispatch('/showcase/api/entities/plates'), `net:${ORIGIN}/showcase/api/entities/plates`)
  await new Promise((r) => setTimeout(r, 0)) // the cache write is fire-and-forget

  w.setOnline(false)
  assert.equal(await w.dispatch('/showcase/offline', { mode: 'navigate' }), 'cached:/showcase/index.html')
  assert.equal(await w.dispatch('/showcase/assets/index-abc.js'), 'cached:/showcase/assets/index-abc.js')
  assert.equal(await w.dispatch('/showcase/api/entities/plates'), `cached-api:net:${ORIGIN}/showcase/api/entities/plates`)

  // sign-out clears the kept API answers
  await w.lifecycle('message', { type: 'clear-api-cache' })
  await assert.rejects(w.dispatch('/showcase/api/entities/plates'))
})

test('the worker leaves alone: auth, writes, other apps and other origins', async () => {
  const w = bootWorker(SOURCE, { online: true })
  assert.equal(await w.dispatch('/showcase/api/auth/session'), null)
  assert.equal(await w.dispatch('/showcase/api/entities/plates/x/events', { method: 'POST' }), null)
  assert.equal(await w.dispatch('/academia/', { mode: 'navigate' }), null)
  assert.equal(await w.dispatch('https://fonts.googleapis.com/css2'), null)
})

test('the Vite plugin emits sw.js listing built JS/CSS/HTML, never the image library', () => {
  const plugin = serviceWorkerPlugin()
  plugin.configResolved({ base: '/showcase/' })
  const emitted = []
  plugin.generateBundle.call({ emitFile: (f) => emitted.push(f) }, {}, {
    'index.html': {},
    'assets/index-1.js': {},
    'assets/index-1.css': {},
    'assets/hero-2.webp': {},
    'images/full/a.svg': {},
  })
  assert.equal(emitted.length, 1)
  assert.equal(emitted[0].fileName, 'sw.js')
  const src = emitted[0].source
  for (const f of ['index.html', 'assets/index-1.js', 'assets/index-1.css', 'favicon.svg', 'manifest.webmanifest']) assert.ok(src.includes(`"/showcase/${f}"`), f)
  assert.ok(!src.includes('hero-2.webp') && !src.includes('images/full'))
})

test('the page registers the worker only in production, at the base path', () => {
  const calls = []
  const nav = { serviceWorker: { register: (url, opts) => (calls.push([url, opts]), Promise.resolve()) } }
  const win = { document: { readyState: 'complete' }, addEventListener() {} }
  assert.equal(registerServiceWorker({ base: '/showcase/', enabled: false, nav, win }), false)
  assert.equal(calls.length, 0)
  assert.equal(registerServiceWorker({ base: '/showcase/', enabled: true, nav, win }), true)
  assert.deepEqual(calls, [['/showcase/sw.js', { scope: '/showcase/' }]])
  assert.equal(registerServiceWorker({ base: '/', enabled: true, nav: {}, win }), false, 'no service worker support: nothing happens')
})
