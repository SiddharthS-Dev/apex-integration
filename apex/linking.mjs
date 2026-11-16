/**
 * Account-holder ownership proof: linking an application account to the signed-in
 * Core user (R1 linking addendum, ADR 0003 item 4).
 *
 *   POST /auth/link/start     { app, core_password }
 *     -> Core POST /api/core/link-challenges { sub, app, core_password }
 *     <- 201 { challenge_id, nonce, expires_at }
 *
 *   POST /auth/link/complete  { challenge_id, nonce, app, app_email, app_password }
 *     -> app  POST /api/apex/link-proof { email, password, challenge_id }   (its own port, trusted source)
 *     <- { proof }, verified here with that application's key
 *     -> Core POST /api/core/identity-links/possession { sub, challenge_id, nonce, app, app_user_id }
 *     <- 201 { linked: true, app, app_user_id }
 *
 *   GET /auth/link/state  -> who the Core user is and which applications are linked
 *
 * server.mjs checks the method, same origin, JSON body and the Apex session before
 * anything here runs. Rate limits: 5 starts and 10 completes per 15 minutes, per
 * client address and per Core user. Passwords are passed through once and never
 * stored or logged; nothing here logs a request body. Dependency-free.
 */
import { PROJECTS, upstreamHost } from './projects.mjs'
import { postJson } from './gateway-identity.mjs'
import { verifyLinkProof } from './identity.mjs'

/** Core application id -> gateway project id. */
export const LINK_APPS = Object.freeze({ showcase: 'showcase', slidesvault: 'vault' })

export const CHALLENGE_PATH = '/api/core/link-challenges'
export const POSSESSION_PATH = '/api/core/identity-links/possession'
export const LINK_PROOF_PATH = '/api/apex/link-proof'

export const START_LIMIT = 5
export const COMPLETE_LIMIT = 10
export const LIMIT_WINDOW_MS = 15 * 60_000

const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/
const NONCE_RE = /^[A-Za-z0-9_\-+/=]{16,256}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+$/

/** A fixed-window counter: hit(key) counts one attempt and says whether it is still within the limit. */
export function createWindowLimiter({ max, windowMs = LIMIT_WINDOW_MS, now = Date.now }) {
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

const reply = (status, body, headers) => ({ status, body, ...(headers ? { headers } : {}) })
/** A refusal: `{ error, reason, code }` — `reason` is the Core's own when the Core refused. */
const fail = (status, error, code, extra = {}) => reply(status, { error, reason: code.toLowerCase(), code, ...extra })

/**
 * What the browser is told for each Core refusal reason (exact Core shapes:
 * every refusal is `{ error, reason }`). The Core status is passed through.
 */
const CORE_REASONS = {
  invalid_request: 'Apex Core refused the request as incomplete. Start again.',
  wrong_core_password: 'That is not your Apex password.',
  user_inactive: 'Your Apex account is not active, so it cannot link accounts.',
  rate_limited: 'Too many wrong Apex passwords. Wait 15 minutes and try again.',
  unknown_challenge: 'This link request is not known to Apex Core. Start again.',
  wrong_user: 'This link request belongs to a different Apex account. Start again.',
  replayed: 'That link request was already used. Start again.',
  expired: 'This link request expired. Start again.',
  wrong_app: 'This link request was for a different app. Start again.',
  wrong_nonce: 'This link request could not be confirmed. Start again.',
  app_account_linked_elsewhere:
    'This {app} account is already linked to another Apex account. Nothing was changed. If that is wrong, contact an administrator.',
  core_user_linked_elsewhere:
    'You have already linked a different {app} account to your Apex account. Nothing was changed. To change it, contact an administrator.',
  conflict: 'This {app} account or your Apex account is already linked elsewhere. Nothing was changed. Contact an administrator.',
}

/** The Core's refusal, passed through with its status and reason and a message for people. */
function coreRefusal(res, appName, fallback) {
  const reason = typeof res.json?.reason === 'string' && /^[a-z_]{1,64}$/.test(res.json.reason) ? res.json.reason : ''
  const text = CORE_REASONS[reason] || upstreamMessage(res.json) || fallback
  const body = { error: text.replaceAll('{app}', appName), reason: reason || 'core_refused', code: `CORE_${(reason || 'refused').toUpperCase()}` }
  if (res.json?.active === false) body.active = false
  return reply(res.status, body, res.headers?.['retry-after'] ? { 'Retry-After': String(res.headers['retry-after']) } : undefined)
}

/** The upstream's own error text, when it sent one we can show. */
const upstreamMessage = (json) => {
  const e = json?.error
  const text = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : ''
  return text && text.length <= 300 ? text : ''
}

/**
 * @param {object} options
 * @param {ReturnType<import('./gateway-identity.mjs').createIdentityGateway>} options.identity
 * @param {() => number} [options.now]
 * @param {number} [options.timeoutMs]
 * @param {{ warn: Function }} [options.log]
 */
export function createLinker({ identity, now = Date.now, timeoutMs = 10_000, log = console }) {
  const starts = createWindowLimiter({ max: START_LIMIT, now })
  const completes = createWindowLimiter({ max: COMPLETE_LIMIT, now })

  const projectOf = (app) => (Object.hasOwn(LINK_APPS, app) ? PROJECTS.find((p) => p.id === LINK_APPS[app]) : null)
  const available = (app) => identity.enabled && identity.modeOf(LINK_APPS[app]) !== 'off'

  /** Counts the attempt against the client address and the Core user; a 429 reply when either is over. */
  function limited(limiter, clientIp, sub) {
    const ipOk = limiter.hit(`ip:${clientIp}`)
    const subOk = limiter.hit(`sub:${sub}`)
    if (ipOk && subOk) return null
    const wait = Math.max(ipOk ? 0 : limiter.retryAfter(`ip:${clientIp}`), subOk ? 0 : limiter.retryAfter(`sub:${sub}`))
    return reply(429, { error: 'Too many linking attempts. Wait 15 minutes and try again.', code: 'LINK_RATE_LIMITED' }, { 'Retry-After': String(wait) })
  }

  /** `{ project }` when the request may go on; otherwise the refusal (which has a status). */
  function common(sub, app) {
    if (!sub) {
      return fail(401, 'Linking needs an Apex sign-in with your Apex password or Google account. Sign out, sign in again, then retry.', 'APEX_CORE_SIGNIN_REQUIRED')
    }
    const project = projectOf(app)
    if (!project) return fail(400, 'Choose Showcase or SlidesVault.', 'LINK_BAD_APP')
    if (!available(app)) {
      return fail(503, `Linking to ${project.name} is not available: identity assertion is switched off for it. Ask an administrator.`, 'LINK_UNAVAILABLE')
    }
    return { project }
  }

  const coreCall = (path, body, clientIp) =>
    postJson({ ...identity.core(), path, body, service: identity.serviceAssertion(), headers: { 'X-Forwarded-For': clientIp }, timeoutMs })

  /** Step 1: re-check the Core password and get a challenge for one application. */
  async function start({ sub, clientIp, body }) {
    const app = typeof body?.app === 'string' ? body.app : ''
    const checked = common(sub, app)
    if (checked.status) return checked
    const { project } = checked
    const over = limited(starts, clientIp, sub)
    if (over) return over
    const password = typeof body?.core_password === 'string' ? body.core_password : ''
    if (!password || password.length > 200) return fail(400, 'Enter your Apex password.', 'LINK_BAD_REQUEST')

    const res = await coreCall(CHALLENGE_PATH, { sub, app, core_password: password }, clientIp)
    const j = res.json || {}
    if (res.status === 201 || res.status === 200) {
      if (!ID_RE.test(String(j.challenge_id)) || typeof j.nonce !== 'string' || !j.nonce) {
        log.warn?.('  link: the Core answered a challenge request without a usable challenge')
        return fail(502, 'Apex Core gave an answer Apex could not use. Try again.', 'LINK_CORE_BAD_ANSWER')
      }
      return reply(201, { challenge_id: j.challenge_id, nonce: j.nonce, expires_at: j.expires_at ?? null, app })
    }
    // A wrong service credential (401 without a reason) is the gateway's fault, not the person's.
    if (res.status === 401 && j.reason !== 'wrong_core_password') {
      log.warn?.('  link: the Core refused the gateway service credential')
      return fail(502, 'Apex Core refused Apex itself. Ask an administrator to check the identity keys.', 'LINK_CORE_SERVICE')
    }
    if ([400, 401, 403, 429].includes(res.status)) return coreRefusal(res, project.name, 'Apex Core refused the request.')
    if (res.status === 0) return fail(503, 'Apex Core is not reachable right now. Try again in a moment.', 'LINK_CORE_UNREACHABLE')
    log.warn?.(`  link: the Core answered ${res.status} to a challenge request`)
    return fail(502, 'Apex Core could not start linking. Try again.', 'LINK_CORE_FAILED')
  }

  /** Step 2: the application checks its own password and signs a proof; the Core confirms the link. */
  async function complete({ sub, clientIp, body }) {
    const app = typeof body?.app === 'string' ? body.app : ''
    const checked = common(sub, app)
    if (checked.status) return checked
    const { project } = checked
    const over = limited(completes, clientIp, sub)
    if (over) return over

    const challengeId = typeof body?.challenge_id === 'string' ? body.challenge_id : ''
    const nonce = typeof body?.nonce === 'string' ? body.nonce : ''
    const email = typeof body?.app_email === 'string' ? body.app_email.trim().toLowerCase() : ''
    const password = typeof body?.app_password === 'string' ? body.app_password : ''
    if (!ID_RE.test(challengeId) || !NONCE_RE.test(nonce)) return fail(400, 'This linking attempt is incomplete. Start again.', 'LINK_BAD_REQUEST')
    if (!EMAIL_RE.test(email) || email.length > 254 || !password || password.length > 200) {
      return fail(400, `Enter the email address and password of your ${project.name} account.`, 'LINK_BAD_REQUEST')
    }

    // The application checks its own password, freshly, with its own limiter and lockout.
    const proofRes = await postJson({
      host: upstreamHost(project.id),
      port: project.api.port,
      path: LINK_PROOF_PATH,
      body: { email, password, challenge_id: challengeId },
      service: identity.appServiceAssertion(project.id),
      headers: { 'X-Forwarded-For': clientIp },
      timeoutMs,
    })
    const pj = proofRes.json || {}
    if (proofRes.status !== 200 && proofRes.status !== 201) {
      if (proofRes.status === 401) return fail(401, `That ${project.name} email address and password do not match.`, 'LINK_APP_PASSWORD')
      if (proofRes.status === 429) return fail(429, upstreamMessage(pj) || `Too many sign-in attempts at ${project.name}. Wait a few minutes and try again.`, 'LINK_APP_LOCKED')
      if ([400, 403, 409, 422].includes(proofRes.status)) {
        return fail(proofRes.status, upstreamMessage(pj) || `${project.name} refused to confirm this account.`, 'LINK_APP_REFUSED')
      }
      if (proofRes.status === 0 || proofRes.status === 502 || proofRes.status === 503) {
        return fail(503, `${project.name} is not reachable or not ready for linking right now. Try again in a moment.`, 'LINK_APP_UNAVAILABLE')
      }
      log.warn?.(`  link: ${project.id} answered ${proofRes.status} to a link-proof request`)
      return fail(502, `${project.name} could not confirm the account. Try again.`, 'LINK_APP_FAILED')
    }

    // Never trusted on the application's word: the proof must verify with that application's key,
    // name that application, the link audience and this very challenge, and be unexpired.
    const audience = app
    const verified = verifyLinkProof(pj.proof, { keys: identity.appKeys(project.id), app: audience, challengeId, now: now() })
    if (!verified.ok) {
      log.warn?.(`  link: proof from ${project.id} refused (${verified.reason})`)
      return fail(502, `${project.name} answered with a proof Apex could not verify. Nothing was linked.`, 'LINK_PROOF_INVALID')
    }

    const res = await coreCall(POSSESSION_PATH, { sub, challenge_id: challengeId, nonce, app, app_user_id: verified.claims.app_user_id }, clientIp)
    const j = res.json || {}
    if (res.status === 200 || res.status === 201) {
      // The next request is asked about afresh, so the new link is asserted at once.
      identity.forget(sub)
      return reply(res.status, {
        linked: true,
        app,
        app_user_id: verified.claims.app_user_id,
        ...(typeof j.result === 'string' ? { result: j.result } : {}),
      })
    }
    if (res.status === 401) {
      log.warn?.('  link: the Core refused the gateway service credential')
      return fail(502, 'Apex Core refused Apex itself. Ask an administrator to check the identity keys.', 'LINK_CORE_SERVICE')
    }
    if ([400, 403, 404, 409, 410].includes(res.status)) return coreRefusal(res, project.name, 'Apex Core refused this link request. Start again.')
    if (res.status === 0) return fail(503, 'Apex Core is not reachable right now. Start again in a moment.', 'LINK_CORE_UNREACHABLE')
    log.warn?.(`  link: the Core answered ${res.status} to a possession confirmation`)
    return fail(502, 'Apex Core could not confirm the link. Start again.', 'LINK_CORE_FAILED')
  }

  /** What the /link page shows: the Core user, and per application whether it is linked. */
  async function state({ sub }) {
    const apps = Object.entries(LINK_APPS).map(([app, projectId]) => ({
      app,
      name: PROJECTS.find((p) => p.id === projectId)?.name || app,
      available: available(app),
    }))
    if (!sub) return reply(200, { core: false, enabled: identity.enabled, user: null, apps: apps.map((a) => ({ ...a, linked: false, app_user_id: null })) })
    if (!identity.enabled) return reply(200, { core: true, enabled: false, user: null, apps: apps.map((a) => ({ ...a, linked: false, app_user_id: null })) })
    const resolved = await identity.resolve(sub)
    if (resolved.state !== 'active') return fail(503, 'Apex cannot reach Apex Core right now, so your links cannot be shown. Try again in a moment.', 'LINK_CORE_UNREACHABLE')
    const links = resolved.data?.links || {}
    const idOf = (v) => (typeof v === 'string' ? v : typeof v?.app_user_id === 'string' ? v.app_user_id : null)
    return reply(200, {
      core: true,
      enabled: true,
      user: { email: resolved.data.user?.email || null, name: resolved.data.user?.full_name || null },
      apps: apps.map((a) => ({ ...a, linked: !!idOf(links[a.app]), app_user_id: idOf(links[a.app]) })),
    })
  }

  return { start, complete, state }
}
