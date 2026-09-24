/**
 * /api/auth — register, verify, sign in (password, Google, guest), reset, sign out.
 *
 * Every successful sign-in sets the httpOnly session cookie and returns the
 * session in the shape the web client already uses:
 *   { user: { id, email, name, picture, role }, isGuest, issuedAt, expiresAt }
 *
 * No mail is sent. Outside production the one-time codes come back in the
 * response as `devCode` / `devToken` so the flows complete; in production they
 * are never returned, and a mail transport is the missing piece.
 */
import express from 'express'
import { ROLES } from '@inspironics/shared'
import { hashPassword, needsRehash, verifyPassword } from '../lib/crypto.js'
import { HttpError, badRequest, field, route } from '../lib/http.js'
import { requireAuth, sessionCookieOptions } from '../middleware/auth.js'
import { rateLimit } from '../middleware/security.js'
import { toUser } from '../repos/auth.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const normaliseEmail = (e) => String(e || '').trim().toLowerCase()

export function passwordIssues(pw) {
  const issues = []
  if ((pw || '').length < 8) issues.push('at least 8 characters')
  if (!/[A-Za-z]/.test(pw || '')) issues.push('a letter')
  if (!/\d/.test(pw || '')) issues.push('a number')
  return issues
}

const CODE_ERRORS = {
  missing: 'No code is pending for that email — request a new one.',
  expired: 'That code has expired — request a new one.',
  locked: 'Too many incorrect attempts — request a new code.',
}

export function authRoutes({ config, repos, metrics, log }) {
  const r = express.Router()
  const limiter = rateLimit({ windowMs: 15 * 60_000, max: config.isProd ? 30 : 300, bucket: 'auth', metrics })
  const client = (req) => ({ ip: req.ip, userAgent: req.get('user-agent') || '' })

  /**
   * Development only: an install with no administrator hands the role to the
   * first real person who signs in, whichever way they sign in. Production
   * uses BOOTSTRAP_ADMIN_* or `npm run create-admin`, so a public deploy can
   * never be claimed by whoever arrives first.
   */
  async function claimsFirstAdmin(userRow) {
    if (config.isProd || config.auth.bootstrapAdminEmail || userRow.role !== ROLES.VIEWER) return false
    return (await repos.users.countAdmins()) === 0
  }

  async function startSession(req, res, userRow, method) {
    if (await claimsFirstAdmin(userRow)) {
      await repos.users.update(userRow.id, { role: ROLES.ADMIN })
      userRow = { ...userRow, role: ROLES.ADMIN }
      log.info('No administrator yet: promoted the first account to sign in (development)', { email: userRow.email })
    }
    const user = toUser(userRow)
    const isGuest = user.role === ROLES.GUEST
    const hours = config.auth.sessionHours
    const { token, expiresAt } = await repos.sessions.create(user.id, hours, client(req))
    if (!isGuest) await repos.users.update(user.id, { last_login_at: new Date().toISOString() })
    await repos.loginHistory.record({ userId: user.id, email: user.email, method, success: true, ...client(req) })
    metrics.inc('auth_login_total', { method, result: 'success' })
    res.cookie(config.auth.cookieName, token, sessionCookieOptions(config, expiresAt))
    return sessionBody(user, Date.now(), Date.parse(expiresAt))
  }

  async function failed(req, email, method, reason) {
    await repos.loginHistory.record({ email, method, success: false, reason, ...client(req) })
    metrics.inc('auth_login_total', { method, result: 'failure' })
  }

  const codeError = (result) =>
    result.reason === 'wrong'
      ? badRequest(`That code is not correct — ${result.attemptsLeft} attempt${result.attemptsLeft === 1 ? '' : 's'} left.`)
      : badRequest(CODE_ERRORS[result.reason])

  const issueCode = async (email, kind, ttl) => {
    const code = await repos.codes.issue(email, kind, ttl)
    if (!config.auth.exposeDevCodes) log.info('One-time code issued (mail transport not configured)', { email, kind })
    return config.auth.exposeDevCodes ? code : null
  }

  /* ------------------------------------------------------------ public -- */

  r.get('/config', (req, res) => {
    res.json({
      allowRegistration: config.auth.allowRegistration,
      guestEnabled: config.auth.guestEnabled,
      googleClientId: config.auth.googleClientId || null,
      devCodes: config.auth.exposeDevCodes,
    })
  })

  r.get(
    '/session',
    route(async (req, res) => {
      if (!req.user) return res.json({ session: null })
      // an already signed-in viewer on an admin-less dev install claims it too
      if (await claimsFirstAdmin(req.user)) {
        await repos.users.update(req.user.id, { role: ROLES.ADMIN })
        req.user = { ...req.user, role: ROLES.ADMIN }
        log.info('No administrator yet: promoted the signed-in account (development)', { email: req.user.email })
      }
      res.json({ session: sessionBody(req.user, null, Date.parse(req.sessionExpiresAt)) })
    })
  )

  r.post(
    '/register',
    limiter,
    route(async (req, res) => {
      if (!config.auth.allowRegistration) throw new HttpError(403, 'Registration is closed — ask an administrator for an account.')
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const password = field(req.body, 'password', { max: 200 })
      const name = field(req.body, 'name', { max: 120, optional: true }) || email.split('@')[0]
      if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address.')
      const issues = passwordIssues(password)
      if (issues.length) throw badRequest(`Password needs ${issues.join(', ')}.`)

      const existing = await repos.users.findByEmail(email)
      if (existing?.verified) throw new HttpError(409, 'An account with that email already exists.')
      const passwordHash = await hashPassword(password)
      if (existing) await repos.users.update(existing.id, { name, password_hash: passwordHash })
      else {
        // viewer for now; claimsFirstAdmin() promotes it at verification if the install has no admin
        await repos.users.create({ email, name, passwordHash, role: ROLES.VIEWER })
      }
      res.status(201).json({ email, devCode: await issueCode(email, 'verification', config.auth.otpTtlMinutes) })
    })
  )

  r.get(
    '/pending',
    route(async (req, res) => {
      const email = normaliseEmail(req.query.email)
      const kind = req.query.kind === 'reset' ? 'reset' : 'verification'
      res.json({ pending: email ? await repos.codes.pending(email, kind) : null })
    })
  )

  r.post(
    '/resend',
    limiter,
    route(async (req, res) => {
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const user = await repos.users.findByEmail(email)
      if (!user || user.verified) throw badRequest('No pending registration for that email.')
      res.json({ email, devCode: await issueCode(email, 'verification', config.auth.otpTtlMinutes) })
    })
  )

  r.post(
    '/verify',
    limiter,
    route(async (req, res) => {
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const code = field(req.body, 'code', { max: 12 })
      const result = await repos.codes.consume(email, 'verification', code, config.auth.maxCodeAttempts)
      if (!result.ok) throw codeError(result)
      const user = await repos.users.findByEmail(email)
      if (!user) throw badRequest('That account no longer exists — please register again.')
      await repos.users.update(user.id, { verified: true })
      res.json({ session: await startSession(req, res, { ...user, verified: 1 }, 'password') })
    })
  )

  r.post(
    '/login',
    limiter,
    route(async (req, res) => {
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const password = field(req.body, 'password', { max: 200 })
      const user = await repos.users.findByEmail(email)
      const ok = user?.password_hash && (await verifyPassword(password, user.password_hash))
      if (!ok || user.disabled) {
        await failed(req, email, 'password', user?.disabled ? 'disabled' : 'bad_credentials')
        throw new HttpError(401, 'Email or password is incorrect.')
      }
      if (needsRehash(user.password_hash)) await repos.users.update(user.id, { password_hash: await hashPassword(password) })
      if (!user.verified) {
        await failed(req, email, 'password', 'unverified')
        return res.status(403).json({
          error: { code: 'UNVERIFIED', message: 'This account is not verified yet.' },
          email,
          devCode: await issueCode(email, 'verification', config.auth.otpTtlMinutes),
        })
      }
      res.json({ session: await startSession(req, res, user, 'password') })
    })
  )

  r.post(
    '/google',
    limiter,
    route(async (req, res) => {
      let profile
      if (config.auth.googleClientId) {
        profile = await verifyGoogleCredential(field(req.body, 'credential', { max: 4096 }), config.auth.googleClientId)
      } else if (!config.isProd && req.body?.demo) {
        profile = { email: 'demo.user@inspironics.net', name: 'Demo User', picture: null }
      } else {
        throw new HttpError(503, 'Google sign-in is not configured on this server.')
      }
      const email = normaliseEmail(profile.email)
      let user = await repos.users.findByEmail(email)
      if (user?.disabled) {
        await failed(req, email, 'google', 'disabled')
        throw new HttpError(403, 'This account is disabled.')
      }
      if (!user) {
        if (!config.auth.allowRegistration) {
          await failed(req, email, 'google', 'no_account')
          throw new HttpError(403, 'No account for that Google identity — ask an administrator.')
        }
        user = await repos.users.create({ email, name: profile.name || email, provider: 'google', verified: true, picture: profile.picture })
      } else {
        await repos.users.update(user.id, { verified: true, picture: profile.picture || user.picture })
      }
      res.json({ session: await startSession(req, res, user, 'google') })
    })
  )

  r.post(
    '/guest',
    limiter,
    route(async (req, res) => {
      if (!config.auth.guestEnabled) throw new HttpError(403, 'Guest access is disabled.')
      res.json({ session: await startSession(req, res, await repos.users.guest(), 'guest') })
    })
  )

  r.post(
    '/forgot',
    limiter,
    route(async (req, res) => {
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const user = await repos.users.findByEmail(email)
      // the same answer either way, so the response cannot enumerate accounts
      const devToken = user && !user.disabled ? await issueCode(email, 'reset', config.auth.resetTtlMinutes) : null
      res.json({ email, devToken })
    })
  )

  r.post(
    '/reset',
    limiter,
    route(async (req, res) => {
      const email = normaliseEmail(field(req.body, 'email', { max: 254 }))
      const token = field(req.body, 'token', { max: 12 })
      const password = field(req.body, 'password', { max: 200 })
      const issues = passwordIssues(password)
      if (issues.length) throw badRequest(`Password needs ${issues.join(', ')}.`)
      const result = await repos.codes.consume(email, 'reset', token, config.auth.maxCodeAttempts)
      if (!result.ok) throw codeError(result)
      const user = await repos.users.findByEmail(email)
      if (!user) throw badRequest('That account no longer exists — please register again.')
      await repos.users.update(user.id, { password_hash: await hashPassword(password), verified: true })
      // a reset ends every other session: that is usually why someone resets
      await repos.sessions.revokeForUser(user.id)
      res.json({ email })
    })
  )

  r.post(
    '/logout',
    route(async (req, res) => {
      if (req.sessionToken) await repos.sessions.revoke(req.sessionToken)
      res.clearCookie(config.auth.cookieName, sessionCookieOptions(config))
      res.json({ ok: true })
    })
  )

  r.get('/me', requireAuth, (req, res) => res.json({ user: req.user }))

  return r
}

export function sessionBody(user, issuedAt, expiresAt) {
  return {
    user: { id: user.id, email: user.email, name: user.name, picture: user.picture || null, role: user.role },
    isGuest: user.role === ROLES.GUEST,
    issuedAt: issuedAt ?? Date.now(),
    expiresAt,
  }
}

/**
 * Verify a Google Identity Services ID token with Google's tokeninfo endpoint:
 * signature, expiry and issuer are checked there; audience and email
 * verification are checked here.
 */
async function verifyGoogleCredential(credential, clientId) {
  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`)
  if (!res.ok) throw new HttpError(401, 'Google could not verify that sign-in.')
  const info = await res.json()
  if (info.aud !== clientId) throw new HttpError(401, 'That Google sign-in was issued for a different app.')
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new HttpError(401, 'Unexpected Google issuer.')
  if (info.email_verified !== 'true' && info.email_verified !== true) throw new HttpError(401, 'That Google account email is not verified.')
  return { email: info.email, name: info.name, picture: info.picture }
}
