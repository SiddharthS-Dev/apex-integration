/**
 * Session authentication.
 *
 * Small on purpose — this exists so the Dropbox layer has a real identity to
 * enforce RBAC against, and so the end-to-end scenario (admin signs in,
 * connects Dropbox, a user opens a file) is demonstrable against one backend.
 */
import { Router } from 'express';
import { asyncHandler } from '../http/errors.js';
import { clientIp, requireAuth, sessionCookieOptions } from '../http/auth.js';
import { createRateLimiter, byIp, byLoginAccount, byLoginTarget } from '../http/rateLimit.js';
import { requireEmail, requireString, optionalString } from '../http/validate.js';
import { ROLES, UserRepository, hasPassword, hashPassword, needsRehash, verifyPassword } from '../db/repositories/userRepository.js';
import { AUDIT } from '../services/audit/AuditService.js';
import { SERVICE_HEADER, currentSigningKey, issueLinkProof, verifyAssertion } from '../http/apexIdentity.js';

/** A real scrypt hash to compare against when there is no password, so every answer takes as long. */
let dummyHash;
const dummyPasswordHash = () => (dummyHash ??= hashPassword('dummy-password-for-timing'));

/**
 * The sign-in limiters. One set per app, shared by the password sign-in and the
 * Apex account-ownership check (createApexLinkRouter), so neither can be used to
 * get round the other's limits.
 */
export function createLoginLimiters() {
  return {
    // Slow enough to make guessing pointless, generous enough that a person who
    // mistypes their password three times is not locked out.
    loginLimiter: createRateLimiter({
      windowMs: 15 * 60_000,
      max: 10,
      keyFn: byLoginTarget,
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    }),

    // A softer, per-account ceiling across every address — the defence against
    // a guessing run spread over many IPs. It counts *failed* attempts only and
    // sits well above what a person mistyping produces, so the account owner
    // signing in correctly is never the one who trips it, and an attacker needs
    // a sustained run (not a handful of requests) to make the account wait.
    accountLimiter: createRateLimiter({
      windowMs: 15 * 60_000,
      max: 50,
      keyFn: byLoginAccount,
      countIf: (_req, res) => res.statusCode === 401,
      message: 'Too many failed sign-in attempts for this account. Try again in a few minutes.',
    }),

    // And a ceiling per source address across every account, so one client
    // cannot spray a password over the whole user list.
    sourceLimiter: createRateLimiter({
      windowMs: 15 * 60_000,
      max: 100,
      keyFn: byIp,
      countIf: (_req, res) => res.statusCode === 401,
      message: 'Too many sign-in attempts. Try again in a few minutes.',
    }),
  };
}

export function createAuthRouter({ config, users, sessions, loginHistory, audit, googleAuth, ai, loginLimiters }) {
  const router = Router();
  const { loginLimiter, accountLimiter, sourceLimiter } = loginLimiters || createLoginLimiters();

  /**
   * In Apex identity 'required' mode the Core is the only sign-in: this app's
   * own password, Google and registration routes answer 403.
   */
  const legacyOnly = (req, res, next) => {
    if (config.identity?.mode === 'required') {
      res.status(403).json({ error: 'Sign in through Apex — SlidesVault no longer has its own sign-in.', code: 'APEX_SIGNIN_ONLY' });
      return;
    }
    next();
  };

  router.post(
    '/login',
    legacyOnly,
    sourceLimiter,
    accountLimiter,
    loginLimiter,
    asyncHandler(async (req, res) => {
      const email = requireEmail(req.body?.email);
      const password = requireString(req.body?.password, 'password', { maxLength: 200 });

      const user = await users.findByEmail(email);
      const ok = user && user.status === 'active' && (await verifyPassword(password, user.password_hash));

      if (!ok) {
        await loginHistory.record({ email, status: 'failed', ip: clientIp(req) });
        await audit.record({
          actorEmail: email,
          action: AUDIT.LOGIN_FAILED,
          outcome: 'failure',
          ip: clientIp(req),
        });
        // One message for "no such user" and "wrong password": distinguishing
        // them tells an attacker which addresses are worth attacking.
        res.status(401).json({ error: 'That email address and password do not match.' });
        return;
      }

      const { token, expiresAt } = await sessions.create({
        userId: user.id,
        ttlHours: config.session.ttlHours,
        ip: clientIp(req),
        userAgent: req.headers['user-agent'] ?? '',
      });

      await users.touchLogin(user.id);
      // The password is known to be right: upgrade a hash made with older scrypt parameters.
      if (needsRehash(user.password_hash)) await users.setPassword(user.id, password);
      await loginHistory.record({
        userId: user.id,
        userName: user.full_name,
        email: user.email,
        status: 'success',
        ip: clientIp(req),
      });
      await audit.record({
        actorId: user.id,
        actorEmail: user.email,
        action: AUDIT.LOGIN,
        ip: clientIp(req),
      });

      res.cookie(config.session.cookieName, token, sessionCookieOptions(config, { expires: expiresAt }));
      res.json({ user: UserRepository.sanitize(user) });
    })
  );

  /**
   * What sign-in methods this deployment actually offers.
   *
   * Unauthenticated by design: the sign-in screen has to render before anyone
   * has a session, and it says nothing an attacker could not learn by pressing
   * the button. It exists so the client stops advertising a method that cannot
   * work — the state this replaced, where "Continue with Google" was always
   * shown and always failed.
   */
  router.get('/config', (req, res) => {
    res.json({
      password: true,
      google: Boolean(googleAuth?.configured),
      registration: Boolean(config.allowRegistration && config.identity?.mode !== 'required'),
      // Whether the library Copilot can answer — AI_ENABLED with a key. The
      // client hides the Copilot otherwise instead of showing it "online".
      ai: Boolean(config.ai.enabled && ai?.available),
    });
  });

  /* ------------------------------------------------------ google sign-in */

  /** Sends the browser to Google. A redirect, not JSON, so it is a plain link. */
  router.get(
    '/google/start',
    legacyOnly,
    asyncHandler(async (req, res) => {
      const { url } = await googleAuth.buildAuthUrl({
        redirectAfter: optionalString(req.query.next, 'next', { maxLength: 300 }) || '',
      });
      res.redirect(url);
    })
  );

  /**
   * Where Google sends the browser back.
   *
   * This is a top-level navigation, so a failure has to end somewhere a person
   * can read — the sign-in page — rather than as a JSON body rendered raw in
   * the address bar.
   */
  router.get(
    '/google/callback',
    legacyOnly,
    asyncHandler(async (req, res) => {
      const backToLogin = (message) =>
        res.redirect(`${config.appBaseUrl}/login?error=${encodeURIComponent(message)}`);

      // The visitor pressed "Cancel" on Google's consent screen.
      if (req.query.error) {
        return backToLogin(
          req.query.error === 'access_denied'
            ? 'Google sign-in was cancelled.'
            : 'Google could not complete the sign-in.'
        );
      }

      let result;
      try {
        result = await googleAuth.handleCallback({
          code: optionalString(req.query.code, 'code', { maxLength: 2048 }),
          state: optionalString(req.query.state, 'state', { maxLength: 512 }),
          ip: clientIp(req),
          userAgent: req.headers['user-agent'] ?? '',
        });
      } catch (error) {
        // GoogleAuthError messages are written for the person who hit them;
        // anything else is ours and is not described to a visitor.
        return backToLogin(
          error?.name === 'GoogleAuthError' ? error.message : 'Google sign-in failed. Try again.'
        );
      }

      res.cookie(
        config.session.cookieName,
        result.token,
        sessionCookieOptions(config, { expires: result.expiresAt })
      );

      // Only a path from this app — an absolute URL here would turn the
      // callback into an open redirect that borrows our domain's credibility.
      const next =
        result.redirectAfter.startsWith('/') && !result.redirectAfter.startsWith('//')
          ? result.redirectAfter
          : '/';
      res.redirect(`${config.appBaseUrl}${next}`);
    })
  );

  router.post(
    '/logout',
    asyncHandler(async (req, res) => {
      if (req.sessionToken) await sessions.revoke(req.sessionToken);
      if (req.user) {
        await audit.record({
          actorId: req.user.id,
          actorEmail: req.user.email,
          action: AUDIT.LOGOUT,
          ip: clientIp(req),
        });
      }
      res.clearCookie(config.session.cookieName, sessionCookieOptions(config));
      res.json({ ok: true });
    })
  );

  router.get(
    '/me',
    asyncHandler(async (req, res) => {
      if (!req.user) {
        res.status(401).json({ error: 'Not signed in.' });
        return;
      }
      res.json(req.user);
    })
  );

  /**
   * Self-service registration, always as a plain user.
   *
   * A registration endpoint that accepted a role would be a privilege
   * escalation hole; admins are promoted deliberately, by an admin.
   */
  router.post(
    '/register',
    legacyOnly,
    asyncHandler(async (req, res) => {
      if (!config.allowRegistration) {
        res.status(403).json({
          error: 'Registration is closed. Ask an administrator for an account.',
          code: 'REGISTRATION_CLOSED',
        });
        return;
      }
      const email = requireEmail(req.body?.email);
      const password = requireString(req.body?.password, 'password', { minLength: 10, maxLength: 200 });
      const fullName = optionalString(req.body?.full_name ?? req.body?.fullName, 'full_name', { maxLength: 120 });

      if (await users.findByEmail(email)) {
        res.status(409).json({ error: 'An account with that email already exists.' });
        return;
      }

      const user = await users.create({ email, password, fullName, role: ROLES.USER });
      res.status(201).json({ user: UserRepository.sanitize(user) });
    })
  );

  router.get(
    '/users',
    requireAuth,
    asyncHandler(async (req, res) => {
      if (req.user.role !== ROLES.ADMIN) {
        res.status(403).json({ error: 'Administrator role required.' });
        return;
      }
      res.json(await users.list({ limit: 500 }));
    })
  );

  return router;
}

/**
 * /api/apex — routes only the Apex gateway may call (R1 linking addendum).
 *
 * POST /api/apex/link-proof { email, password, challenge_id } -> 200 { proof }
 *
 * The account-holder ownership check: someone linking this SlidesVault account
 * to their Apex account types its password, and the gateway asks here. Available
 * in every identity mode (required too, where /auth/login answers 403), but only
 * from APEX_IDENTITY_TRUSTED_SOURCES (the TCP peer, never X-Forwarded-For) with
 * the gateway's X-Apex-Service credential signed with this app's key — anything
 * else is 403; no keys at all is 503. The password is checked as the sign-in
 * checks it, behind the very same limiters (per address and email, per account,
 * per address), and nothing else happens: no session, no cookie, the account row
 * untouched. The proof is signed with this app's current key:
 *   { iss: 'slidesvault', aud: 'apex-link', app_user_id, challenge_id, iat, exp: iat + 60 }
 */
export function createApexLinkRouter({ config, users, loginHistory, audit, logger, loginLimiters }) {
  const router = Router();
  const { sourceLimiter, accountLimiter, loginLimiter } = loginLimiters || createLoginLimiters();
  const id = config.identity || {};

  const refuse = (res, status, error, code) => res.status(status).json({ error, code });

  /** Only the gateway: a trusted source address and a valid X-Apex-Service for this app. */
  const fromGateway = (req, res, next) => {
    const peer = req.socket?.remoteAddress;
    if (!id.trustedSources?.matches(peer)) return refuse(res, 403, 'Only the Apex gateway may ask this.', 'APEX_GATEWAY_ONLY');
    if (!id.keys?.size) {
      return refuse(res, 503, 'Account linking is not set up on this server (no Apex identity keys).', 'APEX_LINK_UNAVAILABLE');
    }
    const check = verifyAssertion(req.headers[SERVICE_HEADER], {
      keys: id.keys,
      audience: id.audience,
      issuer: id.issuer,
      requireSubject: false,
      sourceAddress: peer,
      trustedSources: id.trustedSources,
    });
    if (!check.ok) {
      logger?.warn?.('Apex service credential refused on link-proof', { reason: check.reason, peer });
      return refuse(res, 403, 'Only the Apex gateway may ask this.', 'APEX_GATEWAY_ONLY');
    }
    return next();
  };

  router.post(
    '/link-proof',
    fromGateway,
    sourceLimiter,
    accountLimiter,
    loginLimiter,
    asyncHandler(async (req, res) => {
      const email = requireEmail(req.body?.email);
      const password = requireString(req.body?.password, 'password', { maxLength: 200 });
      const challengeId = requireString(req.body?.challenge_id, 'challenge_id', { maxLength: 128 });
      if (!/^[A-Za-z0-9_.:-]{1,128}$/.test(challengeId)) {
        res.status(400).json({ error: 'challenge_id is not valid.' });
        return;
      }

      const user = await users.findByEmail(email);
      const usable = hasPassword(user);
      // Always one scrypt, so an unknown email or a passwordless account answers no faster.
      const matches = (await verifyPassword(password, usable ? user.password_hash : await dummyPasswordHash())) && usable;
      const failed = async (reason) => {
        await loginHistory.record({ email, status: 'failed', ip: clientIp(req) });
        await audit.record({ actorEmail: email, action: AUDIT.LOGIN_FAILED, outcome: 'failure', ip: clientIp(req), details: { via: 'apex-link', reason } });
      };

      if (user && !usable) {
        await failed('no_password');
        refuse(res, 422, 'This SlidesVault account has no password (it signs in with Google), so it cannot be linked with a password.', 'NO_PASSWORD');
        return;
      }
      if (!matches) {
        await failed('bad_credentials');
        // 401 is what the account and source limiters count.
        res.status(401).json({ error: 'That email address and password do not match.' });
        return;
      }
      if (user.status !== 'active') {
        await failed('inactive');
        refuse(res, 403, 'This SlidesVault account is deactivated, so it cannot be linked.', 'APEX_LINK_DISABLED');
        return;
      }

      const signing = currentSigningKey(id.keys, id.kid);
      const proof = issueLinkProof({ app: id.audience, kid: signing.kid, key: signing.key, appUserId: user.id, challengeId });
      logger?.info?.('Account ownership proven for Apex linking', { userId: user.id });
      res.json({ proof });
    })
  );

  return router;
}
