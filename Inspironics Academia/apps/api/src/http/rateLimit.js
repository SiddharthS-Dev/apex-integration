import { HttpError } from '../lib/errors.js';

// Fixed-window in-memory rate limiter, keyed by client IP (+ optional key fn). `max` may be a function of
// the request (settings read at request time, e.g. the onboarding limits).
export function rateLimit({ windowMs = 60_000, max = 10, key = () => '' , message = 'Too many requests, try again later' } = {}) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k);
  }, windowMs).unref();

  return (req, res, next) => {
    const k = `${req.ip}|${key(req)}`;
    const now = Date.now();
    let entry = hits.get(k);
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs };
      hits.set(k, entry);
    }
    entry.count += 1;
    const limit = typeof max === 'function' ? max(req) : max;
    res.setHeader('RateLimit-Remaining', Math.max(0, limit - entry.count));
    if (entry.count > limit) {
      res.setHeader('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return next(new HttpError(429, message));
    }
    next();
  };
}
