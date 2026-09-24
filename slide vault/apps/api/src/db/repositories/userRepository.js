/**
 * Users and sessions.
 *
 * The backend owns its own identity so RBAC ("only an administrator may manage
 * the Dropbox connection") is enforced server-side and cannot be bypassed by a
 * client that simply claims to be an admin.
 *
 * Passwords are hashed with scrypt (node's built-in, memory-hard) and compared
 * in constant time. Session tokens are random, stored only as a hash, and
 * carry an expiry.
 */
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const now = () => new Date().toISOString();

export const ROLES = { ADMIN: 'admin', USER: 'user' };

/** `scrypt$N$r$p$salt$hash`, so the parameters travel with the hash. */
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(String(password), salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    'scrypt',
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const [, N, r, p, saltB64, hashB64] = parts;
  const expected = Buffer.from(hashB64, 'base64');
  let derived;
  try {
    derived = await scrypt(String(password), Buffer.from(saltB64, 'base64'), expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

export const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

export class UserRepository {
  constructor(db) {
    this.db = db;
  }

  async findByEmail(email) {
    return this.db.queryOne('SELECT * FROM app_user WHERE email = ?', [
      String(email || '').trim().toLowerCase(),
    ]);
  }

  async findById(id) {
    return this.db.queryOne('SELECT * FROM app_user WHERE id = ?', [id]);
  }

  async create({ email, password, fullName = '', role = ROLES.USER }) {
    const timestamp = now();
    const id = crypto.randomUUID();
    await this.db.execute(
      `INSERT INTO app_user (id, email, full_name, role, password_hash, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
      [
        id,
        String(email).trim().toLowerCase(),
        fullName,
        role,
        password ? await hashPassword(password) : '',
        timestamp,
        timestamp,
      ]
    );
    return this.findById(id);
  }

  async setPassword(id, password) {
    await this.db.execute('UPDATE app_user SET password_hash = ?, updated_at = ? WHERE id = ?', [
      await hashPassword(password),
      now(),
      id,
    ]);
  }

  /** Fills in profile fields that sign-in can learn (currently the name). */
  async updateProfile(id, { fullName } = {}) {
    if (typeof fullName !== 'string' || !fullName.trim()) return this.findById(id);
    await this.db.execute('UPDATE app_user SET full_name = ?, updated_at = ? WHERE id = ?', [
      fullName.trim().slice(0, 120),
      now(),
      id,
    ]);
    return this.findById(id);
  }

  async setRole(id, role) {
    await this.db.execute('UPDATE app_user SET role = ?, updated_at = ? WHERE id = ?', [role, now(), id]);
    return this.findById(id);
  }

  async touchLogin(id) {
    await this.db.execute('UPDATE app_user SET last_login_at = ?, updated_at = ? WHERE id = ?', [
      now(),
      now(),
      id,
    ]);
  }

  async list({ limit = 200 } = {}) {
    const rows = await this.db.query('SELECT * FROM app_user ORDER BY created_at ASC LIMIT ?', [
      Math.min(Number(limit) || 200, 1000),
    ]);
    return rows.map(UserRepository.sanitize);
  }

  async count() {
    const row = await this.db.queryOne('SELECT COUNT(*) AS n FROM app_user');
    return Number(row?.n ?? 0);
  }

  /** Never returns password_hash. */
  static sanitize(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      status: user.status,
      last_login_at: user.last_login_at,
      created_date: user.created_at,
    };
  }
}

export class SessionRepository {
  constructor(db) {
    this.db = db;
  }

  /** Issues a session. The raw token is returned once, for the cookie. */
  async create({ userId, ttlHours = 12, ip = '', userAgent = '' }) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlHours * 3600_000).toISOString();
    await this.db.execute(
      `INSERT INTO user_session (id, user_id, token_hash, ip, user_agent, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, hashToken(token), ip, String(userAgent).slice(0, 300), expiresAt, now()]
    );
    return { token, expiresAt };
  }

  /** Resolves a cookie value to its user, or null if invalid/expired/revoked. */
  async resolve(token) {
    if (!token) return null;
    const row = await this.db.queryOne(
      'SELECT * FROM user_session WHERE token_hash = ?',
      [hashToken(token)]
    );
    if (!row || row.revoked_at) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
  }

  async revoke(token) {
    await this.db.execute('UPDATE user_session SET revoked_at = ? WHERE token_hash = ?', [
      now(),
      hashToken(token),
    ]);
  }

  async revokeAllForUser(userId) {
    await this.db.execute(
      'UPDATE user_session SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL',
      [now(), userId]
    );
  }

  async purgeExpired() {
    const result = await this.db.execute('DELETE FROM user_session WHERE expires_at < ?', [now()]);
    return result.changes;
  }
}

export class LoginHistoryRepository {
  constructor(db) {
    this.db = db;
  }

  async record({ userId = '', userName = '', email = '', status = 'success', ip = '' }) {
    const timestamp = now();
    await this.db.execute(
      `INSERT INTO login_history (id, user_id, user_name, email, status, ip, login_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), userId, userName, email, status, ip, timestamp, timestamp]
    );
  }

  async list({ limit = 100, offset = 0 } = {}) {
    return this.db.query('SELECT * FROM login_history ORDER BY login_at DESC LIMIT ? OFFSET ?', [
      Math.min(Number(limit) || 100, 500),
      Math.max(Number(offset) || 0, 0),
    ]);
  }
}
