/**
 * Apex identity assertion (R1 identity contract §4.4).
 *
 * Behind the Apex gateway, every API request may carry X-Apex-Identity: a
 * short-lived assertion, signed with this app's own key, of which Core user
 * is asking and with which roles. APEX_IDENTITY_MODE decides what it means:
 *
 *   off       (default) the header is ignored; sign-in works exactly as before
 *   optional  a valid header is that identity; a present-but-invalid one is 401;
 *             no header falls back to the session cookie
 *   required  every /api route except health and the routes already public
 *             requires a valid header; the app's own sign-in routes answer 403
 *
 * The asserted roles decide the role for this request only — they are never
 * written to the users table: platform_admin, or app_admin scoped to
 * 'showcase', is admin; any other role is viewer; no role at all is 403.
 * Object-level rules downstream are unchanged.
 */
import { ROLES } from '@inspironics/shared'
import { HttpError } from '../lib/http.js'
import { IDENTITY_HEADER, accessFor, verifyAssertion } from '../lib/apexIdentity.js'
import { toUser } from '../repos/auth.js'

/** The app's own ways in. In required mode each answers 403: the Core is the only sign-in. */
export const LEGACY_SIGN_IN_PATHS = Object.freeze([
  '/auth/register',
  '/auth/resend',
  '/auth/verify',
  '/auth/login',
  '/auth/google',
  '/auth/guest',
  '/auth/forgot',
  '/auth/reset',
])

/**
 * Paths (under /api) that answer without a session today, and so need no
 * assertion in required mode either. A header that is present is still
 * verified on them.
 */
export const PUBLIC_PATHS = Object.freeze(
  new Set(['/health', '/auth/config', '/auth/session', '/auth/logout', '/entities/plates/count', '/dropbox/oauth/callback', ...LEGACY_SIGN_IN_PATHS])
)

const clean = (p) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

export function createIdentityGate({ config, repos, log }) {
  const id = config.identity
  const mode = id.mode

  /** The local account for asserted claims: linked id, then core_user_id, then a new passwordless one. */
  async function localUser(claims) {
    if (claims.app_user_id) {
      const row = await repos.users.findById(claims.app_user_id)
      if (!row || row.role === ROLES.GUEST) throw new HttpError(403, 'The account linked to your Apex user does not exist here.', 'APEX_LINK_MISSING')
      return row
    }
    return (await repos.users.findByCoreUserId(claims.sub)) || repos.users.createFromCore({ coreUserId: claims.sub, email: claims.email, name: claims.name })
  }

  return {
    mode,
    isPublic: (path) => PUBLIC_PATHS.has(clean(path)),

    /**
     * null when the request carries no assertion; otherwise the verified
     * `{ user, claims }`, or an HttpError thrown (401 invalid, 403 no role or
     * disabled account).
     */
    async authenticate(req) {
      const header = req.headers[IDENTITY_HEADER]
      if (header === undefined) return null
      const result = verifyAssertion(header, {
        keys: id.keys,
        audience: id.audience,
        issuer: id.issuer,
        // The TCP peer — the gateway — never X-Forwarded-For, which names the browser.
        sourceAddress: req.socket?.remoteAddress,
        trustedSources: id.trustedSources,
      })
      if (!result.ok) {
        log?.warn?.('Apex identity assertion refused', { reason: result.reason, peer: req.socket?.remoteAddress })
        throw new HttpError(401, 'The Apex identity on this request could not be verified.', 'APEX_IDENTITY_INVALID')
      }
      const access = accessFor(result.claims.roles, id.audience)
      if (!access) throw new HttpError(403, 'Your Apex account has no role that gives access to the Showcase.', 'APEX_NO_ROLE')
      const row = await localUser(result.claims)
      if (!row || row.disabled) throw new HttpError(403, 'This account is disabled here.', 'APEX_ACCOUNT_DISABLED')
      return { user: { ...toUser(row), role: access === 'admin' ? ROLES.ADMIN : ROLES.VIEWER }, claims: result.claims }
    },
  }
}
