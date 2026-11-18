/**
 * HTTP hardening: security headers and a CORS policy with an explicit origin
 * allow-list.
 *
 * The allow-list matters more than usual here: the API issues a session cookie
 * and serves presentation content, so a permissive `*` with credentials would
 * hand any site the ability to read the library on a signed-in user's behalf.
 */

export function securityHeaders({ isProduction }) {
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    // The API serves JSON and file bytes, never markup that should run script.
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'self'; sandbox");
    if (isProduction) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    // Credentials and file bytes must never land in a shared cache.
    res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/**
 * Relaxes the default headers for a response that carries file bytes the app
 * is meant to embed — a PDF in the viewer's iframe, a thumbnail in an <img>.
 *
 * The default policy above is written for JSON and would break both: the
 * blanket `sandbox` stops the browser's PDF viewer, and `X-Frame-Options:
 * SAMEORIGIN` blocks the iframe outright whenever the app and the API are on
 * different origins.
 *
 * The `html` case is the security-critical one. A synced .html file is
 * untrusted content from a shared folder, and serving it as ordinary
 * same-origin markup would let it run script on the API's own origin and issue
 * credentialed requests — a sync folder would become a way to call
 * /api/dropbox/disconnect as whoever opened the file. `sandbox` without
 * `allow-same-origin` puts it in an opaque origin, where it can do neither.
 */
export function setEmbeddableHeaders(res, { origins = [], isProduction, html = false } = {}) {
  const frameAncestors = ["'self'", ...origins].join(' ');

  res.removeHeader('X-Frame-Options');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader(
    'Content-Security-Policy',
    html
      ? `sandbox allow-popups; frame-ancestors ${frameAncestors}`
      : `default-src 'none'; img-src 'self' data: blob:; object-src 'self'; frame-ancestors ${frameAncestors}`
  );
  // The app may be served from a different origin than the API, so the bytes
  // must be allowed to cross. Access is still gated by the session check that
  // ran before this response was started.
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  if (isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  return res;
}

/**
 * CSRF defence in depth on top of SameSite=Lax: a state-changing request must
 * come from one of our own origins.
 *
 * - A request whose Origin (or, failing that, Referer) names a foreign origin is
 *   refused everywhere — including an opaque "null" Origin from a sandboxed
 *   frame or data: URL, which is never ours.
 * - A request that carries the session cookie but neither header is refused:
 *   every browser sends Origin on a cross-site write, so a cookie-bearing write
 *   with no Origin and no Referer is not one of our pages.
 * - Cookie-less writes (the Apex gateway's server-side sign-in, its
 *   X-Apex-Service link-proof call, requests authenticated by the gateway's
 *   identity assertion) have no session to ride on and pass. So does a
 *   header-less sign-out: the worst a forged one can do is end a session, and
 *   the gateway signs each app out with only its cookie.
 *
 * The allowed set is configuration only (CORS_ORIGINS plus the APP_BASE_URL and
 * API_BASE_URL origins). It deliberately does not trust an origin derived from
 * the Host header, which an attacker controls under DNS rebinding.
 *
 * Mount under /api: `req.path` is then relative to it.
 */
export function originGuard({ origins = [], cookieName }) {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
  const allowed = new Set(origins.map(toOrigin).filter(Boolean));

  return (req, res, next) => {
    if (SAFE.has(req.method)) return next();
    const origin = req.headers.origin || toOrigin(req.headers.referer);
    if (origin) {
      if (allowed.has(origin.replace(/\/$/, ''))) return next();
      res.status(403).json({ error: 'Cross-origin request refused.', code: 'BAD_ORIGIN' });
      return;
    }
    if (cookieName && req.cookies?.[cookieName] && req.path !== '/auth/logout') {
      res.status(403).json({ error: 'Request refused: it carries no Origin or Referer.', code: 'BAD_ORIGIN' });
      return;
    }
    next();
  };
}

/** The origin of a URL ("https://a.example:8443"), or null if it is not one. */
function toOrigin(value) {
  if (!value) return null;
  try {
    const { origin } = new URL(String(value));
    return origin && origin !== 'null' ? origin : null;
  } catch {
    return null;
  }
}

/** CORS restricted to the configured origins, with credentials allowed. */
export function cors({ origins }) {
  const allowed = new Set(origins.map((origin) => origin.replace(/\/$/, '')));

  return (req, res, next) => {
    const origin = (req.headers.origin ?? '').replace(/\/$/, '');
    if (origin && allowed.has(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') {
      // A preflight from a disallowed origin gets a 204 with no CORS headers,
      // which the browser correctly treats as a refusal.
      res.status(204).end();
      return;
    }
    next();
  };
}
