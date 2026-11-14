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
import { ROLES } from '@slidesvault/shared';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const now = () => new Date().toISOString();

// One definition of the roles, shared with the web app, so the value the API
// validates against is the value the client renders against.
export { ROLES };

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

  /** The local user an Apex (Core) user id was created for. Never looked up by email. */
  async findByCoreUserId(coreUserId) {
    return this.db.queryOne('SELECT * FROM app_user WHERE core_user_id = ?', [String(coreUserId)]);
  }

  /**
   * A passwordless local user for a Core user seen for the first time
   * (identity assertion). Always a new row: an existing account with the same
   * email is never reused — that would hand it to whoever controls the Core
   * account. The asserted email is kept when no local account has it;
   * otherwise a placeholder that cannot receive mail stands in. The role column
   * is the base role and is never changed from the assertion: asserted roles
   * apply per request only.
   */
  async createFromCore({ coreUserId, email, fullName = '' }) {
    const wanted =
      typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()) ? email.trim().toLowerCase() : '';
    const placeholder = `core-${String(coreUserId).toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 80)}@apex.invalid`;
    const candidates = wanted && !(await this.findByEmail(wanted)) ? [wanted, placeholder] : [placeholder];
    for (const address of candidates) {
      const timestamp = now();
      const id = crypto.randomUUID();
      try {
        await this.db.execute(
          `INSERT INTO app_user (id, email, full_name, role, password_hash, status, created_at, updated_at, core_user_id)
           VALUES (?, ?, ?, ?, '', 'active', ?, ?, ?)`,
          [id, address, String(fullName || '').slice(0, 120), ROLES.USER, timestamp, timestamp, String(coreUserId)]
        );
        return this.findById(id);
      } catch (error) {
        // A parallel request created it first, or the email was taken meanwhile.
        const existing = await this.findByCoreUserId(coreUserId);
        if (existing) return existing;
        if (address === candidates[candidates.length - 1]) throw error;
      }
    }
    return null;
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

  /**
   * Changes a role without ever leaving the deployment with no active
   * administrator.
   *
   * The check is part of the UPDATE itself rather than a read followed by a
   * write, so two administrators demoting each other at the same moment cannot
   * both succeed and lock everyone out. Returns false when the change was
   * refused for that reason.
   */
  async changeRoleKeepingAnAdmin(id, role) {
    if (role === ROLES.ADMIN) {
      await this.setRole(id, role);
      return true;
    }
    const result = await this.db.execute(
      `UPDATE app_user SET role = ?, updated_at = ?
        WHERE id = ?
          AND (SELECT COUNT(*) FROM app_user WHERE role = ? AND status = 'active' AND id <> ?) > 0`,
      [role, now(), id, ROLES.ADMIN, id]
    );
    return result.changes > 0;
  }

  async touchLogin(id) {
    await this.db.execute('UPDATE app_user SET last_login_at = ?, updated_at = ? WHERE id = ?', [
      now(),
      now(),
      id,
    ]);
  }

  /**
   * Presence: "this person used the app recently". Written on authenticated
   * requests, throttled by the caller, and deliberately not touching
   * updated_at — that column means "the account record changed".
   */
  async touchActive(id) {
    await this.db.execute('UPDATE app_user SET last_active_at = ? WHERE id = ?', [now(), id]);
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
      last_active_at: user.last_active_at ?? null,
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
