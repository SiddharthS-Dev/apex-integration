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
