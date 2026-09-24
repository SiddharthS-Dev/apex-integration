/**
 * One sign-in for all of Apex.
 *
 * The Showcase and SlidesVault each keep their own users and sessions — their
 * APIs are the source of truth for who may sign in. Apex does not duplicate
 * that. Signing in here posts the one email and password to every project's
 * own login endpoint, and only if every one of them accepts does the browser
 * get:
 *
 *   apex_session   Apex's own session: an HMAC-signed "who, until when". It is
 *                  what the gateway checks before serving anything at all.
 *   insp_session   the Showcase's session, exactly as its API issued it
 *   sv_session     SlidesVault's session, exactly as its API issued it
 *
 * So each app finds itself already signed in and never shows its own login.
 * Signing out revokes every app session at its API and clears all three.
 *
 * No password is stored anywhere here; it is only passed through to the APIs.
 * Dependency-free, like the rest of the gateway.
 */
import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PROJECTS } from './projects.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const APEX_COOKIE = 'apex_session'
/** Matches both apps' own session lifetime (SESSION_TTL_HOURS=12), so they lapse together. */
export const SESSION_HOURS = 12

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

/** `email.expiresAt.signature`, all base64url so it is cookie-safe. */
function sign(email, expiresAt) {
  const body = `${Buffer.from(email).toString('base64url')}.${expiresAt}`
  return `${body}.${mac(body)}`
}

/** The signed-in email, or null for a missing, forged or expired cookie. */
export function verify(token) {
  if (typeof token !== 'string') return null
  const parts = token.split('.')
  if (parts.length !== 3) return null
  const [emailB64, expiresAt, signature] = parts
  const expected = mac(`${emailB64}.${expiresAt}`)
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  if (!(Number(expiresAt) > Date.now())) return null
  return Buffer.from(emailB64, 'base64url').toString('utf8')
}

/* -------------------------------------------------------------- cookies -- */

export function parseCookies(header = '') {
  const out = {}
  for (const part of String(header).split(';')) {
    const eq = part.indexOf('=')
    if (eq < 1) continue
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

/** The signed-in email for a request, or null. */
export const sessionOf = (req) => verify(parseCookies(req.headers.cookie)[APEX_COOKIE])

const clearCookie = (name) => `${name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`

/* ------------------------------------------------------------ upstream -- */

/** One JSON POST to a project's API, straight to its port (not through the gateway). */
function post(project, pathname, { body, cookie = '', req } = {}) {
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
          'User-Agent': req?.headers['user-agent'] || 'Apex gateway',
          'X-Forwarded-For': req?.socket.remoteAddress || '',
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

/**
 * Signs in to every project. Resolves to the Set-Cookie headers to send, or
 * to `{ status, error }` for the sign-in screen. If any project refuses, the
 * ones that accepted are signed out again, so nothing is left half-signed-in.
 */
export async function signIn(email, password, req) {
  const results = await Promise.all(
    APPS.map(async (project) => ({
      project,
      res: await post(project, '/api/auth/login', { body: { email, password }, req }),
    }))
  )

  const down = results.find((r) => r.res.status === 0 || r.res.status === 502 || r.res.status === 503)
  const limited = results.find((r) => r.res.status === 429)
  const refused = results.find((r) => r.res.status !== 200 || !cookieFrom(r.res.cookies, r.project.api.sessionCookie))

  if (refused) {
    // Undo the half that worked.
    await Promise.all(
      results
        .filter((r) => r.res.status === 200)
        .map((r) => {
          const set = cookieFrom(r.res.cookies, r.project.api.sessionCookie)
          return set ? post(r.project, '/api/auth/logout', { cookie: set.split(';')[0], req }) : null
        })
    )
    if (down) {
      return {
        status: 503,
        error: `${down.project.name} is still starting up. Give it a few seconds and sign in again.`,
      }
    }
    if (limited) return { status: 429, error: 'Too many sign-in attempts. Wait a few minutes and try again.' }
    return { status: 401, error: 'That email address and password do not match.' }
  }

  const expiresAt = Date.now() + SESSION_HOURS * 3600_000
  const apexCookie = `${APEX_COOKIE}=${sign(email.toLowerCase(), expiresAt)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_HOURS * 3600}`
  return {
    status: 200,
    cookies: [apexCookie, ...results.map((r) => cookieFrom(r.res.cookies, r.project.api.sessionCookie))],
  }
}

/** Revokes every app session this browser holds, and returns the headers that clear all of them. */
export async function signOut(req) {
  const jar = parseCookies(req.headers.cookie)
  await Promise.all(
    APPS.filter((p) => jar[p.api.sessionCookie]).map((p) =>
      post(p, '/api/auth/logout', { cookie: `${p.api.sessionCookie}=${jar[p.api.sessionCookie]}`, req })
    )
  )
  return [clearCookie(APEX_COOKIE), ...APPS.map((p) => clearCookie(p.api.sessionCookie))]
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

/** Only a path on this site — anything else would make /login an open redirect. */
export const safeNext = (value) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\') ? value : '/'
