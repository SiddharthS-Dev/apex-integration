/**
 * APEX Enterprise Onboarding application (Use Case 007, Phase 3), separate from the portal.
 *
 *   cd onboarding && npm run dev        ->  http://localhost:5180
 *
 * Shared backend: the onboarding steps are relayed to the portal's own Academia Core API (default
 * 127.0.0.1:4177), which stores them in its existing registration_requests table (migration 011). This
 * server starts no API, opens no database, and has no sign-in of its own: existing users are sent to
 * the portal's sign-in page, and approved applicants receive the portal's existing invitation
 * (set-password) email. The portal's files, ports and processes are not touched; this app refuses the
 * portal's ports for itself and never falls back to another port.
 *
 * Routes (same origin, so no CORS is involved):
 *   GET  /, /join                 the Enterprise Onboarding Assistant (hashed-script CSP, no referrer, no cache)
 *   GET  /app-config.json         the portal's sign-in address for the page (no secrets)
 *   GET  /logo.svg                the APEX mark
 *   *    /auth/onboarding/<step>  relayed to the Core (relay.mjs); resume token in an HttpOnly cookie
 *
 * Writes are same-origin and JSON-only. Request bodies are never logged. Dependency-free.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ONBOARDING_COOKIE, ONBOARDING_PREFIX, bodyLimitFor, createOnboarding, stepOf } from './relay.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PUBLIC = path.join(HERE, 'public')
const LOGO = path.join(HERE, '..', 'apex', 'public', 'logo.svg')

/** The portal's own ports (start.bat, apex/projects.mjs). The onboarding page never listens on one. */
export const PORTAL_PORTS = Object.freeze([5173, 5174, 5175, 5176, 4173, 4175, 4176, 4177])

export function settings(env = process.env) {
  const port = Number(env.ONBOARDING_PORT || 5180)
  const corePort = Number(env.ONBOARDING_CORE_PORT || 4177)
  const problems = []
  if (!Number.isInteger(port) || port < 1024 || port > 65535) problems.push('ONBOARDING_PORT must be a port number')
  else if (PORTAL_PORTS.includes(port)) problems.push(`ONBOARDING_PORT=${port} belongs to the portal; choose another (default 5180)`)
  if (!Number.isInteger(corePort) || corePort < 1 || corePort > 65535) problems.push('ONBOARDING_CORE_PORT must be a port number')
  if (port === corePort) problems.push('ONBOARDING_PORT and ONBOARDING_CORE_PORT must differ')
  const publicUrl = (env.ONBOARDING_PUBLIC_URL || `http://localhost:${port}`).replace(/\/+$/, '')
  const portalUrl = (env.ONBOARDING_PORTAL_URL || 'http://localhost:5173').replace(/\/+$/, '')
  if (!/^https?:\/\/[^/\s]+$/i.test(portalUrl)) problems.push('ONBOARDING_PORTAL_URL must be an origin such as http://localhost:5173')
  return { port, corePort, host: env.ONBOARDING_HOST || '127.0.0.1', publicUrl, portalUrl, problems }
}

/* --------------------------------------------------------------- helpers -- */

const json = (res, status, body, headers = {}) => {
  const text = JSON.stringify(body)
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(text), 'Cache-Control': 'no-store', ...headers })
  res.end(text)
}

/** The page's CSP: its inline scripts by hash (CRLF-normalised as the browser hashes them); nothing from another origin. */
const cspCache = new Map()
export function pageCsp(file) {
  const stat = fs.statSync(file)
  const hit = cspCache.get(file)
  if (hit && hit.mtimeMs === stat.mtimeMs) return hit.value
  const html = fs.readFileSync(file, 'utf8')
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(
    (m) => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`
  )
  const value = [
    "default-src 'self'",
    `script-src 'self' ${hashes.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join('; ')
  cspCache.set(file, { mtimeMs: stat.mtimeMs, value })
  return value
}

function sendFile(res, file, type, headers) {
  let body
  try {
    body = fs.readFileSync(file)
  } catch {
    return json(res, 404, { error: 'Not found.' })
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff', ...headers })
  res.end(body)
}

function readJsonUpTo(req, limit) {
  return new Promise((resolve) => {
    let text = ''
    let over = false
    req.setEncoding('utf8')
    req.on('data', (c) => {
      if (over) return
      text += c
      if (text.length > limit) {
        over = true
        text = '' // stop holding an oversized body
      }
    })
    req.on('end', () => {
      if (over) return resolve(null)
      try {
        resolve(JSON.parse(text || '{}'))
      } catch {
        resolve(null)
      }
    })
    req.on('error', () => resolve(null))
  })
}

const parseCookies = (header = '') =>
  Object.fromEntries(
    header
      .split(';')
      .map((p) => p.trim().split('='))
      .filter(([k]) => k)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))])
  )

/* ---------------------------------------------------------------- server -- */

/** The HTTP server. `corePort` is the Academia Core API the steps are relayed to. */
export function createServer({ port, corePort, publicUrl = `http://localhost:${port}`, portalUrl = 'http://localhost:5173' }) {
  const flow = createOnboarding({ secureCookie: publicUrl.startsWith('https://'), host: '127.0.0.1', corePort: () => corePort })
  const origins = (req) => new Set([publicUrl, `http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://${req.headers.host}`])
  const sameOrigin = (req) => {
    if (req.headers.origin) return origins(req).has(req.headers.origin)
    try {
      return origins(req).has(new URL(req.headers.referer).origin)
    } catch {
      return false
    }
  }
  const appConfig = JSON.stringify({ portal_url: portalUrl, sign_in_url: `${portalUrl}/login`, reviewer_url: `${portalUrl}/academia/admin/access?tab=requests` })

  async function handle(req, res) {
    let url
    try {
      url = new URL(req.url, 'http://onboarding')
    } catch {
      return json(res, 400, { error: 'Bad request.' })
    }
    const p = url.pathname
    if (p === '/' || p === '/join' || p === '/index.html') {
      if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Use GET.' }, { Allow: 'GET' })
      const file = path.join(PUBLIC, 'index.html')
      return sendFile(res, file, 'text/html; charset=utf-8', {
        'Content-Security-Policy': pageCsp(file), 'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
      })
    }
    if (p === '/app-config.json') return json(res, 200, JSON.parse(appConfig))
    if (p === '/logo.svg' || p === '/favicon.ico') return sendFile(res, LOGO, 'image/svg+xml', { 'Cache-Control': 'public, max-age=3600' })
    if (p.startsWith(ONBOARDING_PREFIX)) {
      const step = stepOf(p)
      if (!step) return json(res, 404, { error: 'Not found.' })
      let body
      if (req.method === 'POST') {
        if (!sameOrigin(req)) return json(res, 403, { error: 'Cross-origin request refused.', code: 'BAD_ORIGIN' })
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Send JSON.', code: 'JSON_ONLY' })
        body = await readJsonUpTo(req, bodyLimitFor(step))
        if (body === null) return json(res, 400, { error: 'The request was too large or not JSON.', code: 'BAD_BODY' })
      }
      const out = await flow.handle({
        step, method: req.method === 'HEAD' ? 'GET' : req.method, body, cookieToken: parseCookies(req.headers.cookie)[ONBOARDING_COOKIE], clientIp: req.socket.remoteAddress || '',
      })
      return json(res, out.status, out.body, { 'Referrer-Policy': 'no-referrer', ...(out.headers || {}) })
    }
    return json(res, 404, { error: 'Not found.' })
  }

  return http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('  onboarding error:', err.message)
      if (!res.headersSent) json(res, 500, { error: 'Something went wrong. Try again.' })
    })
  })
}

/* ------------------------------------------------------------------ main -- */

function coreStatus(corePort) {
  return new Promise((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: corePort, path: '/api/onboarding/config', timeout: 3000 }, (res) => {
      let t = ''
      res.on('data', (c) => (t += c))
      res.on('end', () => {
        try {
          resolve(res.statusCode === 200 ? (JSON.parse(t).enabled ? 'ready' : 'disabled') : 'old')
        } catch {
          resolve('old')
        }
      })
    })
    r.on('error', () => resolve('down'))
    r.on('timeout', () => r.destroy())
  })
}

async function main() {
  const cfg = settings()
  if (cfg.problems.length) {
    for (const p of cfg.problems) console.error(`  Refusing to start: ${p}`)
    process.exit(2)
  }
  const server = createServer(cfg)
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') console.error(`\n  Port ${cfg.port} is already in use. Stop whatever holds it; onboarding does not pick another port.\n`)
    else console.error(err)
    process.exit(1)
  })
  server.listen(cfg.port, cfg.host, async () => {
    const core = await coreStatus(cfg.corePort)
    const note = {
      ready: 'ready (onboarding enabled)',
      disabled: 'reachable, but onboarding is switched off (ONBOARDING_ENABLED / SELF_REGISTRATION_ENABLED in the Academia API .env)',
      old: 'reachable, but running code without onboarding — restart the portal (stop.bat, start.bat)',
      down: 'not reachable — start the portal (start.bat)',
    }[core]
    console.log(`
  APEX Enterprise Onboarding is running (separate from the portal).

    Onboarding Assistant   ${cfg.publicUrl}
    Shared Core API        http://127.0.0.1:${cfg.corePort}  — ${note}
    Existing users sign in ${cfg.portalUrl}/login

  Ctrl+C stops onboarding only; the portal keeps running.
`)
  })
  const stop = () => {
    server.close()
    console.log('\n  Onboarding stopped. The portal was not touched.')
    setTimeout(() => process.exit(0), 200)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)
}

const isMain = (() => {
  try {
    return path.resolve(process.argv[1] || '').toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()
  } catch {
    return false
  }
})()
if (isMain) main()
