/**
 * Authentication and RBAC.
 *
 * Every Dropbox administrative endpoint is behind requireAdmin. The client
 * also hides those screens from non-admins, but that is a convenience — this
 * is the check that actually matters, because a client check is advice and a
 * server check is policy (spec §47).
 */
import { UserRepository } from '../db/repositories/userRepository.js';

export const ROLE = { ADMIN: 'admin', USER: 'user' };

/** The caller's IP, honouring a proxy header only when one is configured. */
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (req.app?.get('trust proxy') && typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress ?? '';
}

/**
 * Resolves the session cookie into req.user. Never rejects — routes decide
 * whether anonymous is acceptable.
 */
export function attachUser({ sessions, users, cookieName }) {
  return async (req, _res, next) => {
    req.user = null;
    req.sessionToken = null;
    try {
      const token = req.cookies?.[cookieName];
      if (!token) return next();

      const session = await sessions.resolve(token);
      if (!session) return next();

      const user = await users.findById(session.user_id);
      if (!user || user.status !== 'active') return next();

      req.user = UserRepository.sanitize(user);
      req.sessionToken = token;
      return next();
    } catch (error) {
      return next(error);
    }
  };
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    res.status(401).json({ error: 'Sign in to continue.' });
    return;
  }
  if (req.user.role !== ROLE.ADMIN) {
    // 403, not 404: the caller is authenticated and the resource exists, they
    // simply may not have it. Hiding that would make support harder without
    // making anything safer, since the route list is in the client bundle.
    res.status(403).json({ error: 'Administrator role required.' });
    return;
  }
  next();
}

/** Cookie options shared by login and logout, so they cannot drift apart. */
export function sessionCookieOptions(config, { expires } = {}) {
  return {
    httpOnly: true,
    secure: config.session.secure,
    sameSite: config.session.sameSite,
    path: '/',
    ...(expires ? { expires: new Date(expires) } : {}),
  };
}
