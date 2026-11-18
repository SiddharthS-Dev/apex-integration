/**
 * Authentication and RBAC.
 *
 * Every Dropbox administrative endpoint is behind requireAdmin. The client
 * also hides those screens from non-admins, but that is a convenience — this
 * is the check that actually matters, because a client check is advice and a
 * server check is policy (spec §47).
 */
import { UserRepository } from '../db/repositories/userRepository.js';
import { IdentityError } from './identity.js';

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
 *
 * With Apex identity assertion on (`identity`, from ./identity.js; mode
 * optional|required), a verified X-Apex-Identity header decides req.user and
 * req.identity instead, and that does reject: a present-but-invalid header is
 * 401, no role is 403, and in required mode a non-public /api request without
 * one is 401. The cookie is consulted only in optional mode, and only when no
 * header is present. Off (the default) changes nothing.
 */
export function attachUser({ sessions, users, cookieName, activityTouchMs = 5 * 60_000, identity = null }) {
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

  const gate = identity && identity.mode !== 'off' ? identity : null;

  return async (req, res, next) => {
    req.user = null;
    req.sessionToken = null;
    req.identity = null;
    try {
      if (gate && gate.isApi(req.path)) {
        let asserted;
        try {
          asserted = await gate.authenticate(req);
        } catch (error) {
          if (!(error instanceof IdentityError)) throw error;
          res.status(error.status).json({ error: error.message, code: error.code });
          return;
        }
        if (asserted) {
          touchActivity(asserted.row);
          // The role is this request's only; app_user.role is never touched.
          req.user = { ...UserRepository.sanitize(asserted.row), role: asserted.role };
          req.identity = asserted.claims;
          return next();
        }
        if (gate.mode === 'required') {
          if (gate.isPublic(req.path)) return next();
          res.status(401).json({ error: 'Sign in through Apex to continue.', code: 'APEX_IDENTITY_REQUIRED' });
          return;
        }
      }

      // In required mode the legacy cookie session is never consulted, on any path or spelling:
      // only a verified assertion identifies anyone.
      if (gate && gate.mode === 'required') return next();

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
