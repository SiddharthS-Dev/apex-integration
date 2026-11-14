/**
 * Apex identity assertion (R1 identity contract §4.4).
 *
 * Behind the Apex gateway, every API request may carry X-Apex-Identity: a
 * short-lived assertion, signed with SlidesVault's own key, of which Core user
 * is asking and with which roles. APEX_IDENTITY_MODE decides what it means:
 *
 *   off       (default) the header is ignored; sign-in works exactly as before
 *   optional  a valid header is that identity; a present-but-invalid one is 401;
 *             no header falls back to the session cookie
 *   required  every /api route except health and the routes already public
 *             requires a valid header; the app's own sign-in routes answer 403
 *
 * The asserted roles decide the role for this request only — never written to
 * app_user.role: platform_admin, or app_admin scoped to 'slidesvault', is
 * admin; any other role is user; no role at all is 403. Object-level rules
 * downstream are unchanged.
 */
import { IDENTITY_HEADER, accessFor, verifyAssertion } from './apexIdentity.js';

/** The app's own ways in. In required mode each answers 403: the Core is the only sign-in. */
export const LEGACY_SIGN_IN_PATHS = Object.freeze([
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/google/start',
  '/api/auth/google/callback',
]);

/**
 * Paths that answer without a session today, and so need no assertion in
 * required mode either. A header that is present is still verified on them.
 */
export const PUBLIC_PATHS = Object.freeze(
  new Set([
    '/api/health',
    '/api/auth/config',
    '/api/auth/me',
    '/api/auth/logout',
    '/api/dropbox/oauth/callback',
    ...LEGACY_SIGN_IN_PATHS,
  ])
);

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p);

/** An identity failure, answered in the API's own `{ error }` shape. */
export class IdentityError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createIdentityGate({ config, users, logger }) {
  const id = config.identity || { mode: 'off' };

  async function localUser(claims) {
    if (claims.app_user_id) {
      const row = await users.findById(claims.app_user_id);
      if (!row) throw new IdentityError(403, 'The account linked to your Apex user does not exist here.', 'APEX_LINK_MISSING');
      return row;
    }
    return (
      (await users.findByCoreUserId(claims.sub)) ||
      users.createFromCore({ coreUserId: claims.sub, email: claims.email, fullName: claims.name || '' })
    );
  }

  return {
    mode: id.mode,
    // Express routes case-insensitively, so /API/... reaches the /api routers: compare lower-cased.
    isApi: (path) => {
      const p = String(path).toLowerCase();
      return p === '/api' || p.startsWith('/api/');
    },
    isPublic: (path) => PUBLIC_PATHS.has(clean(String(path).toLowerCase())),

    /**
     * null when the request carries no assertion; otherwise `{ user, claims }`
     * with the per-request role. Throws IdentityError (401 invalid, 403 no
     * role, missing link or inactive account).
     */
    async authenticate(req) {
      const header = req.headers[IDENTITY_HEADER];
      if (header === undefined) return null;
      const result = verifyAssertion(header, {
        keys: id.keys,
        audience: id.audience,
        issuer: id.issuer,
        // The TCP peer — the gateway — never X-Forwarded-For, which names the browser.
        sourceAddress: req.socket?.remoteAddress,
        trustedSources: id.trustedSources,
      });
      if (!result.ok) {
        logger?.warn?.('Apex identity assertion refused', { reason: result.reason, peer: req.socket?.remoteAddress });
        throw new IdentityError(401, 'The Apex identity on this request could not be verified.', 'APEX_IDENTITY_INVALID');
      }
      const access = accessFor(result.claims.roles, id.audience);
      if (!access) {
        throw new IdentityError(403, 'Your Apex account has no role that gives access to SlidesVault.', 'APEX_NO_ROLE');
      }
      const row = await localUser(result.claims);
      if (!row || row.status !== 'active') {
        throw new IdentityError(403, 'This account is disabled in SlidesVault.', 'APEX_ACCOUNT_DISABLED');
      }
      return { row, role: access === 'admin' ? 'admin' : 'user', claims: result.claims };
    },
  };
}
