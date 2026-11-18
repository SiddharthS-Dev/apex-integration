/**
 * The onboarding application's relay to the Core (Use Case 007, Phase 3). Runs inside the separate
 * onboarding server (onboarding/server.mjs, port 5180) — not the portal's gateway, which is unchanged.
 *
 *   GET  /auth/onboarding/config | status
 *   POST /auth/onboarding/start | resend | verify | update | complete | exchange | respond | restart
 *
 * The browser never sees the resume token: the Core returns it in the body, and this relay moves it into
 * an HttpOnly, SameSite=Strict cookie scoped to /auth/onboarding and passes it back to the Core as
 * X-Registration-Token. An emailed response link is exchanged by the page at once and removed from the
 * address bar. No session or account is created here. Request bodies are never logged. Dependency-free.
 */
import http from 'node:http'

/** A fixed-window counter per key: hit(key) counts one attempt and says whether it is still within the limit. */
export function createWindowLimiter({ max, windowMs, now = Date.now }) {
  const hits = new Map()
  return {
    hit(key) {
      const t = now()
      if (hits.size > 10_000) for (const [k, v] of hits) if (v.reset <= t) hits.delete(k)
      let entry = hits.get(key)
      if (!entry || entry.reset <= t) {
        entry = { count: 0, reset: t + windowMs }
        hits.set(key, entry)
      }
      entry.count += 1
      return entry.count <= max
    },
    retryAfter(key) {
      const entry = hits.get(key)
      return entry ? Math.max(1, Math.ceil((entry.reset - now()) / 1000)) : 0
    },
  }
}

export const ONBOARDING_COOKIE = 'apex_onboarding'
export const ONBOARDING_PREFIX = '/auth/onboarding/'
const COOKIE_PATH = '/auth/onboarding'
const CORE_BASE = '/api/onboarding'

/** step -> allowed method; anything else is 404. */
export const STEPS = Object.freeze({
  config: 'GET',
  status: 'GET',
  suggest: 'POST',
  start: 'POST',
  resend: 'POST',
  verify: 'POST',
  update: 'POST',
  complete: 'POST',
  exchange: 'POST',
  respond: 'POST',
  restart: 'POST',
})

/** Steps that send email or touch the AI: tighter per-address limits at the gateway too. */
const COSTLY = new Set(['start', 'resend', 'exchange', 'suggest'])

const TOKEN_RE = /^[A-Za-z0-9_-]{20,200}$/

/**
 * @param {object} options
 * @param {boolean} options.secureCookie
 * @param {string} [options.host]
 * @param {() => number} [options.corePort]
 * @param {number} [options.timeoutMs]
 * @param {() => number} [options.now]
 */
export function createOnboarding({
  secureCookie,
  host = '127.0.0.1',
  corePort = () => 4177,
  timeoutMs = 15_000,
  now = Date.now,
} = {}) {
  const costly = createWindowLimiter({ max: 40, windowMs: 15 * 60_000, now })
  const steps = createWindowLimiter({ max: 300, windowMs: 15 * 60_000, now })
  let configCache = { at: 0, value: null }

  /** One request to the Core; resolves { status, json, headers } (status 0 when unreachable). */
  function core(method, path, { body, token, clientIp } = {}) {
    return new Promise((resolve) => {
      const payload = body === undefined ? null : JSON.stringify(body)
      const req = http.request(
        {
          host,
          port: corePort(),
          method,
          path: `${CORE_BASE}${path}`,
          timeout: timeoutMs,
          headers: {
            Accept: 'application/json',
            'User-Agent': 'Apex gateway',
            'X-Forwarded-For': clientIp || '',
            ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
            ...(token ? { 'X-Registration-Token': token } : {}),
          },
        },
        (res) => {
          let text = ''
          res.setEncoding('utf8')
          res.on('data', (c) => {
            text += c
            if (text.length > 256 * 1024) req.destroy()
          })
          res.on('end', () => {
            let json = null
            try {
              json = text ? JSON.parse(text) : null
            } catch {
              /* not JSON */
            }
            resolve({ status: res.statusCode, json, headers: res.headers })
          })
          res.on('error', () => resolve({ status: 0, json: null, headers: {} }))
        }
      )
      req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })))
      req.on('error', () => resolve({ status: 0, json: null, headers: {} }))
      req.end(payload ?? undefined)
    })
  }

  const cookie = (value, maxAgeSeconds) =>
    `${ONBOARDING_COOKIE}=${value}; Path=${COOKIE_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secureCookie ? '; Secure' : ''}`
  const clear = () => cookie('', 0)

  /** The Core's flags, cached briefly (the /join page and the sign-in link ask often). */
  async function config() {
    if (configCache.value && now() - configCache.at < 30_000) return configCache.value
    const res = await core('GET', '/config')
    const value = res.status === 200 && res.json ? res.json : { enabled: false }
    configCache = { at: now(), value }
    return value
  }

  /** True when the public flow is open (the /join page is served only then). */
  const enabled = async () => (await config()).enabled === true

  /**
   * Handles one /auth/onboarding/<step> call.
   * @returns {Promise<{ status: number, body: object, headers?: Record<string, string|string[]> }>}
   */
  async function handle({ step, method, body, cookieToken, clientIp }) {
    if (!Object.hasOwn(STEPS, step)) return { status: 404, body: { error: 'Not found.' } }
    if (STEPS[step] !== method) return { status: 405, body: { error: `Use ${STEPS[step]}.` }, headers: { Allow: STEPS[step] } }
    if (step === 'config') return { status: 200, body: await config() }
    if (step === 'restart') return { status: 200, body: { ok: true }, headers: { 'Set-Cookie': clear() } }

    const limiter = COSTLY.has(step) ? costly : steps
    if (!limiter.hit(`${step}:${clientIp}`)) {
      return { status: 429, body: { error: 'Too many requests. Wait a few minutes and try again.' }, headers: { 'Retry-After': String(limiter.retryAfter(`${step}:${clientIp}`)) } }
    }

    const token = TOKEN_RE.test(cookieToken || '') ? cookieToken : ''
    // Nothing to resume without a cookie: answered here, so a first visit is not an error.
    if (step === 'status' && !token) return { status: 200, body: { state: 'NONE' } }
    let payload = body
    if (step === 'start') payload = { ...(body || {}), previous_token: token || undefined } // a restart supersedes this browser's draft
    if (step === 'exchange') payload = { token: typeof body?.token === 'string' ? body.token : '' }
    const res = await core(method, `/${step}`, { body: method === 'POST' ? payload ?? {} : undefined, token: step === 'start' || step === 'exchange' ? '' : token, clientIp })
    if (res.status === 0) {
      return { status: 503, body: { error: 'Access requests are unavailable right now. Try again in a moment.', code: 'CORE_UNAVAILABLE', retryable: true } }
    }

    const out = res.json && typeof res.json === 'object' ? { ...res.json } : { error: 'Unexpected answer from APEX Core.' }
    const headers = {}
    if (typeof out.registration_token === 'string' && TOKEN_RE.test(out.registration_token)) {
      // Drafts live a day; a submitted request's token lasts as the Core says (30 days by default).
      const days = out.state === 'PENDING_APPROVAL' || out.state === 'INFO_REQUESTED' ? 30 : 1
      headers['Set-Cookie'] = cookie(out.registration_token, days * 86_400)
    }
    delete out.registration_token
    if (res.status === 401 && out.details?.code === 'RESTART') headers['Set-Cookie'] = clear()
    if (res.headers?.['retry-after']) headers['Retry-After'] = String(res.headers['retry-after'])
    return { status: res.status, body: out, headers }
  }

  return { handle, enabled, config }
}

/** The step named by a /auth/onboarding/<step> path, or null. */
export function stepOf(pathname) {
  if (!pathname.startsWith(ONBOARDING_PREFIX)) return null
  const step = pathname.slice(ONBOARDING_PREFIX.length)
  return /^[a-z]{1,20}$/.test(step) ? step : null
}
