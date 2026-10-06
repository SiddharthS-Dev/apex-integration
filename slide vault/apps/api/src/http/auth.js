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

/**
 * The caller's IP, honouring X-Forwarded-For only as far as "trust proxy" says.
 *
 * req.ip is Express's answer: it walks X-Forwarded-For from the right and
 * stops at the first hop that is not trusted. Taking the *leftmost* entry
 * instead — what this used to do — reads a value the client wrote itself,
 * since a proxy appends to whatever header it was sent; any caller could then
 * pick a fresh address per request and walk straight past the rate limiter.
 */
export function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || '';
}

/**
 * Resolves the session cookie into req.user. Never rejects — routes decide
 * whether anonymous is acceptable.
 */
export function attachUser({ sessions, users, cookieName, activityTouchMs = 5 * 60_000 }) {
  // Users whose last_active_at write is in flight, so a burst of parallel
  // requests from one page load does not become a burst of UPDATEs.
  const touching = new Set();

  const touchActivity = (user) => {
    const last = user.last_active_at ? Date.parse(user.last_active_at) : 0;
    if (Date.now() - last < activityTouchMs || touching.has(user.id)) return;
    touching.add(user.id);
    // Fire and forget: presence is a statistic, never a reason to fail a request.
    Promise.resolve(users.touchActive?.(user.id))
      .catch(() => {})
      .finally(() => touching.delete(user.id));
  };

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

      touchActivity(user);
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
