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
 *                  when" — and, when the Academia (APEX Core) accepted, which
 *                  Core user (`sub`). It is what the gateway checks before serving
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
import { PROJECTS, SESSION_COOKIES, SESSION_HOURS, upstreamHost } from './projects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const APEX_COOKIE = 'apex_session'
/** APEX_SESSION_HOURS. Every app is started with the same SESSION_TTL_HOURS, so they lapse together. */
export { SESSION_HOURS }

const APPS = PROJECTS.filter((p) => p.api?.sessionCookie)

/**
 * Behind an https APEX_PUBLIC_URL the Apex cookie is marked Secure, like every
 * app's own session cookie (projects.mjs passes them COOKIE_SECURE). Over plain
 * http://localhost it cannot be, or the browser would drop it.
 */
export const COOKIE_SECURE = /^https:/i.test((process.env.APEX_PUBLIC_URL || '').trim())
const SECURE_ATTR = COOKIE_SECURE ? '; Secure' : ''

/* --------------------------------------------------------------- secret -- */

/**
 * The key that signs apex_session. Kept in a gitignored file rather than made
 * up per start, so restarting Apex does not sign everybody out.
 * APEX_SESSION_SECRET_FILE moves it (a container keeps it on a volume).
 */
function loadSecret() {
  const file = (process.env.APEX_SESSION_SECRET_FILE || '').trim() || path.join(HERE, '.session-secret')
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
 * `email.expiresAt.apps.sub.signature`, all cookie-safe: the email and the
 * Core user id (`sub`, empty when the Core did not sign this browser in) are
 * base64url, the apps are project ids joined with '~'.
 */
function sign(email, expiresAt, apps, sub = '') {
  const body = `${Buffer.from(email).toString('base64url')}.${expiresAt}.${apps.join('~')}.${Buffer.from(sub || '').toString('base64url')}`
  return `${body}.${mac(body)}`
}

/**
 * `{ email, apps, sub }` for a valid token, or null for a missing, forged or expired one.
 *
 * Older tokens are still honoured until they expire: one from before the app
 * list existed (three parts) as signed in to every app — which is what it
 * meant then — and one from before `sub` existed (four parts) with sub null.
 */
export function verifyToken(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length < 3 || parts.length > 5) return null
  const signature = parts.pop()
  const [emailB64, expiresAt, apps, subB64] = parts
  const expected = mac(parts.join('.'))
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (!(Number(expiresAt) > Date.now())) return null
  if (isRevoked(signature)) return null
  const sub = subB64 ? Buffer.from(subB64, 'base64url').toString('utf8') : ''
  return {
    email: Buffer.from(emailB64, 'base64url').toString('utf8'),
    apps: apps === undefined ? APPS.map((p) => p.id) : apps.split('~').filter(Boolean),
    sub: sub || null,
    expiresAt: Number(expiresAt),
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

const clearAt = (name, cookiePath) => `${name}=; Path=${cookiePath}; HttpOnly; SameSite=Lax; Max-Age=0${SECURE_ATTR}`

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
        host: upstreamHost(project.id),
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
 * With identity assertion on (apex/gateway-identity.mjs), the Core's answer
 * also names the Core user (`user.id`), which goes into the Apex session as
 * `sub`. An application in `required` mode is not asked to check the password
 * at all — its own sign-in refuses — and counts as signed in through the
 * assertion whenever the Core accepted.
 *
 * @param {string} email
 * @param {string} password
 * @param {{ req: import('node:http').IncomingMessage, clientIp: string,
 *           identity?: { modeOf: (projectId: string) => string } }} context
 */
export async function signIn(email, password, { req, clientIp, identity }) {
  const required = (project) => identity?.modeOf?.(project.id) === 'required'
  const results = await Promise.all(
    APPS.map(async (project) => {
      if (required(project)) return { project, res: null, outcome: 'identity' }
      const res = await post(project, '/api/auth/login', { body: { email, password }, clientIp })
      return { project, res, outcome: classify(res, project.api.sessionCookie) }
    })
  )

  const accepted = results.filter((r) => r.outcome === 'ok')
  if (!accepted.length) {
    const asked = results.filter((r) => r.outcome !== 'identity')
    if (asked.some((r) => r.outcome === 'limited')) {
      return { status: 429, error: 'Too many sign-in attempts. Wait a few minutes and try again.' }
    }
    // Every app down: say so, rather than blame the password.
    if (asked.every((r) => r.outcome === 'down')) {
      return { status: 503, error: 'No platform is reachable yet. Give Apex a few seconds and sign in again.' }
    }
    return { status: 401, error: 'That email address and password do not match.' }
  }

  const sub = coreSubject(accepted.find((r) => r.project.id === CORE_ID)?.res)
  const asserted = sub ? results.filter((r) => r.outcome === 'identity') : []
  const skipped = results.filter((r) => r.outcome !== 'ok')
  await revokeLeftovers(req, skipped, clientIp)

  return sessionResult({ email, sub, accepted, asserted, skipped })
}

/** The project whose sign-in answer names the Core user: the Academia, which is APEX Core. */
const CORE_ID = 'academia'

/** The Core user id from a Core sign-in answer (`{ user: { id } }`), or ''. */
function coreSubject(res) {
  const id = res?.json?.user?.id
  return typeof id === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(id) ? id : ''
}

/** An app left out may still hold an older session — perhaps someone else's. Revoke it at its API. */
async function revokeLeftovers(req, skipped, clientIp) {
  const jar = parseCookies(req.headers.cookie)
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
}

/**
 * The 200 answer for a sign-in: the Apex session (with `sub`), every accepted
 * app's own session cookie under its mount, and every other app's cleared.
 */
function sessionResult({ email, sub, accepted, asserted, skipped }) {
  const apps = [...accepted, ...asserted].map((r) => r.project.id)
  const expiresAt = Date.now() + SESSION_HOURS * 3600_000
  const apexCookie = `${APEX_COOKIE}=${sign(email.toLowerCase(), expiresAt, apps, sub)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.round(SESSION_HOURS * 3600)}${SECURE_ATTR}`
  return {
    status: 200,
    apps,
    sub: sub || null,
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
 * "Sign in with Google": the Google ID token goes to the Core
 * (`POST /api/core/auth/google`), which signs in only a Google subject already
 * linked to a Core user — never by email. On success the Apex session is set
 * up exactly as for a password: the Core's own session, `sub`, and every app in
 * identity-assertion mode counted as signed in. Apps still on their own
 * password sign-in (mode off) cannot be signed in without a password, so their
 * sessions are cleared and the dashboard shows them as "Sign in required".
 *
 * @param {string} credential  The Google Identity Services ID token.
 */
export async function signInWithGoogle(credential, { req, clientIp, identity }) {
  const core = APPS.find((p) => p.id === CORE_ID)
  if (!core) return { status: 404, error: 'Google sign-in is not available.' }
  const res = await post(core, '/api/core/auth/google', { body: { credential }, clientIp })
  const outcome = classify(res, core.api.sessionCookie)
  const sub = coreSubject(res)
  const email = typeof res.json?.user?.email === 'string' ? res.json.user.email : ''
  if (outcome !== 'ok' || !sub || !email) {
    if (outcome === 'down') return { status: 503, error: 'Inspironics Academia is not reachable yet. Try again in a few seconds.' }
    if (outcome === 'limited') return { status: 429, error: 'Too many sign-in attempts. Wait a few minutes and try again.' }
    if (res.status === 404) return { status: 404, error: 'Google sign-in is not enabled.' }
    // No hint whether the Google account exists anywhere.
    return { status: 401, error: 'That Google account is not linked to an Apex account.' }
  }
  const accepted = [{ project: core, res, outcome }]
  const others = APPS.filter((p) => p !== core).map((project) => ({ project, res: null, outcome: 'identity' }))
  const asserted = others.filter((r) => (identity?.modeOf?.(r.project.id) || 'off') !== 'off')
  const skipped = others
  await revokeLeftovers(req, skipped, clientIp)
  return sessionResult({ email, sub, accepted, asserted, skipped })
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
  // The Apex token itself is stateless, so a copy of it would stay valid until
  // it expires. Remember it as revoked instead.
  revokeToken(jar[APEX_COOKIE])
  await Promise.all(
    APPS.filter((p) => jar[p.api.sessionCookie]).map((p) =>
      post(p, '/api/auth/logout', { cookie: `${p.api.sessionCookie}=${jar[p.api.sessionCookie]}`, clientIp })
    )
  )
  return [...clearCookie(APEX_COOKIE), ...APPS.flatMap((p) => clearCookie(p.api.sessionCookie, p.base))]
}

/* ----------------------------------------------------------- revocation -- */

/**
 * Signed-out tokens, by signature, until they would have expired anyway. Kept
 * in a gitignored file beside the secret, so a restart does not bring a
 * signed-out session back. Small: one line per sign-out within SESSION_HOURS.
 */
const REVOKED_FILE = process.env.APEX_REVOKED_FILE || path.join(HERE, '.revoked-sessions')
const revoked = new Map() // signature -> expiresAt

function loadRevoked() {
  try {
    for (const line of fs.readFileSync(REVOKED_FILE, 'utf8').split(/\r?\n/)) {
      const [sig, exp] = line.trim().split(' ')
      if (sig && Number(exp) > Date.now()) revoked.set(sig, Number(exp))
    }
  } catch {
    /* none yet */
  }
}
loadRevoked()

function saveRevoked() {
  const now = Date.now()
  for (const [sig, exp] of revoked) if (exp <= now) revoked.delete(sig)
  try {
    fs.writeFileSync(REVOKED_FILE, [...revoked].map(([s, e]) => `${s} ${e}`).join('\n'), { mode: 0o600 })
  } catch {
    /* in memory still holds it for this process */
  }
}

function isRevoked(signature) {
  const exp = revoked.get(signature)
  if (exp === undefined) return false
  if (exp <= Date.now()) {
    revoked.delete(signature)
    return false
  }
  return true
}

/** Marks a valid Apex token as signed out. Ignores anything that does not verify. */
export function revokeToken(token) {
  if (!verifyToken(token)) return false
  const parts = token.split('.')
  revoked.set(parts[parts.length - 1], Number(parts[1]))
  saveRevoked()
  return true
}

/** A fresh token for tests: the same shape signIn() hands the browser. */
export const issueToken = (email, apps = APPS.map((p) => p.id), hours = SESSION_HOURS, sub = '') =>
  sign(email.toLowerCase(), Date.now() + hours * 3600_000, apps, sub)

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
