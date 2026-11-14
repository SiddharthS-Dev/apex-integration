import { AUDIENCE_KEYS } from '@academy/shared';
import express from 'express';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, asyncHandler, badRequest, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { rateLimit } from '../http/rateLimit.js';
import {
  countUsers, createUser, findUserByEmail, findUserById, loginHistory, publicUser, recordLogin, updateUser,
} from '../repo/users.js';
import { hashPassword, randomToken, sha256, validatePassword, verifyPassword } from './passwords.js';
import { createSession, destroySession, destroyUserSessions, requireAdmin, requireUser } from './sessions.js';
import { emailConfigured } from '../notify/mailer.js';
import { sendAccountEmail } from '../notify/index.js';
import { onUserCreated } from '../core/index.js';

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
  // The first account becomes admin only where allowed (development, or ALLOW_FIRST_USER_ADMIN=true in
  // production); otherwise it is an ordinary learner and the bootstrap admin is the way in.
  const firstAdmin = config.allowFirstUserAdmin && (await countUsers()) === 0;
  if (!config.allowRegistration && !firstAdmin) throw forbidden('Registration is closed. Ask an administrator for an invite.');
  if (await findUserByEmail(email)) throw badRequest('An account with this email already exists');
  // Registration never grants admin by email (security review L3: the address is unverified, so whoever
  // registered it first would own the platform). The bootstrap admin is created at startup from
  // BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD, or with the break-glass CLI.
  const role = firstAdmin ? 'admin' : 'user';
  const user = await createUser({ email, fullName, role, passwordHash: await hashPassword(password) });
  await onUserCreated(user, { ip: req.ip });
  await createSession(res, user, req);
  await recordLogin({ userId: user.id, email, success: true, reason: 'register', ip: req.ip, userAgent: req.get('user-agent') });
  log.info('auth.registered', { userId: user.id, role });
  res.status(201).json({ user: publicUser(user) });
}));

// Per-account lockout: after config.loginMaxFailures consecutive failures for one email within
// LOCK_WINDOW_MS, that email is refused (429) for LOCK_WINDOW_MS whatever the client IP; a successful
// sign-in clears it. Kept in memory, so it is per process and forgotten on restart — acceptable for a
// single-instance deployment; a multi-instance one would need it in the database.
const LOCK_WINDOW_MS = 15 * 60_000;
const loginFailures = new Map(); // email -> { count, first, lockedUntil }
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginFailures) if (v.lockedUntil <= now && v.first + LOCK_WINDOW_MS <= now) loginFailures.delete(k);
}, LOCK_WINDOW_MS).unref();

function lockedFor(email, now = Date.now()) {
  const entry = loginFailures.get(email);
  return entry && entry.lockedUntil > now ? entry.lockedUntil - now : 0;
}
function noteFailure(email, now = Date.now()) {
  let entry = loginFailures.get(email);
  if (!entry || entry.first + LOCK_WINDOW_MS <= now) entry = { count: 0, first: now, lockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= config.loginMaxFailures) entry.lockedUntil = now + LOCK_WINDOW_MS;
  loginFailures.set(email, entry);
}

// An unknown email is checked against this throwaway hash, so it costs the same scrypt work as a wrong
// password and response timing does not reveal which emails have accounts.
const dummyHash = hashPassword(randomToken());

router.post('/login', loginLimiter, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const password = req.body?.password;
  const wait = lockedFor(email);
  if (wait) {
    await recordLogin({ userId: null, email, success: false, reason: 'locked', ip: req.ip, userAgent: req.get('user-agent') });
    res.setHeader('Retry-After', Math.ceil(wait / 1000));
    throw new HttpError(429, 'Too many failed sign-in attempts for this account. Try again in 15 minutes.');
  }
  const user = await findUserByEmail(email);
  const passwordOk = await verifyPassword(password, user?.password_hash || (await dummyHash));
  const ok = !!user && !(user.disabled === true || user.disabled === 1) && passwordOk;
  await recordLogin({ userId: user?.id, email, success: ok, reason: ok ? 'password' : 'invalid_credentials', ip: req.ip, userAgent: req.get('user-agent') });
  if (!ok) {
    noteFailure(email);
    throw unauthorized('Invalid email or password');
  }
  loginFailures.delete(email);
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

// A one-time set-password link (password_resets row). Used for resets (1 h) and invites (7 days).
async function passwordLink(userId, ttlMs) {
  const token = randomToken();
  await db().run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [sha256(token), userId, new Date(Date.now() + ttlMs).toISOString()]);
  return `/reset-password?token=${token}`;
}

// The reset link is emailed. With EMAIL_PROVIDER=log (no email service) the email lands in the
// server log, where an operator can pick the link up and hand it over.
router.post('/reset-password-request', sensitiveLimiter, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const user = await findUserByEmail(email);
  if (user && !(user.disabled === true || user.disabled === 1)) {
    const link = await passwordLink(user.id, 3600_000);
    await sendAccountEmail('password_reset', user.email, { link }, { userId: user.id });
    log.info('auth.password_reset_requested', { userId: user.id });
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

// Admin invite: creates the account with a one-time temporary password shown to the admin and, when
// email is configured, emails the learner a set-password link (email_sent tells the admin which).
router.post('/invite', requireAdmin, asyncHandler(async (req, res) => {
  const email = cleanEmail(req.body?.email);
  const role = req.body?.role === 'admin' ? 'admin' : 'user';
  const audience = AUDIENCE_KEYS.includes(req.body?.audience) ? req.body.audience : undefined;
  if (!EMAIL_RE.test(email)) throw badRequest('Enter a valid email address');
  if (await findUserByEmail(email)) throw badRequest('A user with this email already exists');
  const temporaryPassword = randomToken(9);
  const user = await createUser({ email, role, audience, fullName: req.body?.full_name, passwordHash: await hashPassword(temporaryPassword) });
  await onUserCreated(user, { actorUserId: req.user.id, ip: req.ip });
  let emailSent = false;
  if (emailConfigured()) {
    const link = await passwordLink(user.id, 7 * 24 * 3600_000);
    emailSent = await sendAccountEmail('invite', email, { name: user.full_name, invitedBy: req.user.full_name || req.user.email, link }, { userId: user.id });
  }
  log.info('auth.invited', { userId: user.id, by: req.user.id, role, email_sent: emailSent });
  res.status(201).json({ user: publicUser(user), temporary_password: temporaryPassword, email_sent: emailSent });
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
