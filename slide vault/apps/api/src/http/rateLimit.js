/**
 * In-memory fixed-window rate limiting.
 *
 * Enough to stop a login-guessing loop or a runaway client from turning into
 * Dropbox API spend. It is per-instance by design: behind several instances
 * the effective limit multiplies, which is the acceptable trade for having no
 * shared dependency. A deployment that needs exact global limits should put
 * them at the ingress.
 */

/**
 * @param {object} options
 * @param {number} options.windowMs
 * @param {number} options.max
 * @param {(req) => string|null} options.keyFn   null skips the limiter
 * @param {string} [options.message]
 * @param {(req, res) => boolean} [options.countIf]
 *   When given, a request is counted only once its response is known and only
 *   if this returns true — e.g. only failed sign-ins. Requests are still
 *   refused once the bucket is full.
 */
export function createRateLimiter({ windowMs, max, keyFn, message = 'Too many requests. Slow down.', countIf }) {
  /** @type {Map<string, {count: number, resetAt: number}>} */
  const buckets = new Map();

  // Bounded memory: without this, a scan from many source addresses would
  // grow the map indefinitely.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }, Math.max(windowMs, 30_000));
  sweep.unref?.();

  const refuse = (res, bucket, now) => {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.status(429).json({ error: message, retryAfterSeconds: retryAfter });
  };

  const bump = (key, now) => {
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      const fresh = { count: 1, resetAt: now + windowMs };
      buckets.set(key, fresh);
      return fresh;
    }
    bucket.count += 1;
    return bucket;
  };

  const middleware = (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();

    if (countIf) {
      const bucket = buckets.get(key);
      if (bucket && bucket.resetAt > now && bucket.count >= max) {
        refuse(res, bucket, now);
        return undefined;
      }
      res.on('finish', () => {
        if (countIf(req, res)) bump(key, Date.now());
      });
      return next();
    }

    const bucket = bump(key, now);
    if (bucket.count > max) {
      refuse(res, bucket, now);
      return undefined;
    }

    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - bucket.count)));
    return next();
  };

  middleware.reset = () => buckets.clear();
  middleware.stop = () => clearInterval(sweep);
  return middleware;
}

import { clientIp } from './auth.js';

export const byIp = (req) => clientIp(req) || 'unknown';

/** Keyed by user when signed in, so one noisy admin cannot lock out an office. */
export const byUserOrIp = (req) => req.user?.id ?? clientIp(req) ?? 'unknown';

/**
 * Login attempts are keyed by IP *and* the email being tried, so one source
 * hammering an account cannot lock its owner out from somewhere else.
 * clientIp is req.ip, which honours X-Forwarded-For only as far as "trust
 * proxy" allows — behind the gateway, the real client; never a header value
 * the client chose.
 */
export const byLoginTarget = (req) =>
  `${clientIp(req) || 'unknown'}:${loginEmail(req)}`;

/** The account being signed into, across every source address. */
export const byLoginAccount = (req) => {
  const email = loginEmail(req);
  return email ? `account:${email}` : null;
};

const loginEmail = (req) => String(req.body?.email ?? '').trim().toLowerCase();
