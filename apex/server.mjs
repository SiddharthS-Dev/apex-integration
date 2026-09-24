/**
 * The Apex gateway.
 *
 *   node apex/server.mjs          dev   — dashboard + reverse proxy to each child vite server
 *   node apex/server.mjs prod     prod  — dashboard + the built dist/ of each child
 *
 * Why a gateway at all: the Showcase and SlidesVault are two complete SPAs with
 * their own routers, auth and design systems. Merging their sources would mean
 * reconciling two incompatible Tailwind themes. Putting them behind one origin
 * instead gives one URL and one port while each app keeps its own bundle — so
 * their CSS and globals can never collide.
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
import { GATEWAY_PORT, PROD_PORT, PROJECTS, apiFor, projectFor } from './projects.mjs'
import { API_PORTS, CHILD_PORTS, stopApex } from './stop.mjs'
import { clearFailures, isLimited, noteFailure, safeNext, sessionOf, signIn, signOut } from './auth.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.dirname(HERE)
const PUBLIC = path.join(HERE, 'public')

const MODE = process.argv.includes('prod') ? 'prod' : 'dev'
const PORT = Number(process.env.APEX_PORT || (MODE === 'prod' ? PROD_PORT : GATEWAY_PORT))

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
      `<title>Starting ${project.name}…</title>`,
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
      `<strong>Starting ${project.name}…</strong>`,
      `<p>Its dev server on port ${project.devPort} is still booting.</p>`,
      '<p>This page refreshes itself.</p>',
      '</div><script>setTimeout(function(){location.reload()},1500)</script></body></html>',
    ].join('')
  )
}

function sendNotFound(res) {
  sendHtml(
    res,
    404,
    [
      '<!doctype html><meta charset="utf-8"><title>Not found</title>',
      '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070c;',
      'color:#f4f4f9;font:500 15px ui-sans-serif,system-ui,sans-serif}a{color:#00f0ff}</style>',
      '<div style="text-align:center"><h1 style="font-size:2rem;margin:0 0 .5rem">404</h1>',
      '<p style="color:#a1a1aa">Nothing is mounted here. <a href="/">Back to Apex</a></p></div>',
    ].join('')
  )
}

/* ------------------------------------------------------------------ dev ---- */

/** Streams one request through to a child vite dev server, untouched. */
function proxy(req, res, project) {
  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: project.devPort,
      method: req.method,
      // The prefix is kept: the child runs with base '/showcase/' (or '/vault/')
      // and expects to see it, so nothing needs rewriting on either side.
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${project.devPort}` },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )

  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy()
    if (err.code === 'ECONNREFUSED') return sendStarting(res, project)
    sendHtml(res, 502, `<pre>Apex could not reach ${project.name}: ${err.message}</pre>`)
  })

  req.pipe(upstream)
}

/**
 * Forwards a websocket upgrade (vite's HMR channel) by piping raw TCP. Each
 * child sets hmr.clientPort to the gateway port, so the browser only ever
 * talks to this one port.
 */
function proxyUpgrade(req, socket, head, project) {
  const upstream = net.connect(project.devPort, '127.0.0.1', () => {
    const headers = Object.entries(req.headers)
      .map(([k, v]) => (Array.isArray(v) ? v.map((x) => `${k}: ${x}`).join('\r\n') : `${k}: ${v}`))
      .join('\r\n')
    upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`)
    if (head?.length) upstream.write(head)
    socket.pipe(upstream)
    upstream.pipe(socket)
  })
  upstream.on('error', () => socket.destroy())
  socket.on('error', () => upstream.destroy())
}

/* ------------------------------------------------------------------ api ---- */

/**
 * Streams a request through to a project's own API server, in dev and prod.
 *
 * The mount is stripped — '/vault/api/auth/me' reaches the server as
 * '/api/auth/me' — so the API needs no idea it is mounted anywhere. What it
 * does need to know is the public URL it lives at, for the OAuth redirects it
 * issues; start.bat passes that in (APP_BASE_URL, DROPBOX_REDIRECT_URI).
 *
 * Bodies are piped, not buffered: this path carries whole presentations, and
 * Range requests for them, straight from the content proxy.
 */
function proxyApi(req, res, project) {
  const { api } = project
  const upstreamPath = req.url.slice(project.base.length) || '/'

  const upstream = http.request(
    {
      host: '127.0.0.1',
      port: api.port,
      method: req.method,
      path: upstreamPath,
      headers: {
        ...req.headers,
        host: `127.0.0.1:${api.port}`,
        'x-forwarded-host': req.headers.host || '',
        'x-forwarded-proto': 'http',
        'x-forwarded-for': req.socket.remoteAddress || '',
      },
    },
    (up) => {
      res.writeHead(up.statusCode || 502, up.headers)
      up.pipe(res)
    }
  )

  upstream.on('error', (err) => {
    if (res.headersSent) return res.destroy()
    // The client is fetch() expecting JSON, so answer in the API's own error
    // shape — the app then shows its normal "cannot reach the server" state.
    const starting = err.code === 'ECONNREFUSED'
    const body = JSON.stringify({
      error: starting
        ? `The ${project.name} API is not running yet (port ${api.port}). Give it a moment, or check its window.`
        : `Apex could not reach the ${project.name} API: ${err.message}`,
      code: starting ? 'API_STARTING' : 'API_UNREACHABLE',
      retryable: true,
    })
    res.writeHead(starting ? 503 : 502, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
    })
    res.end(body)
  })

  req.on('aborted', () => upstream.destroy())
  req.pipe(upstream)
}

/* ----------------------------------------------------------------- prod ---- */

/** Serves a child's built dist/, falling back to its index.html for SPA routes. */
function serveBuilt(req, res, project, pathname) {
  const dist = path.join(ROOT, project.dir, 'dist')
  const index = path.join(dist, 'index.html')

  if (!fs.existsSync(index)) {
    return sendHtml(res, 503, `<pre>${project.name} has not been built yet.\n\nRun:  start.bat prod</pre>`)
  }

  const rel = pathname.slice(project.base.length).replace(/^\/+/, '')
  if (rel) {
    const file = path.join(dist, rel)
    // Keep traversal inside the project's own dist.
    if (file.startsWith(dist) && sendFile(res, file, { immutable: rel.startsWith('assets/') })) return
  }

  // An unknown path inside the mount belongs to the SPA router, not to a 404.
  sendFile(res, index)
}

/* -------------------------------------------------------------- dispatch --- */

/* --------------------------------------------------------------- sign-in -- */

/** Reachable without a session: the sign-in page and what it needs. */
const PUBLIC_PATHS = new Set(['/login', '/auth/login', '/auth/logout', '/auth/me', '/logo.svg', '/favicon.ico'])

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

async function handleAuth(req, res, pathname, url) {
  const ip = req.socket.remoteAddress || ''

  if (pathname === '/login') {
    // An app whose own session has lapsed sends the browser here with
    // reauth=1. Everything is signed out first, so the form that follows
    // issues all the sessions afresh — otherwise the still-valid Apex cookie
    // would bounce straight back to the app, and round again.
    if (url.searchParams.get('reauth')) {
      const cleared = await signOut(req)
      const next = safeNext(url.searchParams.get('next') || '/')
      return redirect(res, `/login?next=${encodeURIComponent(next)}&expired=1`, { 'Set-Cookie': cleared })
    }
    if (sessionOf(req)) return redirect(res, safeNext(url.searchParams.get('next') || '/'))
    if (sendFile(res, path.join(PUBLIC, 'login.html'))) return
    return sendNotFound(res)
  }

  if (pathname === '/auth/me') {
    const email = sessionOf(req)
    return email ? sendJson(res, 200, { email }) : sendJson(res, 401, { error: 'Not signed in.' })
  }

  if (pathname === '/auth/logout') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' })
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': await signOut(req) })
  }

  if (pathname === '/auth/login') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Use POST.' })
    // A browser always sends Origin on a cross-site POST; refuse one that is
    // not this gateway, so no other site can sign a visitor in or out.
    const origin = req.headers.origin
    if (origin && origin !== `http://${req.headers.host}`) {
      return sendJson(res, 403, { error: 'Cross-origin sign-in refused.' })
    }
    if (isLimited(ip)) {
      return sendJson(res, 429, { error: 'Too many failed attempts. Wait a few minutes and try again.' })
    }

    const body = await readJson(req)
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    const password = typeof body.password === 'string' ? body.password : ''
    if (!email || !password) return sendJson(res, 400, { error: 'Enter your email address and password.' })

    const result = await signIn(email, password, req)
    if (result.status !== 200) {
      if (result.status === 401) noteFailure(ip)
      return sendJson(res, result.status, { error: result.error })
    }
    clearFailures(ip)
    return sendJson(res, 200, { ok: true, email, next: safeNext(body.next) }, { 'Set-Cookie': result.cookies })
  }

  return sendNotFound(res)
}

/* -------------------------------------------------------------- dispatch --- */

const server = http.createServer((req, res) => {
  let pathname
  let url
  try {
    url = new URL(req.url, 'http://localhost')
    pathname = decodeURI(url.pathname)
  } catch {
    return sendNotFound(res)
  }

  // A web-app manifest is fetched without cookies (the browser's default for
  // <link rel="manifest">), and holds nothing but a name and an icon.
  const isManifest = pathname.endsWith('.webmanifest')

  if (isManifest) {
    // falls through to the project it belongs to, unauthenticated
  } else if (PUBLIC_PATHS.has(pathname)) {
    if (pathname === '/login' || pathname.startsWith('/auth/')) {
      return handleAuth(req, res, pathname, url).catch((err) => {
        console.error('  sign-in error:', err)
        if (!res.headersSent) sendJson(res, 500, { error: 'Sign-in failed. Try again.' })
      })
    }
  } else if (!sessionOf(req)) {
    // Nothing else is reachable without the Apex sign-in — not the dashboard,
    // not either app, not their APIs.
    if (isNavigation(req)) return redirect(res, `/login?next=${encodeURIComponent(req.url)}`)
    return sendJson(res, 401, { error: 'Sign in to Apex first.', code: 'APEX_SIGNIN_REQUIRED' })
  }

  // Before projectFor(): '/vault/api' is inside the '/vault' mount, and must
  // reach the API server rather than the SPA.
  const apiProject = apiFor(pathname)
  if (apiProject) return proxyApi(req, res, apiProject)

  const project = projectFor(pathname)

  if (project) {
    // '/showcase' must become '/showcase/' before the child sees it, or every
    // relative asset it emits resolves one level too high.
    if (pathname === project.base) {
      res.writeHead(302, { Location: `${project.base}/`, 'Cache-Control': 'no-store' })
      return res.end()
    }
    return MODE === 'dev' ? proxy(req, res, project) : serveBuilt(req, res, project, pathname)
  }

  if (pathname === '/') {
    if (sendFile(res, path.join(PUBLIC, 'index.html'))) return
    return sendNotFound(res)
  }

  const asset = path.join(PUBLIC, pathname.replace(/^\/+/, ''))
  if (asset.startsWith(PUBLIC) && sendFile(res, asset)) return

  sendNotFound(res)
})

server.on('upgrade', (req, socket, head) => {
  const pathname = new URL(req.url, 'http://localhost').pathname
  const project = projectFor(pathname)
  if (MODE === 'dev' && project) return proxyUpgrade(req, socket, head, project)
  socket.destroy()
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
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = net.connect({ port, host: '127.0.0.1' })
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

if (await portInUse(PORT)) {
  console.error(`\n  Port ${PORT} is already serving something else.`)
  console.error('  Run stop.bat, then start Apex again.\n')
  process.exit(1)
}

server.listen(PORT, () => {
  const url = `http://localhost:${PORT}`
  console.log('')
  console.log(`  Apex gateway  ·  ${MODE}`)
  console.log(`  ${'-'.repeat(52)}`)
  console.log(`  dashboard    ${url}/`)
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
