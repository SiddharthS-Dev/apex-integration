/**
 * In-memory fixed-window rate limiting.
 *
 * Enough to stop a login-guessing loop or a runaway client from turning into
 * Dropbox API spend. It is per-instance by design: behind several instances
 * the effective limit multiplies, which is the acceptable trade for having no
 * shared dependency. A deployment that needs exact global limits should put
 * them at the ingress.
 */

export function createRateLimiter({ windowMs, max, keyFn, message = 'Too many requests. Slow down.' }) {
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

  const middleware = (req, res, next) => {
    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      res.setHeader('X-RateLimit-Remaining', String(max - 1));
      return next();
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({ error: message, retryAfterSeconds: retryAfter });
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

/** Login attempts are keyed by IP *and* the email being tried. */
export const byLoginTarget = (req) =>
  `${clientIp(req)}:${String(req.body?.email ?? '').trim().toLowerCase()}`;
