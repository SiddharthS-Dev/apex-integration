import { SESSION_COOKIE } from '@academy/shared';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { findUserById, publicUser } from '../repo/users.js';
import { randomToken, sha256 } from './passwords.js';

// Opaque session tokens: the cookie holds the raw token, the database only its SHA-256.

const ttlMs = () => config.sessionTtlHours * 3600 * 1000;

export function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, path: '/', maxAge: ttlMs() };
}

export async function createSession(res, user, req) {
  const token = randomToken();
  const now = new Date();
  await db().run(
    'INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    [sha256(token), user.id, now.toISOString(), new Date(now.getTime() + ttlMs()).toISOString(), req.ip || null, req.get('user-agent') || null],
  );
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(req, res) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) await db().run('DELETE FROM sessions WHERE token_hash = ?', [sha256(token)]);
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

export async function destroyUserSessions(userId, exceptTokenHash) {
  if (exceptTokenHash) await db().run('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?', [userId, exceptTokenHash]);
  else await db().run('DELETE FROM sessions WHERE user_id = ?', [userId]);
}

export async function purgeExpiredSessions() {
  await db().run('DELETE FROM sessions WHERE expires_at < ?', [new Date().toISOString()]);
}

// Middleware: attaches req.user (public shape) when a valid session cookie is present.
export async function loadSession(req, _res, next) {
  try {
    const token = req.cookies?.[SESSION_COOKIE];
    if (!token) return next();
    const hash = sha256(token);
    const [session] = await db().query('SELECT * FROM sessions WHERE token_hash = ?', [hash]);
    if (!session || session.expires_at < new Date().toISOString()) return next();
    const user = await findUserById(session.user_id);
    if (!user || user.disabled === true || user.disabled === 1) return next();
    req.user = publicUser(user);
    req.sessionHash = hash;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireUser(req, _res, next) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized());
  if (req.user.role !== 'admin') return next(forbidden('Administrator access required'));
  next();
}
