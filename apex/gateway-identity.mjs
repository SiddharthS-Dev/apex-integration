/**
 * The gateway's side of identity assertion (R1 identity contract §4.3).
 *
 * For a signed-in session that carries a Core user id (`sub`), the gateway
 * asks the Core who that user is — `POST /api/core/identity/resolve`, straight
 * to the Core API's port, authenticated with a signed X-Apex-Service header —
 * and caches the answer for at most 30 seconds. The answer becomes a fresh,
 * 60-second X-Apex-Identity assertion on every request to the Showcase and
 * SlidesVault APIs, signed with that application's own key.
 *
 * Modes, per application: APEX_IDENTITY_MODE_SHOWCASE / _SLIDESVAULT, else
 * APEX_IDENTITY_MODE, else 'off'. With every application 'off' (the default)
 * nothing here runs: no keys are created, the Core is never asked, nothing is
 * added to any request. A mode that is not off|optional|required is treated
 * as 'required' — a typo must not quietly switch the check off.
 *
 * Dependency-free.
 */
import http from 'node:http'
import { PROJECTS, upstreamHost } from './projects.mjs'
import { ISSUER, SERVICE_HEADER, issueAssertion, normaliseRoles, parseIdentityMode } from './identity.mjs'
import { keysFile, keysFor, loadKeyStore, signingKey } from './identity-keys.mjs'

/** Project id -> assertion audience. */
export const AUDIENCE_OF = Object.freeze({ showcase: 'showcase', vault: 'slidesvault', academia: 'core' })

/** The projects that receive X-Apex-Identity. */
export const ASSERTED_PROJECTS = Object.freeze(['showcase', 'vault'])

export const RESOLVE_PATH = '/api/core/identity/resolve'
export const RESOLVE_TTL_MS = 30_000

/** The mode for one asserted project. */
export function identityMode(projectId, env = process.env) {
  const audience = AUDIENCE_OF[projectId]
  if (!ASSERTED_PROJECTS.includes(projectId)) return 'off'
  const specific = env[`APEX_IDENTITY_MODE_${audience.toUpperCase()}`]
  const raw = specific !== undefined && String(specific).trim() ? specific : env.APEX_IDENTITY_MODE
  return parseIdentityMode(raw, 'off') ?? 'required'
}

/** True when any project asserts identity. */
export const identityEnabled = (env = process.env) => ASSERTED_PROJECTS.some((id) => identityMode(id, env) !== 'off')

/**
 * Identity assertion settings for one API process, as apex/run.mjs starts it
 * (R1 identity contract §4.1).
 *
 * Each process gets only its own audience's keys (current and previous) as
 * APEX_IDENTITY_KEYS: the Showcase its 'showcase' keys, SlidesVault its
 * 'slidesvault' keys, the Academia (APEX Core) its 'core' keys, with which it
 * checks the gateway's X-Apex-Service credential. Keys are handed out only
 * while that process needs them; otherwise APEX_IDENTITY_KEYS is set empty, so
 * nothing stale in the shell leaks through.
 */
export function identityEnv(project, env = process.env, file = keysFile()) {
  const audience = AUDIENCE_OF[project.id]
  if (!audience) return {}
  const isCore = audience === 'core'
  const mode = isCore ? (parseIdentityMode(env.APEX_IDENTITY_MODE, 'off') ?? 'required') : identityMode(project.id, env)
  const needsKeys = isCore ? identityEnabled(env) : mode !== 'off'
  const google = String(env.APEX_GOOGLE_CLIENT_ID || '').trim()
  return {
    APEX_IDENTITY_ISSUER: ISSUER,
    APEX_IDENTITY_AUDIENCE: audience,
    APEX_IDENTITY_MODE: mode,
    APEX_IDENTITY_KEYS: needsKeys ? JSON.stringify(keysFor(loadKeyStore({ env, file }), audience)) : '',
    // The gateway's Google button and the Core's verification must name the same client.
    ...(isCore && google ? { GOOGLE_CLIENT_ID: google } : {}),
  }
}

/** A Core user id as it may appear in the Apex session token. */
export const validSubject = (sub) => typeof sub === 'string' && /^[A-Za-z0-9_.:@-]{1,128}$/.test(sub)

/**
 * One POST to the Core's resolve endpoint. Resolves `{ status, json }`;
 * status 0 when the Core could not be reached at all.
 */
function postResolve({ host, port, sub, service, timeoutMs }) {
  return new Promise((resolve) => {
    const payload = JSON.stringify({ sub })
    const req = http.request(
      {
        host,
        port,
        method: 'POST',
        path: RESOLVE_PATH,
        timeout: timeoutMs,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'X-Requested-With': 'Apex',
          'User-Agent': 'Apex gateway',
          [SERVICE_HEADER]: service,
        },
      },
      (res) => {
        let text = ''
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          text += chunk
          if (text.length > 256 * 1024) req.destroy()
        })
        res.on('end', () => {
          let json = null
          try {
            json = text ? JSON.parse(text) : null
          } catch {
            /* not JSON */
          }
          resolve({ status: res.statusCode, json })
        })
        res.on('error', () => resolve({ status: 0, json: null }))
      }
    )
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
    req.on('error', () => resolve({ status: 0, json: null }))
    req.end(payload)
  })
}

/**
 * @param {object} [options]
 * @param {Record<string, string|undefined>} [options.env]
 * @param {string} [options.file]          the keys file (default apex/.identity-keys.json)
 * @param {number} [options.ttlMs]         resolve cache lifetime, at most 30 s
 * @param {number} [options.failureTtlMs]  how long "Core unreachable" is remembered, so a Core outage is not hammered
 * @param {number} [options.timeoutMs]
 * @param {() => number} [options.now]
 * @param {string} [options.host]          the Core API host (APEX_UPSTREAM_HOST_ACADEMIA, else APEX_UPSTREAM_HOST)
 * @param {() => number} [options.corePort]
 */
export function createIdentityGateway({
  env = process.env,
  file = keysFile(),
  ttlMs = RESOLVE_TTL_MS,
  failureTtlMs = 2_000,
  timeoutMs = 3_000,
  now = Date.now,
  host = upstreamHost('academia', env),
  corePort = () => PROJECTS.find((p) => p.id === 'academia')?.api?.port,
} = {}) {
  const modes = Object.fromEntries(ASSERTED_PROJECTS.map((id) => [id, identityMode(id, env)]))
  const enabled = Object.values(modes).some((m) => m !== 'off')
  const store = enabled ? loadKeyStore({ env, file }) : null
  const ttl = Math.min(ttlMs, RESOLVE_TTL_MS)

  /** sub -> { until, result } */
  const cache = new Map()
  /** sub -> Promise<result> */
  const inflight = new Map()
  let calls = 0

  const serviceAssertion = () => {
    const { kid, key } = signingKey(store, 'core')
    return issueAssertion({ audience: 'core', kid, key, now: now() })
  }

  async function ask(sub) {
    calls += 1
    const res = await postResolve({ host, port: corePort(), sub, service: serviceAssertion(), timeoutMs })
    const body = res.json
    if (res.status === 200 && body && body.active === false) return { state: 'inactive' }
    if (res.status === 200 && body && body.active === true && body.user && body.user.id === sub) {
      return { state: 'active', data: body }
    }
    return { state: 'unavailable', reason: res.status ? `core answered ${res.status}` : 'core unreachable' }
  }

  /**
   * Who `sub` is now: `{ state: 'active', data }`, `{ state: 'inactive' }`
   * (disabled or missing — the session must end), or `{ state: 'unavailable' }`.
   */
  async function resolve(sub) {
    if (!enabled) return { state: 'unavailable', reason: 'identity assertion is off' }
    if (!validSubject(sub)) return { state: 'inactive' }
    const hit = cache.get(sub)
    if (hit && hit.until > now()) return hit.result
    if (inflight.has(sub)) return inflight.get(sub)
    const pending = ask(sub)
      .catch(() => ({ state: 'unavailable', reason: 'resolve failed' }))
      .then((result) => {
        if (cache.size > 10_000) {
          const t = now()
          for (const [k, v] of cache) if (v.until <= t) cache.delete(k)
        }
        cache.set(sub, { until: now() + (result.state === 'unavailable' ? Math.min(failureTtlMs, ttl) : ttl), result })
        return result
      })
      .finally(() => inflight.delete(sub))
    inflight.set(sub, pending)
    return pending
  }

  /** A fresh X-Apex-Identity value for one asserted project. */
  function assertionFor(projectId, sub, data) {
    const audience = AUDIENCE_OF[projectId]
    if (!enabled || !ASSERTED_PROJECTS.includes(projectId)) throw new Error(`no assertions for ${projectId}`)
    const link = data?.links?.[audience]
    const appUserId = typeof link === 'string' ? link : typeof link?.app_user_id === 'string' ? link.app_user_id : null
    const { kid, key } = signingKey(store, audience)
    return issueAssertion({
      audience,
      kid,
      key,
      now: now(),
      claims: {
        sub,
        app_user_id: appUserId || null,
        email: typeof data?.user?.email === 'string' ? data.user.email : null,
        name: typeof data?.user?.full_name === 'string' ? data.user.full_name : null,
        roles: normaliseRoles(data?.roles),
      },
    })
  }

  return {
    enabled,
    modeOf: (projectId) => modes[projectId] || 'off',
    resolve,
    assertionFor,
    /** Drops a cached answer (after a sign-out, say). */
    forget: (sub) => cache.delete(sub),
    get calls() {
      return calls
    },
  }
}
