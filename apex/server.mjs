/**
 * The Apex gateway.
 *
 *   node apex/server.mjs          dev   — dashboard + reverse proxy to each child vite server
 *   node apex/server.mjs prod     prod  — dashboard + the built dist/ of each child
 *
 * Why a gateway at all: the Showcase, SlidesVault and the Academia are complete SPAs with
 * their own routers, auth and design systems. Merging their sources would mean
 * reconciling two incompatible Tailwind themes. Putting them behind one origin
 * instead gives one URL and one port while each app keeps its own bundle — so
 * their CSS and globals can never collide.
 *
 * Environment:
 *   APEX_PORT          the port (default 5173 dev, 4173 prod)
 *   APEX_HOST          the interface to listen on (default 127.0.0.1 — this machine only)
 *   APEX_PUBLIC_URL    the URL browsers use, when behind a reverse proxy (see projects.mjs)
 *   APEX_TRUST_PROXY   set when a reverse proxy in front sets X-Forwarded-For/-Proto/-Host;
 *                      the client address is then the left-most X-Forwarded-For
 *   APEX_SESSION_HOURS how long one sign-in lasts (default 12)
 *
 * Deliberately dependency-free (node: builtins only) so the shell needs no
 * node_modules of its own and start.bat has nothing to install for it.
 */
import http from 'node:http'
import net from 'node:net'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  GATEWAY_HOST,
  GATEWAY_PORT,
  PROD_PORT,
  PROJECTS,
  SESSION_HOURS,
  apiFor,
  gatewayUrl,
  localUrl,
  projectFor,
} from './projects.mjs'
import { API_PORTS, CHILD_PORTS, stopApex } from './stop.mjs'
import {
  clearFailures,
  forwardCookies,
  isLimited,
  noteFailure,
  safeNext,
  scopeSetCookie,
  sessionInfo,
  sessionOf,
  signIn,
  signOut,
} from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const PUBLIC = path.join(HERE, 'public')

const MODE = process.argv.includes('prod') ? 'prod' : 'dev'
const PORT = Number(process.env.APEX_PORT || (MODE === 'prod' ? PROD_PORT : GATEWAY_PORT))
const HOST = GATEWAY_HOST
const PUBLIC_ORIGIN = gatewayUrl(PORT)
const TRUST_PROXY = /^(1|true|yes|on)$/i.test(String(process.env.APEX_TRUST_PROXY || '').trim())

/** How long to wait for a child to accept a connection, and how long a quiet upstream may stay quiet. */
const CONNECT_TIMEOUT_MS = 10_000
const IDLE_TIMEOUT_MS = 120_000

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.pdf': 'application/pdf',
  '.map': 'application/json; charset=utf-8',
}

const typeOf = (file) => MIME[path.extname(file).toLowerCase()] || 'application/octet-stream'

/** True when `file` is `dir` itself or inside it — '/dist-old' is not inside '/dist'. */
const within = (dir, file) => file === dir || file.startsWith(dir.endsWith(path.sep) ? dir : dir + path.sep)

/** Sends a file, or returns false if it is not a readable file. */
function sendFile(res, file, { immutable = false } = {}) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return false
  }
  if (!stat.isFile()) return false

  res.writeHead(200, {
    'Content-Type': typeOf(file),
    'Content-Length': stat.size,
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(file).pipe(res)
  return true
}

function sendHtml(res, status, html) {
  const body = Buffer.from(html, 'utf8')
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

/** Text for an HTML page, escaped. */
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

/**
 * Shown when a child dev server is not accepting connections yet. start.bat
 * launches all three processes at once, so the dashboard is usually reachable a
 * second or two before vite has finished booting; this retries until it is,
 * rather than showing a browser connection error.
 */
function sendStarting(res, project) {
  sendHtml(
    res,
    503,
    [
      '<!doctype html><html lang="en"><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1">',
      `<title>Starting ${esc(project.name)}…</title>`,
      '<style>',
      ':root{color-scheme:dark}',
      'body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070c;color:#f4f4f9;',
      "font:500 15px/1.6 ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif}",
      '.spin{width:30px;height:30px;margin:0 auto 1.25rem;border-radius:50%;',
      'border:2px solid rgba(255,255,255,.14);border-top-color:#00f0ff;animation:s .7s linear infinite}',
      '@keyframes s{to{transform:rotate(360deg)}}',
      'p{color:#a1a1aa;font-size:13px;margin:.4rem 0 0}',
      '</style></head><body><div style="text-align:center;padding:2.5rem">',
      '<div class="spin"></div>',
      `<strong>Starting ${esc(project.name)}…</strong>`,
      `<p>Its dev server on port ${project.devPort} is still booting.</p>`,
      '<p>This page refreshes itself.</p>',
      '</div><script>setTimeout(function(){location.reload()},1500)</script></body></html>',
    ].join('')
  )
}

function sendNotFound(res, status = 404) {
  sendHtml(
    res,
    status,
    [
      `<!doctype html><meta charset="utf-8"><title>${status === 400 ? 'Bad request' : 'Not found'}</title>`,
      '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070c;',
      'color:#f4f4f9;font:500 15px ui-sans-serif,system-ui,sans-serif}a{color:#00f0ff}</style>',
      `<div style="text-align:center"><h1 style="font-size:2rem;margin:0 0 .5rem">${status}</h1>`,
      '<p style="color:#a1a1aa">Nothing is mounted here. <a href="/">Back to Apex</a></p></div>',
    ].join('')
  )
}

/* -------------------------------------------------------------- clients -- */

/**
 * The browser's address. The socket's peer, unless APEX_TRUST_PROXY says a
 * reverse proxy in front owns X-Forwarded-For — then its left-most entry,
 * which that proxy must set (overwrite, not append) from its own peer.
 */
function clientIp(req) {
  if (TRUST_PROXY) {
    const first = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim()
    if (first) return first
  }
  return req.socket.remoteAddress || ''
}

/** The scheme and host the browser used, as the apps should see them. */
function publicFace(req) {
  if (TRUST_PROXY) {
    const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
    const host = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim()
    return { proto: proto === 'https' ? 'https' : 'http', host: host || req.headers.host || '' }
  }
  return { proto: req.socket.encrypted ? 'https' : 'http', host: req.headers.host || '' }
}

/**
 * The headers a child sees: the browser's, minus any forwarding headers the
 * browser made up (they are set here, from what the gateway knows), minus
 * every session cookie that is not this project's own, with Host rewritten
 * to the child's port.
 */
const SPOOFABLE = ['forwarded', 'x-forwarded-for', 'x-forwarded-proto', 'x-forwarded-host', 'x-forwarded-port', 'x-real-ip']

function upstreamHeaders(req, project, port, { cookies = true } = {}) {
  const headers = { ...req.headers }
  for (const name of SPOOFABLE) delete headers[name]
  delete headers.cookie
  const cookie = cookies ? forwardCookies(req.headers.cookie, project.api?.sessionCookie) : ''
  if (cookie) headers.cookie = cookie
  const face = publicFace(req)
  return {
    ...headers,
    host: `127.0.0.1:${port}`,
    'x-forwarded-for': clientIp(req),
    'x-forwarded-proto': face.proto,
    'x-forwarded-host': face.host,
  }
}

/** A child's response headers, with its cookies moved under its own mount. */
function downstreamHeaders(up, project) {
  const headers = { ...up.headers }
  if (headers['set-cookie']) headers['set-cookie'] = headers['set-cookie'].map((c) => scopeSetCookie(c, project.base))
  return headers
}

/* ------------------------------------------------------------- forward ---- */

/**
 * Streams one request to a child (vite or an API) on 127.0.0.1:`port`.
 *
 * Bodies are piped, not buffered: this path carries whole presentations, and
 * Range requests for them, straight from the content proxies. Gives up when
 * the child will not accept a connection within CONNECT_TIMEOUT_MS or goes
 * quiet for IDLE_TIMEOUT_MS, and drops the upstream request as soon as the
 * browser goes away, so an abandoned download does not keep running.
 *
 * @param {(err: Error & { code?: string }) => void} onError  Answers the browser
 *   when the child could not be reached at all (nothing has been sent yet).
 */
function forward(req, res, { project, port, upstreamPath, cookies = true, onError }) {
  const upstream = http.request(
    { host: '127.0.0.1', port, method: req.method, path: upstreamPath, headers: upstreamHeaders(req, project, port, { cookies }) },
    (up) => {
      res.writeHead(up.statusCode || 502, downstreamHeaders(up, project))
      up.pipe(res)
      up.on('error', () => res.destroy())
    }
  )

  const fail = (code, message) => upstream.destroy(Object.assign(new Error(message), { code }))
  const connectTimer = setTimeout(() => fail('ETIMEDOUT', 'connect timeout'), CONNECT_TIMEOUT_MS)
  upstream.on('socket', (socket) => {
    // A kept-alive socket is already connected.
    if (!socket.connecting) clearTimeout(connectTimer)
    else socket.once('connect', () => clearTimeout(connectTimer))
  })
  upstream.setTimeout(IDLE_TIMEOUT_MS, () => fail('ETIMEDOUT', 'upstream went quiet'))

  upstream.on('error', (err) => {
    clearTimeout(connectTimer)
    if (res.headersSent || res.destroyed) return res.destroy()
    onError(err)
  })

  // The browser went away (closed the tab, cancelled a download).
  res.on('close', () => {
    clearTimeout(connectTimer)
    if (!res.writableFinished) upstream.destroy()
  })

  req.pipe(upstream)
}

/* ------------------------------------------------------------------ dev ---- */

/** Streams one request through to a child vite dev server. */
function proxy(req, res, project, target) {
  forward(req, res, {
    project,
    port: project.devPort,
    // The prefix is kept: the child runs with base '/showcase/' (or '/vault/')
    // and expects to see it, so nothing needs rewriting on either side.
    upstreamPath: target.forward,
    onError: (err) => {
      if (err.code === 'ECONNREFUSED') return sendStarting(res, project)
      sendHtml(res, 502, `<pre>Apex could not reach ${esc(project.name)}: ${esc(err.message)}</pre>`)
    },
  })
}

/**
 * Forwards a websocket upgrade (vite's HMR channel) by piping raw TCP. Each
 * child sets hmr.clientPort to the gateway port, so the browser only ever
 * talks to this one port.
 *
 * The request is re-written the way forward() does it — Host for the child,
 * only this project's cookie, forwarding headers from the gateway — and a
 * child that is not up yet gets a clean 503 rather than a dropped socket.
 */
function proxyUpgrade(req, socket, head, project, target) {
  const port = project.devPort
  const upstream = net.connect(port, '127.0.0.1')
  upstream.setTimeout(CONNECT_TIMEOUT_MS)
  upstream.once('timeout', () => upstream.destroy(Object.assign(new Error('connect timeout'), { code: 'ETIMEDOUT' })))

  let connected = false
  upstream.once('connect', () => {
    connected = true
    // Connected: a websocket may sit idle for as long as it likes.
    upstream.setTimeout(0)
    const headers = Object.entries(upstreamHeaders(req, project, port))
      .map(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`).join('\r\n') : `${k}: ${v}`))
      .join('\r\n')
    upstream.write(`${req.method} ${target.forward} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })

  upstream.on('error', () => {
    // Not up yet (or not answering): say so, the way a plain request gets the
    // retry page, and let vite's client reconnect on its own schedule.
    if (!connected) return refuseUpgrade(socket, 503, 'Service Unavailable')
    socket.destroy()
  })
  upstream.on('close', () => {
    if (connected) socket.destroy()
  })
  socket.on('error', () => upstream.destroy())
  socket.on('close', () => upstream.destroy())
}

/** Ends an upgrade request with a plain HTTP status, cleanly. */
function refuseUpgrade(socket, status, text) {
  if (socket.destroyed) return
  socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`)
}

/* ------------------------------------------------------------------ api ---- */

/**
 * Streams a request through to a project's own API server, in dev and prod.
 *
 * The mount is stripped — '/vault/api/auth/me' reaches the server as
 * '/api/auth/me' — so the API needs no idea it is mounted anywhere. What it
 * does need to know is the public URL it lives at, for the OAuth redirects it
 * issues; run.mjs passes that in (APP_BASE_URL, DROPBOX_REDIRECT_URI).
 */
function proxyApi(req, res, project, target, { cookies = true } = {}) {
  const { api } = project
  forward(req, res, {
    project,
    port: api.port,
    upstreamPath: target.forward.slice(project.base.length) || '/',
    cookies,
    onError: (err) => {
      // The client is fetch() expecting JSON, so answer in the API's own error
      // shape — the app then shows its normal "cannot reach the server" state.
      const starting = err.code === 'ECONNREFUSED'
      sendJson(res, starting ? 503 : 502, {
        error: starting
          ? `The ${project.name} API is not running yet (port ${api.port}). Give it a moment, or check its window.`
          : `Apex could not reach the ${project.name} API: ${err.message}`,
        code: starting ? 'API_STARTING' : 'API_UNREACHABLE',
        retryable: true,
      })
    },
  })
}

/* ----------------------------------------------------------------- prod ---- */

/** Serves a child's built dist/, falling back to its index.html for SPA routes. */
function serveBuilt(req, res, project, pathname) {
  // Each project builds inside its web app (apps/web/dist), not at its own root.
  const dist = path.join(ROOT, project.dir, project.webDir || '', 'dist')
  const index = path.join(dist, 'index.html')

  if (!fs.existsSync(index)) {
    return sendHtml(res, 503, `<pre>${esc(project.name)} has not been built yet.\n\nRun:  start.bat prod</pre>`)
  }

  const rel = pathname.slice(project.base.length).replace(/^\/+/, '')
  if (rel) {
    const file = path.join(dist, rel)
    // Keep traversal inside the project's own dist (and not a sibling such as dist-old).
    if (within(dist, file) && sendFile(res, file, { immutable: rel.startsWith('assets/') })) return
  }

  // An unknown path inside the mount belongs to the SPA router, not to a 404.
  sendFile(res, index)
}

/* --------------------------------------------------------------- sign-in -- */

/** Reachable without a session: the sign-in page and what it needs. */
const PUBLIC_PATHS = new Set([
  '/login',
  '/auth/login',
  '/auth/logout',
  '/auth/me',
  '/auth/config',
  '/logo.svg',
  '/favicon.ico',
])

/**
 * Exact project paths served without a session — today only the vault's web
 * manifest (see projects.mjs). GET/HEAD only, and never anything under an API.
 */
const PUBLIC_PROJECT_PATHS = new Set(
  PROJECTS.flatMap((p) => (p.publicPaths || []).filter((x) => projectFor(x) === p && !apiFor(x)))
)

/** The public certificate check: the page, and the one API call behind it. */
const VERIFY = PROJECTS.filter((p) => p.api?.publicVerify).map((p) => ({ project: p, ...p.api.publicVerify }))

function sendJson(res, status, body, headers = {}) {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  })
  res.end(text)
}

const redirect = (res, location, headers = {}) => {
  res.writeHead(302, { Location: location, 'Cache-Control': 'no-store', ...headers })
  res.end()
}

/** Reads a small JSON body; anything over 8 KB is not a sign-in form. */
function readJson(req) {
  return new Promise((resolve) => {
    let text = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      text += chunk
      if (text.length > 8192) req.destroy()
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

/** A page load, as opposed to a fetch or an asset — gets redirected rather than refused. */
const isNavigation = (req) =>
  req.method === 'GET' && (req.headers['sec-fetch-mode'] === 'navigate' || /text\/html/.test(req.headers.accept || ''))

/**
 * Every origin this gateway is legitimately reached at: its public URL
 * (APEX_PUBLIC_URL, so it works behind an https reverse proxy), the local
 * http://localhost:<port>, http://<the Host it was asked for>, and — when a
 * trusted proxy is in front — what that proxy says the browser used.
 */
function allowedOrigins(req) {
  const origins = new Set([PUBLIC_ORIGIN, localUrl(PORT)])
  if (req.headers.host) origins.add(`http://${req.headers.host}`)
  if (TRUST_PROXY) {
    const face = publicFace(req)
    if (face.host) origins.add(`${face.proto}://${face.host}`)
  }
  return origins
}

/**
 * True when a state-changing request demonstrably comes from a page of this
 * gateway: its Origin — or, failing that, its Referer — is one of ours. A
 * browser sends Origin on every POST, so a request with neither is refused.
 */
function sameOrigin(req) {
  const allowed = allowedOrigins(req)
  if (req.headers.origin) return allowed.has(req.headers.origin)
  try {
    return allowed.has(new URL(req.headers.referer).origin)
  } catch {
    return false
  }
}

/** What the sign-in page and the dashboard need to know about the platforms. */
const REGISTRY = {
  sessionHours: SESSION_HOURS,
  apps: PROJECTS.filter((p) => p.api?.sessionCookie).map((p) => ({
    id: p.id,
    name: p.name,
    base: p.base,
    health: p.api.health || null,
    logout: `${p.api.base}/auth/logout`,
  })),
}

async function handleAuth(req, res, pathname, url) {
  const ip = clientIp(req)

  if (pathname === '/login') {
    // An app whose own session has lapsed sends the browser here with
    // reauth=1. That shows the form even though the Apex session is still
    // good — otherwise it would bounce straight back to the app, and round
    // again — but signs nothing out: a GET must not, or any site could link
    // here and end every session. Signing in again refreshes them all.
    if (!url.searchParams.get('reauth') && sessionOf(req)) {
      return redirect(res, safeNext(url.searchParams.get('next') || '/'))
    }
    if (sendFile(res, path.join(PUBLIC, 'login.html'))) return
    return sendNotFound(res)
  }

  if (pathname === '/auth/config') return sendJson(res, 200, REGISTRY)

  if (pathname === '/auth/me') {
    const session = sessionInfo(req)
    return session
      ? sendJson(res, 200, { email: session.email, apps: session.apps })
      : sendJson(res, 401, { error: 'Not signed in.', code: 'APEX_SIGNIN_REQUIRED' })
  }

  if (pathname === '/auth/logout') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' }, { Allow: 'POST' })
    // Only a page of this gateway may sign a visitor out — not a link, an
    // image or a form on some other site.
    if (!sameOrigin(req)) return sendJson(res, 403, { error: 'Cross-origin sign-out refused.' })
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': await signOut(req, ip) })
  }

  if (pathname === '/auth/login') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' }, { Allow: 'POST' })
    // A browser always sends Origin on a cross-site POST; refuse one that is
    // not this gateway, so no other site can sign a visitor in as someone else.
    const origin = req.headers.origin
    if (origin && !allowedOrigins(req).has(origin)) {
      return sendJson(res, 403, { error: 'Cross-origin sign-in refused.' })
    }
    if (isLimited(ip)) {
      return sendJson(res, 429, { error: 'Too many failed attempts. Wait a few minutes and try again.' })
    }

    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) return sendJson(res, 400, { error: 'Enter your email address and password.' })

    const result = await signIn(email, password, { req, clientIp: ip })
    if (result.status !== 200) {
      if (result.status === 401) noteFailure(ip)
      return sendJson(res, result.status, { error: result.error })
    }
    clearFailures(ip)
    return sendJson(
      res,
      200,
      { ok: true, email, apps: result.apps, next: safeNext(body.next) },
      { 'Set-Cookie': result.cookies }
    )
  }

  return sendNotFound(res)
}

/* -------------------------------------------------------------- dispatch --- */

/**
 * Where a request is going, decided once.
 *
 * Routing looks at the decoded path ('/vault/library'); the child is sent the
 * normalised, still-encoded one (`forward`). The two must name the same mount
 * — a path such as '/%76ault/api/…' that only becomes '/vault/api/…' once
 * decoded is refused rather than routed one way and served another. Parsed
 * against a fixed origin, so '//host/x' stays a path and never becomes a host.
 *
 * @returns {{ url: URL, pathname: string, forward: string } | null}
 */
function targetOf(rawUrl) {
  if (typeof rawUrl !== 'string' || !rawUrl.startsWith('/')) return null
  let url
  let pathname
  try {
    url = new URL(`http://apex${rawUrl}`)
    pathname = decodeURI(url.pathname)
  } catch {
    return null
  }
  if (projectFor(pathname) !== projectFor(url.pathname) || apiFor(pathname) !== apiFor(url.pathname)) return null
  return { url, pathname, forward: `${url.pathname}${url.search}` }
}

/** The JSON a fetch() gets when it has no Apex session. */
const signInRequired = (res) => sendJson(res, 401, { error: 'Sign in to Apex first.', code: 'APEX_SIGNIN_REQUIRED' })

const server = http.createServer((req, res) => {
  const target = targetOf(req.url)
  if (!target) return sendNotFound(res, 400)
  const { url, pathname } = target

  if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === '/login' || pathname.startsWith('/auth/')) {
      return handleAuth(req, res, pathname, url).catch((err) => {
        console.error('  sign-in error:', err)
        if (!res.headersSent) sendJson(res, 500, { error: 'Sign-in failed. Try again.' })
      })
    }
    // The logo and favicon fall through to the static files below.
  } else if (PUBLIC_PROJECT_PATHS.has(pathname) && (req.method === 'GET' || req.method === 'HEAD')) {
    // A web-app manifest is fetched without cookies (the browser's default for
    // <link rel="manifest">); see publicPaths in projects.mjs.
  } else if (!sessionOf(req)) {
    // Signed out, a certificate's verification link still works: the gateway
    // answers it with its own page, backed by the one public API call.
    for (const v of VERIFY) {
      if (req.method === 'GET' && v.page.test(pathname)) {
        if (sendFile(res, path.join(PUBLIC, 'verify.html'))) return
        return sendNotFound(res)
      }
      if (pathname === v.api) {
        const json = /^application\/json\b/i.test(req.headers['content-type'] || '')
        if (req.method !== 'POST' || !json) return sendJson(res, 405, { error: 'POST JSON only.' }, { Allow: 'POST' })
        // No cookies at all: this call is anonymous by design.
        return proxyApi(req, res, v.project, target, { cookies: false })
      }
    }
    // Nothing else is reachable without the Apex sign-in — not the dashboard,
    // not any app, not their APIs.
    if (isNavigation(req)) return redirect(res, `/login?next=${encodeURIComponent(target.forward)}`)
    return signInRequired(res)
  }

  // Before projectFor(): '/vault/api' is inside the '/vault' mount, and must
  // reach the API server rather than the SPA.
  const apiProject = apiFor(pathname)
  if (apiProject) return proxyApi(req, res, apiProject, target)

  const project = projectFor(pathname)

  if (project) {
    // '/showcase' must become '/showcase/' before the child sees it, or every
    // relative asset it emits resolves one level too high.
    if (pathname === project.base) return redirect(res, `${project.base}/${url.search}`)
    return MODE === 'dev' ? proxy(req, res, project, target) : serveBuilt(req, res, project, pathname)
  }

  if (pathname === '/') {
    if (sendFile(res, path.join(PUBLIC, 'index.html'))) return
    return sendNotFound(res)
  }

  const asset = path.join(PUBLIC, pathname.replace(/^\/+/, ''))
  if (within(PUBLIC, asset) && sendFile(res, asset)) return

  sendNotFound(res)
})

/**
 * Websocket upgrades: vite's HMR channel, in dev. They need the Apex session
 * like everything else, and are routed by the same rules as plain requests.
 */
server.on('upgrade', (req, socket, head) => {
  socket.on('error', () => socket.destroy())
  const target = targetOf(req.url)
  if (!target) return refuseUpgrade(socket, 400, 'Bad Request')
  if (!sessionOf(req)) return refuseUpgrade(socket, 401, 'Unauthorized')
  // No API speaks websockets; only the dev servers do.
  const project = apiFor(target.pathname) ? null : projectFor(target.pathname)
  if (MODE === 'dev' && project) return proxyUpgrade(req, socket, head, project, target)
  refuseUpgrade(socket, 404, 'Not Found')
})

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} is already in use. Run stop.bat first.\n`)
    process.exit(1)
  }
  throw err
})

/**
 * Answers whether something is already serving on a port.
 *
 * Binding is not a reliable test on Windows: libuv sets SO_REUSEADDR, so a
 * second listen on a port another process already holds *succeeds*, and the two
 * servers then split the incoming connections. That is how a stale dev server
 * left over on this port ends up answering half of Apex's requests, with no
 * EADDRINUSE anywhere. Connecting as a client is unambiguous.
 */
function portInUse(port, host) {
  return new Promise((resolve) => {
    const probe = net.connect({ port, host })
    const settle = (taken) => {
      probe.destroy()
      resolve(taken)
    }
    probe.setTimeout(500)
    probe.on('connect', () => settle(true))
    probe.on('timeout', () => settle(false))
    probe.on('error', () => settle(false))
  })
}

// A wildcard listen collides with anything on loopback; a specific address with what is on it.
const probeHost = HOST === '0.0.0.0' || HOST === '::' ? '127.0.0.1' : HOST
if ((await portInUse(PORT, probeHost)) || (probeHost !== '127.0.0.1' && (await portInUse(PORT, '127.0.0.1')))) {
  console.error(`\n  Port ${PORT} is already serving something else.`)
  console.error('  Run stop.bat, then start Apex again.\n')
  process.exit(1)
}

server.listen(PORT, HOST, () => {
  const url = localUrl(PORT)
  console.log('')
  console.log(`  Apex gateway  ·  ${MODE}`)
  console.log(`  ${'-'.repeat(52)}`)
  console.log(`  dashboard    ${url}/`)
  if (PUBLIC_ORIGIN !== url) console.log(`  public url   ${PUBLIC_ORIGIN}/`)
  console.log(`  listening on ${HOST}:${PORT}${TRUST_PROXY ? '  (trusting X-Forwarded-* from the proxy in front)' : ''}`)
  for (const p of PROJECTS) {
    const from = MODE === 'dev' ? `vite :${p.devPort}` : `${p.dir}/dist`
    console.log(`  ${p.base.slice(1).padEnd(12)} ${url}${p.base}/  <- ${from}`)
    if (p.api) console.log(`  ${''.padEnd(12)} ${url}${p.api.base}/  <- api :${p.api.port}`)
  }
  console.log('')

  // Opened from here rather than from start.bat: this is the first moment the
  // dashboard can actually answer, so the browser never races the listen and
  // lands on a connection error.
  if (process.argv.includes('--open')) {
    spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref()
  }
})

/*
 * When the gateway goes, the child servers (vite, and the vault API) go with it.
 *
 * start.bat launches them in their own windows, so without this they outlive a
 * Ctrl+C here and keep holding 5174/5175. The visible symptom is nasty: the
 * browser gets ERR_CONNECTION_REFUSED on 5173 because nothing is listening
 * there any more, while the next start.bat refuses to run because those two
 * ports are taken — by our own orphans.
 *
 * Windows does not reliably deliver a signal when a console window is closed
 * outright, so this cannot be the only defence; start.bat clears leftovers on
 * the way up too. This just keeps the common exits tidy.
 */
let shuttingDown = false

function shutdown(signal) {
  if (shuttingDown) return
  shuttingDown = true

  // The API servers run in prod too, so they are stopped in both modes; the
  // vite dev servers exist only in dev.
  {
    const { stopped } = stopApex(MODE === 'dev' ? CHILD_PORTS : API_PORTS, { exclude: [process.pid] })
    if (stopped.length) console.log(`\n  Stopped ${stopped.length} server(s).`)
  }

  console.log('')
  // 128 + signal number is the conventional exit code for a signalled process.
  process.exit(signal === 'SIGINT' ? 130 : 0)
}

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  process.on(signal, () => shutdown(signal))
}
