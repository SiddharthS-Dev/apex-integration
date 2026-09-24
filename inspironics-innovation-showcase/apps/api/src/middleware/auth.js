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

export function sessionCookieOptions(config, expiresAt) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.auth.cookieSecure,
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  }
}

export function loadSession({ config, repos }) {
  return async (req, res, next) => {
    try {
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
