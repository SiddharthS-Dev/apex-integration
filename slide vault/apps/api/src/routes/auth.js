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
import { createRateLimiter, byLoginTarget } from '../http/rateLimit.js';
import { requireEmail, requireString, optionalString } from '../http/validate.js';
import { ROLES, UserRepository, verifyPassword } from '../db/repositories/userRepository.js';
import { AUDIT } from '../services/audit/AuditService.js';

export function createAuthRouter({ config, users, sessions, loginHistory, audit, googleAuth }) {
  const router = Router();

  // Slow enough to make guessing pointless, generous enough that a person who
  // mistypes their password three times is not locked out.
  const loginLimiter = createRateLimiter({
    windowMs: 15 * 60_000,
    max: 10,
    keyFn: byLoginTarget,
    message: 'Too many sign-in attempts. Try again in a few minutes.',
  });

  router.post(
    '/login',
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
    });
  });

  /* ------------------------------------------------------ google sign-in */

  /** Sends the browser to Google. A redirect, not JSON, so it is a plain link. */
  router.get(
    '/google/start',
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
    asyncHandler(async (req, res) => {
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
