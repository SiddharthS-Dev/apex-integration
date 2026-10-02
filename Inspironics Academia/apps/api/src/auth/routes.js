import express from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import {
  countUsers, createUser, findUserByEmail, findUserById, loginHistory, publicUser, recordLogin, updateUser,
} from '../repo/users.js';
import { hashPassword, randomToken, sha256, validatePassword, verifyPassword } from './passwords.js';
import { createSession, destroySession, destroyUserSessions, requireAdmin, requireUser } from './sessions.js';

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const cleanEmail = (e) => String(e || '').trim().toLowerCase();

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 10, key: (req) => cleanEmail(req.body?.email), message: 'Too many sign-in attempts. Try again in a few minutes.' });
const sensitiveLimiter = rateLimit({ windowMs: 15 * 60_000, max: 5 });

router.get('/me', requireUser, (req, res) => res.json(req.user));

router.post('/register', sensitiveLimiter, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const { password, full_name: fullName } = req.body || {};
  if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address');
  const pwErr = validatePassword(password);
  if (pwErr) throw badRequest(pwErr);
  const first = (await countUsers()) === 0;
  if (!config.allowRegistration && !first) throw forbidden('Registration is closed. Ask an administrator for an invite.');
  if (await findUserByEmail(email)) throw badRequest('An account with this email already exists');
  // The first account, or BOOTSTRAP_ADMIN_EMAIL, becomes admin.
  const role = first || (config.bootstrapAdminEmail && email === config.bootstrapAdminEmail) ? 'admin' : 'user';
  const user = await createUser({ email, fullName, role, passwordHash: await hashPassword(password) });
  await createSession(res, user, req);
  await recordLogin({ userId: user.id, email, success: true, reason: 'register', ip: req.ip, userAgent: req.get('user-agent') });
  log.info('auth.registered', { userId: user.id, role });
  res.status(201).json({ user: publicUser(user) });
}));

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = req.body?.password;
  const user = await findUserByEmail(email);
  const ok = user && !(user.disabled === true || user.disabled === 1) && (await verifyPassword(password, user.password_hash));
  await recordLogin({ userId: user?.id, email, success: !!ok, reason: ok ? 'password' : 'invalid_credentials', ip: req.ip, userAgent: req.get('user-agent') });
  if (!ok) throw unauthorized('Invalid email or password');
  await updateUser(user.id, { last_login_at: new Date().toISOString() });
  await createSession(res, user, req);
  res.json({ user: publicUser(user) });
}));

router.post('/logout', asyncHandler(async (req, res) => {
  await destroySession(req, res);
  res.json({ ok: true });
}));

// Profile photos are small, client-resized images stored inline as data URLs ('' removes it).
const AVATAR_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_AVATAR_CHARS = 200_000;

router.patch('/me', requireUser, asyncHandler(async (req, res) => {
  const { full_name: fullName, avatar_url: avatar } = req.body || {};
  const patch = {};
  if (fullName !== undefined) {
    if (typeof fullName !== 'string' || fullName.length > 200) throw badRequest('full_name must be a string');
    patch.full_name = fullName.trim();
  }
  if (avatar !== undefined) {
    if (typeof avatar !== 'string' || (avatar && (!AVATAR_RE.test(avatar) || avatar.length > MAX_AVATAR_CHARS))) {
      throw badRequest('avatar_url must be a PNG, JPEG or WebP image under 150 KB');
    }
    patch.avatar_url = avatar;
  }
  if (!Object.keys(patch).length) throw badRequest('Nothing to update');
  res.json(publicUser(await updateUser(req.user.id, patch)));
}));

router.post('/change-password', requireUser, sensitiveLimiter, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  const user = await findUserById(req.user.id);
  if (!(await verifyPassword(currentPassword, user.password_hash))) throw badRequest('Current password is incorrect');
  const pwErr = validatePassword(newPassword);
  if (pwErr) throw badRequest(pwErr);
  await updateUser(user.id, { password_hash: await hashPassword(newPassword) });
  await destroyUserSessions(user.id, req.sessionHash);
  res.json({ ok: true });
}));

// No email service: the reset link is written to the server log for an operator to hand over.
router.post('/reset-password-request', sensitiveLimiter, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const user = await findUserByEmail(email);
  if (user) {
    const token = randomToken();
    await db().run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
      [sha256(token), user.id, new Date(Date.now() + 3600_000).toISOString()]);
    log.info('auth.password_reset_link', { userId: user.id, link: `${config.appBaseUrl}/reset-password?token=${token}` });
  }
  res.json({ ok: true });
}));

router.post('/reset-password', sensitiveLimiter, asyncHandler(async (req, res) => {
  const { resetToken, newPassword } = req.body || {};
  if (!resetToken) throw badRequest('Missing reset token');
  const [row] = await db().query('SELECT * FROM password_resets WHERE token_hash = ?', [sha256(resetToken)]);
  if (!row || row.used_at || row.expires_at < new Date().toISOString()) throw badRequest('This reset link is invalid or has expired');
  const pwErr = validatePassword(newPassword);
  if (pwErr) throw badRequest(pwErr);
  await updateUser(row.user_id, { password_hash: await hashPassword(newPassword) });
  await db().run('UPDATE password_resets SET used_at = ? WHERE token_hash = ?', [new Date().toISOString(), row.token_hash]);
  await destroyUserSessions(row.user_id);
  res.json({ ok: true });
}));

// Admin invite: creates the account with a one-time temporary password shown to the admin.
router.post('/invite', requireAdmin, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address');
  if (await findUserByEmail(email)) throw badRequest('A user with this email already exists');
  const temporaryPassword = randomToken(9);
  const user = await createUser({ email, role, fullName: req.body?.full_name, passwordHash: await hashPassword(temporaryPassword) });
  log.info('auth.invited', { userId: user.id, by: req.user.id, role });
  res.status(201).json({ user: publicUser(user), temporary_password: temporaryPassword });
}));

router.get('/login-history', requireUser, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const userId = req.user.role === 'admin' ? req.query.user_id : req.user.id;
  res.json(await loginHistory({ userId, limit }));
}));

router.get('/users/:id', requireAdmin, asyncHandler(async (req, res) => {
  const user = await findUserById(req.params.id);
  if (!user) throw notFound('User not found');
  res.json(publicUser(user));
}));

export default router;
