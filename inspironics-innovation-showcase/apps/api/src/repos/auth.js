/**
 * Users, sessions, one-time codes and login history.
 *
 * Session tokens and codes are stored only as SHA-256 digests: the cookie a
 * browser holds is the only copy of the token, so a leaked row cannot be
 * replayed as a session.
 */
import { ROLES } from '@inspironics/shared'
import { randomCode, randomId, randomToken, sha256 } from '../lib/crypto.js'
import { nowIso } from '../db/index.js'

const USER_COLS =
  'id, email, name, password_hash, role, verified, provider, picture, disabled, created_at, last_login_at'

/** The user as the rest of the API sees it — no hash, real booleans. */
export function toUser(row) {
  if (!row) return null
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    verified: !!row.verified,
    provider: row.provider,
    picture: row.picture || null,
    disabled: !!row.disabled,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at || null,
    hasPassword: !!row.password_hash,
  }
}

export function createUsersRepo(db) {
  return {
    findByEmail: (email) => db.get(`SELECT ${USER_COLS} FROM users WHERE email = ?`, [email]),
    findById: (id) => db.get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id]),

    async create({ email, name, passwordHash = null, role = ROLES.VIEWER, verified = false, provider = 'password', picture = null }) {
      const id = randomId()
      await db.run(
        `INSERT INTO users (id, email, name, password_hash, role, verified, provider, picture, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, email, name, passwordHash, role, verified, provider, picture, nowIso()]
      )
      return db.get(`SELECT ${USER_COLS} FROM users WHERE id = ?`, [id])
    },

    /** Patch the given columns. Keys are column names from a fixed list. */
    async update(id, patch) {
      const allowed = ['name', 'password_hash', 'role', 'verified', 'provider', 'picture', 'disabled', 'last_login_at']
      const keys = Object.keys(patch).filter((k) => allowed.includes(k))
      if (!keys.length) return
      await db.run(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...keys.map((k) => patch[k]), id])
    },

    list: () => db.all(`SELECT ${USER_COLS} FROM users WHERE role <> ? ORDER BY created_at`, [ROLES.GUEST]),

    async countAdmins() {
      const r = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM users WHERE role = ? AND disabled = 0', [ROLES.ADMIN])
      return Number(r?.n || 0)
    },

    /** The single shared guest identity, created on first use. */
    async guest() {
      const existing = await db.get(`SELECT ${USER_COLS} FROM users WHERE id = 'guest'`)
      if (existing) return existing
      await db.run(
        `INSERT INTO users (id, email, name, role, verified, provider, created_at) VALUES ('guest', 'guest@local', 'Guest', ?, 1, 'guest', ?)`,
        [ROLES.GUEST, nowIso()]
      )
      return db.get(`SELECT ${USER_COLS} FROM users WHERE id = 'guest'`)
    },
  }
}

export function createSessionsRepo(db) {
  return {
    async create(userId, hours, { ip, userAgent } = {}) {
      const token = randomToken(32)
      const now = Date.now()
      const expiresAt = new Date(now + hours * 3600_000).toISOString()
      await db.run(
        'INSERT INTO sessions (id_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
        [sha256(token), userId, new Date(now).toISOString(), expiresAt, ip || null, (userAgent || '').slice(0, 300)]
      )
      return { token, expiresAt }
    },

    /** The live session and its user for a cookie token, or null. */
    async resolve(token) {
      if (!token) return null
      const row = await db.get(
        `SELECT s.expires_at, u.${USER_COLS.split(', ').join(', u.')}
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id_hash = ? AND s.expires_at > ?`,
        [sha256(token), nowIso()]
      )
      if (!row || row.disabled) return null
      return { user: toUser(row), expiresAt: row.expires_at }
    },

    revoke: (token) => db.run('DELETE FROM sessions WHERE id_hash = ?', [sha256(token)]),
    revokeForUser: (userId) => db.run('DELETE FROM sessions WHERE user_id = ?', [userId]),
    purgeExpired: () => db.run('DELETE FROM sessions WHERE expires_at <= ?', [nowIso()]),
  }
}

export function createCodesRepo(db) {
  return {
    /** Issue a fresh code for (email, kind), replacing any previous one. Returns the plaintext. */
    async issue(email, kind, ttlMinutes) {
      const code = randomCode()
      const now = new Date()
      const expires = new Date(now.getTime() + ttlMinutes * 60_000).toISOString()
      await db.run('DELETE FROM auth_codes WHERE email = ? AND kind = ?', [email, kind])
      await db.run(
        'INSERT INTO auth_codes (email, kind, code_hash, attempts, expires_at, created_at) VALUES (?, ?, ?, 0, ?, ?)',
        [email, kind, sha256(`${kind}:${email}:${code}`), expires, now.toISOString()]
      )
      return code
    },

    /**
     * Check a submitted code. The attempt counter is bumped before comparing,
     * so guessing costs an attempt even when two guesses race.
     * @returns {Promise<{ ok: true } | { ok: false, reason: 'missing'|'expired'|'locked'|'wrong', attemptsLeft?: number }>}
     */
    async consume(email, kind, code, maxAttempts) {
      const row = await db.get('SELECT code_hash, attempts, expires_at FROM auth_codes WHERE email = ? AND kind = ?', [email, kind])
      if (!row) return { ok: false, reason: 'missing' }
      if (row.expires_at <= nowIso()) {
        await db.run('DELETE FROM auth_codes WHERE email = ? AND kind = ?', [email, kind])
        return { ok: false, reason: 'expired' }
      }
      if (row.attempts >= maxAttempts) return { ok: false, reason: 'locked' }
      await db.run('UPDATE auth_codes SET attempts = attempts + 1 WHERE email = ? AND kind = ?', [email, kind])
      if (sha256(`${kind}:${email}:${String(code).trim()}`) !== row.code_hash) {
        const left = maxAttempts - row.attempts - 1
        if (left <= 0) return { ok: false, reason: 'locked' }
        return { ok: false, reason: 'wrong', attemptsLeft: left }
      }
      await db.run('DELETE FROM auth_codes WHERE email = ? AND kind = ?', [email, kind])
      return { ok: true }
    },

    async pending(email, kind) {
      const row = await db.get('SELECT expires_at FROM auth_codes WHERE email = ? AND kind = ? AND expires_at > ?', [email, kind, nowIso()])
      return row ? { email, expiresAt: row.expires_at } : null
    },
  }
}

export function createLoginHistoryRepo(db) {
  return {
    record: ({ userId = null, email = null, method, success, reason = null, ip = null, userAgent = '' }) =>
      db.run(
        `INSERT INTO login_history (id, user_id, email, method, success, reason, ip, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [randomId(), userId, email, method, success, reason, ip, String(userAgent).slice(0, 300), nowIso()]
      ),

    async list({ limit = 50, offset = 0 } = {}) {
      const rows = await db.all(
        `SELECT id, user_id, email, method, success, reason, ip, user_agent, created_at
         FROM login_history ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      )
      const total = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM login_history')
      return {
        total: Number(total?.n || 0),
        items: rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          email: r.email,
          method: r.method,
          success: !!r.success,
          reason: r.reason,
          ip: r.ip,
          userAgent: r.user_agent,
          createdAt: r.created_at,
        })),
      }
    },
  }
}
