/**
 * Security headers, the cross-origin write guard, and CORS — hand-rolled
 * because each is a few lines once the policy is decided.
 */
import { HttpError } from '../lib/http.js'

/** Headers on every response. Content routes tighten CSP further for HTML. */
export function securityHeaders({ isProd }) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
    // the viewer embeds our own content routes in an <iframe>; nobody else may
    res.setHeader('X-Frame-Options', 'SAMEORIGIN')
    if (isProd) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
    if (req.path.startsWith('/api/')) {
      res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'")
    }
    next()
  }
}

/**
 * CORS for the configured web origin(s), with credentials. Same-origin
 * deployments never trigger it; it exists for a split dev setup.
 */
export function cors({ allowedOrigins }) {
  return (req, res, next) => {
    const origin = req.headers.origin
    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Range')
        res.setHeader('Access-Control-Max-Age', '600')
        return res.status(204).end()
      }
    }
    next()
  }
}

/**
 * Refuse state-changing requests from other origins.
 *
 * SameSite=Lax already keeps the session cookie off cross-site POSTs; this is
 * the second lock. Browsers always send Origin on a cross-origin POST, so a
 * request whose Origin is present and not ours is rejected outright.
 */
export function originGuard({ allowedOrigins }) {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS'])
  return (req, res, next) => {
    if (SAFE.has(req.method)) return next()
    const origin = req.headers.origin
    if (origin && !allowedOrigins.includes(origin) && origin !== `${req.protocol}://${req.get('host')}`) {
      return next(new HttpError(403, 'Cross-origin request refused.', 'BAD_ORIGIN'))
    }
    next()
  }
}

/**
 * Fixed-window rate limiter in process memory, keyed by client IP and bucket.
 * Good enough for one instance; behind several, put a shared limit at the edge.
 */
export function rateLimit({ windowMs, max, bucket = 'default', metrics }) {
  const hits = new Map()
  const sweep = setInterval(() => {
    const now = Date.now()
    for (const [k, v] of hits) if (v.reset <= now) hits.delete(k)
  }, windowMs)
  sweep.unref()

  return (req, res, next) => {
    const key = `${bucket}:${req.ip}`
    const now = Date.now()
    let entry = hits.get(key)
    if (!entry || entry.reset <= now) {
      entry = { count: 0, reset: now + windowMs }
      hits.set(key, entry)
    }
    entry.count++
    res.setHeader('RateLimit-Limit', String(max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, max - entry.count)))
    res.setHeader('RateLimit-Reset', String(Math.ceil((entry.reset - now) / 1000)))
    if (entry.count > max) {
      metrics?.inc('rate_limited_total', { bucket })
      res.setHeader('Retry-After', String(Math.ceil((entry.reset - now) / 1000)))
      return next(new HttpError(429, 'Too many requests — slow down and try again shortly.'))
    }
    next()
  }
}
