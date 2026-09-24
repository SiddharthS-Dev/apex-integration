/**
 * Google sign-in (OpenID Connect authorization-code flow).
 *
 * The browser never handles a Google token. It is redirected to Google, Google
 * redirects back here with a one-time code, and this service exchanges that
 * code server-to-server using the client secret. What the browser ends up with
 * is the same http-only session cookie that password sign-in issues, so every
 * downstream check (requireAuth, requireAdmin, RBAC) is unchanged and unaware
 * of how the session was obtained.
 *
 * Who is allowed in is deliberately not "anyone with a Google account" — see
 * `resolveUser` below.
 */
import { AUDIT } from '../audit/AuditService.js';
import { ROLES } from '../../db/repositories/userRepository.js';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const ISSUERS = new Set(['https://accounts.google.com', 'accounts.google.com']);

/** Raised for every rejection a person could plausibly act on. */
export class GoogleAuthError extends Error {
  constructor(message, { status = 400, code = 'GoogleAuthError' } = {}) {
    super(message);
    this.name = 'GoogleAuthError';
    this.status = status;
    this.code = code;
    this.expose = true;
  }
}

/**
 * Reads the claims out of an ID token.
 *
 * The signature is deliberately not checked, and that is safe *only* because of
 * where this token comes from: it is the response body of our own HTTPS POST to
 * Google's token endpoint, authenticated with the client secret. Nothing
 * untrusted sits between Google and this process, so TLS already provides what
 * a signature check would — this is the case OpenID Connect §3.1.3.7 permits.
 *
 * An ID token arriving by any other route (from a browser, say) would have to
 * be verified against Google's JWKS instead. There is no such path here.
 */
function decodeIdToken(idToken) {
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new GoogleAuthError('Google returned a malformed identity token.');
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    throw new GoogleAuthError('Google returned an unreadable identity token.');
  }
}

export class GoogleAuthService {
  constructor({ config, oauthStates, users, sessions, loginHistory, audit, logger, fetchImpl = fetch }) {
    this.config = config;
    this.oauthStates = oauthStates;
    this.users = users;
    this.sessions = sessions;
    this.loginHistory = loginHistory;
    this.audit = audit;
    this.logger = logger?.child?.({ component: 'GoogleAuthService' }) ?? logger;
    this.fetchImpl = fetchImpl;
  }

  get settings() {
    return this.config.google;
  }

  /** Enabled *and* actually usable. The login screen shows the button on this. */
  get configured() {
    const { enabled, clientId, clientSecret } = this.settings;
    return Boolean(enabled && clientId && clientSecret);
  }

  assertConfigured() {
    if (!this.settings.enabled) {
      throw new GoogleAuthError('Google sign-in is not enabled for this application.', { status: 404 });
    }
    if (!this.configured) {
      throw new GoogleAuthError(
        'Google sign-in is enabled but not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
        { status: 503 }
      );
    }
  }

  /**
   * The URL to send the browser to, with a single-use `state` recorded first.
   *
   * `state` is what makes the callback safe to act on: without it, an attacker
   * could feed the callback their own code and have the victim's browser sign
   * in as the attacker's account.
   */
  async buildAuthUrl({ redirectAfter = '' } = {}) {
    this.assertConfigured();

    const { state, expiresAt } = await this.oauthStates.issue({
      provider: 'google',
      redirectAfter,
      ttlMinutes: this.settings.stateTtlMinutes,
    });

    const params = new URLSearchParams({
      client_id: this.settings.clientId,
      redirect_uri: this.settings.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      state,
      // No refresh token is wanted: this is a sign-in, not delegated access to
      // the person's Google data. Nothing here ever calls Google again on
      // their behalf, so asking for offline access would be storing a
      // long-lived credential with no use for it.
      access_type: 'online',
      prompt: 'select_account',
      include_granted_scopes: 'true',
    });

    return { url: `${AUTH_ENDPOINT}?${params}`, expiresAt };
  }

  /** Trades the authorization code for tokens, server-to-server. */
  async exchangeCode(code) {
    let response;
    try {
      response = await this.fetchImpl(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: this.settings.clientId,
          client_secret: this.settings.clientSecret,
          redirect_uri: this.settings.redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });
    } catch (error) {
      throw new GoogleAuthError('Could not reach Google to complete sign-in. Try again.', {
        status: 502,
      });
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      // Google's own description names the misconfiguration (a redirect_uri
      // mismatch, most often), which is exactly what the administrator needs;
      // it is logged rather than shown, because it is not the visitor's problem.
      this.logger?.warn?.('Google token exchange failed', {
        status: response.status,
        error: payload?.error,
        description: payload?.error_description,
      });
      if (payload?.error === 'invalid_grant') {
        throw new GoogleAuthError('That sign-in link has already been used or has expired. Try again.');
      }
      throw new GoogleAuthError('Google rejected the sign-in attempt. Contact your administrator.', {
        status: 502,
      });
    }

    if (!payload?.id_token) {
      throw new GoogleAuthError('Google did not return an identity token.', { status: 502 });
    }
    return payload;
  }

  /** Validates the claims this application relies on. */
  verifyClaims(claims) {
    if (!ISSUERS.has(String(claims.iss))) {
      throw new GoogleAuthError('That identity token was not issued by Google.', { status: 401 });
    }
    if (String(claims.aud) !== this.settings.clientId) {
      throw new GoogleAuthError('That identity token was issued for a different application.', {
        status: 401,
      });
    }
    if (Number(claims.exp) * 1000 < Date.now()) {
      throw new GoogleAuthError('That sign-in took too long to complete. Try again.');
    }

    const email = String(claims.email || '').trim().toLowerCase();
    if (!email) throw new GoogleAuthError('That Google account has no email address.');

    // Without this check, anyone could attach an unverified address they do not
    // own to a fresh Google account and be matched to an existing user here —
    // including an administrator.
    if (claims.email_verified !== true && claims.email_verified !== 'true') {
      throw new GoogleAuthError('That Google account has an unverified email address.', { status: 403 });
    }

    return { email, fullName: String(claims.name || '').trim() };
  }

  /** True when the address passes the configured domain filter. */
  domainAllowed(email) {
    const { allowedDomains } = this.settings;
    if (allowedDomains.length === 0) return true;
    return allowedDomains.includes(email.slice(email.lastIndexOf('@') + 1));
  }

  /**
   * Maps a verified Google identity onto a local account.
   *
   * Two independent gates, because Google proves *who someone is*, never that
   * they should have access to this library:
   *  - the domain filter, when one is configured; and
   *  - auto-creation, which is off by default, so out of the box Google is a
   *    second way to sign in to an account an administrator already made, not
   *    a way to obtain one.
   */
  async resolveUser({ email, fullName }) {
    if (!this.domainAllowed(email)) {
      throw new GoogleAuthError('That Google account is not permitted to sign in here.', { status: 403 });
    }

    const existing = await this.users.findByEmail(email);
    if (existing) {
      if (existing.status !== 'active') {
        throw new GoogleAuthError('That account has been deactivated.', { status: 403 });
      }
      // A name is filled in only when it is missing, so a deliberate local
      // edit is not overwritten every time the person signs in.
      if (!existing.full_name && fullName) {
        await this.users.updateProfile?.(existing.id, { fullName });
      }
      return { user: existing, created: false };
    }

    if (!this.settings.autoCreateUsers) {
      throw new GoogleAuthError(
        'There is no account for that address yet. Ask an administrator to create one.',
        { status: 403 }
      );
    }

    // Created without a password. verifyPassword() rejects an empty hash, so
    // the account cannot also be reached through the password form.
    const user = await this.users.create({ email, password: '', fullName, role: ROLES.USER });
    return { user, created: true };
  }

  /**
   * The whole callback, from code to session.
   *
   * @returns {Promise<{user: object, token: string, expiresAt: string, redirectAfter: string}>}
   */
  async handleCallback({ code, state, ip = '', userAgent = '' }) {
    this.assertConfigured();
    if (!code) throw new GoogleAuthError('Google did not return an authorization code.');

    const consumed = await this.oauthStates.consume(state, 'google');
    if (!consumed.ok) {
      // Replay, expiry and a forged callback are one message on purpose:
      // telling them apart only helps whoever is probing.
      throw new GoogleAuthError('That sign-in request is no longer valid. Start again from the sign-in page.');
    }

    const tokens = await this.exchangeCode(code);
    const { email, fullName } = this.verifyClaims(decodeIdToken(tokens.id_token));

    let resolved;
    try {
      resolved = await this.resolveUser({ email, fullName });
    } catch (error) {
      await this.loginHistory.record({ email, status: 'failed', ip });
      await this.audit.record({
        actorEmail: email,
        action: AUDIT.LOGIN_FAILED,
        outcome: 'failure',
        ip,
        details: { method: 'google', reason: error.message },
      });
      throw error;
    }

    const { user, created } = resolved;
    const { token, expiresAt } = await this.sessions.create({
      userId: user.id,
      ttlHours: this.config.session.ttlHours,
      ip,
      userAgent,
    });

    await this.users.touchLogin(user.id);
    await this.loginHistory.record({
      userId: user.id,
      userName: user.full_name,
      email: user.email,
      status: 'success',
      ip,
    });
    await this.audit.record({
      actorId: user.id,
      actorEmail: user.email,
      action: AUDIT.LOGIN,
      ip,
      details: { method: 'google', accountCreated: created },
    });

    return { user, token, expiresAt, redirectAfter: consumed.record.redirect_after || '' };
  }
}
