/**
 * One sign-in for all of Apex.
 *
 * The Showcase, SlidesVault and the Academia each keep their own users and sessions — their
 * APIs are the source of truth for who may sign in. Apex does not duplicate
 * that. Signing in here posts the one email and password to every project's
 * own login endpoint; every app that accepts them is signed in, and the
 * browser gets:
 *
 *   apex_session   Apex's own session: an HMAC-signed "who, which apps, until
 *                  when". It is what the gateway checks before serving
 *                  anything at all. Path=/.
 *   insp_session   the Showcase's session, as its API issued it, Path=/showcase/
 *   sv_session     SlidesVault's session, as its API issued it, Path=/vault/
 *   iea_session    the Academia's session, as its API issued it, Path=/academia/
 *
 * So each app finds itself already signed in and never shows its own login.
 * An app that is down, or that does not know these credentials, is skipped
 * rather than failing the whole sign-in; the dashboard shows it as "Sign in
 * required". Signing out revokes every app session at its API and clears them all.
 *
 * Each app cookie is scoped to its own mount, and the gateway forwards it to
 * that app alone (forwardCookies below), so no app ever sees another's
 * session — or Apex's.
 *
 * No password is stored anywhere here; it is only passed through to the APIs.
 * Dependency-free, like the rest of the gateway.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECTS, SESSION_COOKIES, SESSION_HOURS } from './projects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const APEX_COOKIE = 'apex_session'
/** APEX_SESSION_HOURS. Every app is started with the same SESSION_TTL_HOURS, so they lapse together. */
export { SESSION_HOURS }

const APPS = PROJECTS.filter((p) => p.api?.sessionCookie)

/* --------------------------------------------------------------- secret -- */

/**
 * The key that signs apex_session. Kept in a gitignored file rather than made
 * up per start, so restarting Apex does not sign everybody out.
 */
function loadSecret() {
  const file = path.join(HERE, '.session-secret')
  try {
    const existing = fs.readFileSync(file, 'utf8').trim()
    if (existing.length >= 32) return existing
  } catch {
    /* first run */
  }
  const fresh = crypto.randomBytes(32).toString('base64url')
  fs.writeFileSync(file, fresh, { mode: 0o600 })
  return fresh
}

const SECRET = loadSecret()

const mac = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url')

/**
 * `email.expiresAt.apps.signature`, all cookie-safe: the email is base64url,
 * the apps are project ids joined with '~'.
 */
function sign(email, expiresAt, apps) {
  const body = `${Buffer.from(email).toString('base64url')}.${expiresAt}.${apps.join('~')}`
  return `${body}.${mac(body)}`
}

/**
 * `{ email, apps }` for a valid token, or null for a missing, forged or expired one.
 *
 * A token from before the app list existed (three parts) is still honoured
 * until it expires, as signed in to every app — which is what it meant then.
 */
export function verifyToken(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3 && parts.length !== 4) return null
  const signature = parts.pop()
  const [emailB64, expiresAt, apps] = parts
  const expected = mac(parts.join('.'))
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (!(Number(expiresAt) > Date.now())) return null
  return {
    email: Buffer.from(emailB64, 'base64url').toString('utf8'),
    apps: apps === undefined ? APPS.map((p) => p.id) : apps.split('~').filter(Boolean),
  }
}

/** The signed-in email, or null. */
export const verify = (token) => verifyToken(token)?.email ?? null

/* -------------------------------------------------------------- cookies -- */

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    const name = part.slice(0, eq).trim()
    // The first wins, as in every app's cookie parser: a browser sends the
    // most specific path first, so a mount-scoped cookie beats a legacy Path=/ one.
    if (name in out) continue
    try {
      out[name] = decodeURIComponent(part.slice(eq + 1).trim())
    } catch {
      out[name] = part.slice(eq + 1).trim()
    }
  }
  return out
}

/** `{ email, apps }` for a request's Apex session, or null. */
export const sessionInfo = (req) => verifyToken(parseCookies(req.headers.cookie)[APEX_COOKIE])

/** The signed-in email for a request, or null. */
export const sessionOf = (req) => sessionInfo(req)?.email ?? null

/** The cookie path a project's cookies are scoped to: '/vault' → '/vault/'. */
export const mountPath = (base) => `${base.replace(/\/+$/, '')}/`

const clearAt = (name, cookiePath) => `${name}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0`

/**
 * The Set-Cookie headers that clear `name` — at its mount and at Path=/, where
 * Apex used to put every app cookie, so a browser from before the move is
 * cleaned up too.
 *
 * @param {string} name
 * @param {string} [base] The project's mount; omitted for apex_session, which lives at '/'.
 */
export function clearCookie(name, base) {
  return base ? [clearAt(name, mountPath(base)), clearAt(name, '/')] : [clearAt(name, '/')]
}

/**
 * Rewrites a Set-Cookie header from a project so the cookie belongs to that
 * project's mount: `Path=/` becomes `Path=/vault/`. Any other path is the
 * app's own choice and is kept. Pure.
 */
export function scopeSetCookie(setCookie, base) {
  const scoped = mountPath(base)
  return String(setCookie).replace(/(;\s*path\s*=\s*)\/(?=\s*(;|$))/i, `$1${scoped}`)
}

/**
 * The Cookie header to send on to one project: its own session cookie (the
 * first one, if the browser holds two), and any cookie Apex does not manage —
 * but never apex_session and never another app's session. Returns '' when
 * nothing is left. Pure.
 *
 * @param {string|undefined} header   The browser's Cookie header.
 * @param {string|undefined} own      This project's session cookie name.
 * @param {string[]} [managed]        Every cookie name Apex manages.
 */
export function forwardCookies(header, own, managed = [APEX_COOKIE, ...SESSION_COOKIES]) {
  if (!header) return ''
  const drop = new Set(managed)
  let ownSeen = false
  const kept = []
  for (const raw of String(header).split(';')) {
    const part = raw.trim()
    if (!part) continue
    const eq = part.indexOf('=')
    const name = (eq < 0 ? part : part.slice(0, eq)).trim()
    if (name === own) {
      if (ownSeen) continue
      ownSeen = true
    } else if (drop.has(name)) {
      continue
    }
    kept.push(part)
  }
  return kept.join('; ')
}

/* ------------------------------------------------------------ upstream -- */

/** One JSON POST to a project's API, straight to its port (not through the gateway). */
function post(project, pathname, { body, cookie = '', clientIp = '' } = {}) {
  return new Promise((resolve) => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const upstream = http.request(
      {
        host: '127.0.0.1',
        port: project.api.port,
        method: 'POST',
        path: pathname,
        timeout: 10_000,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Requested-With': 'Apex',
          'User-Agent': 'Apex gateway',
          // The browser's address, for the app's own rate limiting and login
          // history. Every API trusts loopback, which is where this comes from.
          'X-Forwarded-For': clientIp,
          ...(cookie ? { Cookie: cookie } : {}),
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => (text += chunk))
        res.on('end', () => {
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json, cookies: res.headers['set-cookie'] || [] })
        })
      }
    )
    upstream.on('timeout', () => upstream.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    upstream.on('error', (error) => resolve({ status: 0, error }))
    upstream.end(payload)
  })
}

/** The Set-Cookie value that carries `name`, from an upstream response. */
const cookieFrom = (cookies, name) => cookies.find((c) => c.startsWith(`${name}=`)) || null

/** How one app answered a sign-in. Pure. */
export function classify(res, cookieName) {
  if (res.status === 200 && cookieFrom(res.cookies || [], cookieName)) return 'ok'
  if (res.status === 0 || res.status === 502 || res.status === 503 || res.status === 504) return 'down'
  if (res.status === 429) return 'limited'
  return 'refused'
}

/**
 * Signs in to every project that accepts the credentials.
 *
 * Resolves to `{ status: 200, cookies, apps }` when at least one app accepted
 * — `apps` is the ids signed in to — or to `{ status, error }` for the sign-in
 * screen when none did. Apps that are down or refuse are skipped; any session
 * the browser still holds for one of them is revoked and cleared, so nobody
 * inherits a previous user's session in an app they could not sign in to.
 *
 * @param {string} email
 * @param {string} password
 * @param {{ req: import('node:http').IncomingMessage, clientIp: string }} context
 */
export async function signIn(email, password, { req, clientIp }) {
  const results = await Promise.all(
    APPS.map(async (project) => {
      const res = await post(project, '/api/auth/login', { body: { email, password }, clientIp })
      return { project, res, outcome: classify(res, project.api.sessionCookie) }
    })
  )

  const accepted = results.filter((r) => r.outcome === 'ok')
  if (!accepted.length) {
    if (results.some((r) => r.outcome === 'limited')) {
      return { status: 429, error: 'Too many sign-in attempts. Wait a few minutes and try again.' }
    }
    // Every app down: say so, rather than blame the password.
    if (results.every((r) => r.outcome === 'down')) {
      return { status: 503, error: 'No platform is reachable yet. Give Apex a few seconds and sign in again.' }
    }
    return { status: 401, error: 'That email address and password do not match.' }
  }

  // An app left out may still hold an older session — perhaps someone else's.
  const jar = parseCookies(req.headers.cookie)
  const skipped = results.filter((r) => r.outcome !== 'ok')
  await Promise.all(
    skipped
      .filter((r) => jar[r.project.api.sessionCookie])
      .map((r) =>
        post(r.project, '/api/auth/logout', {
          cookie: `${r.project.api.sessionCookie}=${jar[r.project.api.sessionCookie]}`,
          clientIp,
        })
      )
  )

  const apps = accepted.map((r) => r.project.id)
  const expiresAt = Date.now() + SESSION_HOURS * 3600_000
  const apexCookie = `${APEX_COOKIE}=${sign(email.toLowerCase(), expiresAt, apps)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(SESSION_HOURS * 3600)}`
  return {
    status: 200,
    apps,
    cookies: [
      apexCookie,
      // Legacy Path=/ copies go first, then the mount-scoped cookie that replaces them.
      ...accepted.flatMap((r) => [
        clearAt(r.project.api.sessionCookie, '/'),
        scopeSetCookie(cookieFrom(r.res.cookies, r.project.api.sessionCookie), r.project.base),
      ]),
      ...skipped.flatMap((r) => clearCookie(r.project.api.sessionCookie, r.project.base)),
    ],
  }
}

/**
 * Revokes every app session this browser holds, and returns the headers that
 * clear all of them (at their mounts and at the legacy Path=/).
 *
 * Only cookies the browser sent can be revoked, and a request to /auth/logout
 * carries just the legacy Path=/ ones — mount-scoped cookies are not sent
 * there. Those are cleared in the browser all the same, and the app session
 * behind them is then unusable and expires on its own by SESSION_TTL_HOURS.
 */
export async function signOut(req, clientIp = '') {
  const jar = parseCookies(req.headers.cookie)
  await Promise.all(
    APPS.filter((p) => jar[p.api.sessionCookie]).map((p) =>
      post(p, '/api/auth/logout', { cookie: `${p.api.sessionCookie}=${jar[p.api.sessionCookie]}`, clientIp })
    )
  )
  return [...clearCookie(APEX_COOKIE), ...APPS.flatMap((p) => clearCookie(p.api.sessionCookie, p.base))]
}

/* ------------------------------------------------------ attempt limiter -- */

const FAILURE_WINDOW_MS = 15 * 60_000
const MAX_FAILURES = 10
const failures = new Map() // ip -> { count, reset }

/** True when this address has failed too often recently. */
export function isLimited(ip) {
  const entry = failures.get(ip)
  if (!entry) return false
  if (entry.reset < Date.now()) {
    failures.delete(ip)
    return false
  }
  return entry.count >= MAX_FAILURES
}

export function noteFailure(ip) {
  const entry = failures.get(ip)
  if (!entry || entry.reset < Date.now()) failures.set(ip, { count: 1, reset: Date.now() + FAILURE_WINDOW_MS })
  else entry.count += 1
}

export const clearFailures = (ip) => failures.delete(ip)

/**
 * Only a path on this site — anything else would make /login an open redirect.
 *
 * Browsers strip tab, CR and LF from a URL and treat '\' as '/', so
 * "/\t/evil.com" or "/\\evil.com" becomes "//evil.com" — another site. Any
 * whitespace, control character or backslash is refused outright, and what is
 * left must still resolve to this origin. Pure.
 */
export function safeNext(value) {
  if (typeof value !== 'string' || value.length > 2048) return '/'
  if (!value.startsWith('/') || value.startsWith('//')) return '/'
  if (/[\s\\\u0000-\u001f\u007f-\u009f]/.test(value)) return '/'
  try {
    if (new URL(value, 'http://x').origin !== 'http://x') return '/'
  } catch {
    return '/'
  }
  return value
}
