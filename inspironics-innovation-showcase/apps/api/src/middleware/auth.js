/**
 * Session loading and role checks.
 *
 * `loadSession` resolves the cookie to a user on every request (one indexed
 * lookup); `requireAuth` and `requireAdmin` are the gates. Authorisation is
 * decided here, on the server — the client's idea of the user's role only
 * changes what it renders.
 */
import { ROLES } from '@inspironics/shared'
import { HttpError } from '../lib/http.js'
import { createIdentityGate } from './identity.js'

export function sessionCookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  }
}

/**
 * With Apex identity assertion on (APEX_IDENTITY_MODE optional|required, see
 * ./identity.js), a verified X-Apex-Identity header decides `req.user` and
 * `req.identity`; the cookie is consulted only in optional mode, only when no
 * header is present. In off mode (the default) nothing changes.
 */
export function loadSession({ config, repos, log }) {
  const gate = config.identity && config.identity.mode !== 'off' ? createIdentityGate({ config, repos, log }) : null
  return async (req, res, next) => {
    try {
      req.identity = null
      if (gate) {
        const asserted = await gate.authenticate(req)
        if (asserted) {
          req.user = asserted.user
          req.identity = asserted.claims
          req.sessionToken = null
          // The gateway's session lasts as long as this app's own would (SESSION_TTL_HOURS).
          req.sessionExpiresAt = new Date(Date.now() + config.auth.sessionHours * 3600_000).toISOString()
          return next()
        }
        if (gate.mode === 'required') {
          req.user = null
          req.sessionToken = null
          req.sessionExpiresAt = null
          if (!gate.isPublic(req.path)) return next(new HttpError(401, 'Sign in through Apex to continue.', 'APEX_IDENTITY_REQUIRED'))
          return next()
        }
      }
      const token = req.cookies?.[config.auth.cookieName]
      const found = token ? await repos.sessions.resolve(token) : null
      req.user = found?.user || null
      req.sessionToken = found ? token : null
      req.sessionExpiresAt = found?.expiresAt || null
      if (token && !found) res.clearCookie(config.auth.cookieName, sessionCookieOptions(config))
      next()
    } catch (error) {
      next(error)
    }
  }
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'))
  next()
}

export function requireAdmin(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'))
  if (req.user.role !== ROLES.ADMIN) return next(new HttpError(403, 'This needs an administrator.'))
  next()
}

/** Signed-in, and not the shared guest identity — for writes that belong to a person. */
export function requireMember(req, res, next) {
  if (!req.user) return next(new HttpError(401, 'Sign in to continue.'))
  if (req.user.role === ROLES.GUEST) return next(new HttpError(403, 'Create an account to do that.'))
  next()
}
