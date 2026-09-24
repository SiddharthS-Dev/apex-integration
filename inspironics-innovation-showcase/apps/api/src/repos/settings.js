/**
 * Admin-editable settings (JSON values by key) and the Dropbox connection row.
 */
import { nowIso, parseJson } from '../db/index.js'
import { randomToken, sha256 } from '../lib/crypto.js'

export function createSettingsRepo(db) {
  return {
    async get(key, fallback = null) {
      const row = await db.get('SELECT value FROM settings WHERE key = ?', [key])
      return row ? parseJson(row.value, fallback) : fallback
    },
    async set(key, value, by = null) {
      const text = JSON.stringify(value)
      const now = nowIso()
      await db.run(
        `INSERT INTO settings (key, value, updated_at, updated_by) VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
        [key, text, now, by]
      )
    },
  }
}

/**
 * The single Dropbox connection. The refresh token is stored only as
 * AES-256-GCM ciphertext; this repo never sees the key and never decrypts.
 */
export function createDropboxConnectionRepo(db) {
  const COLS =
    'account_id, email, display_name, refresh_token_enc, root_namespace_id, home_namespace_id, is_team, status, last_error, connected_by, connected_at, updated_at'
  const map = (r) =>
    r && {
      accountId: r.account_id,
      email: r.email,
      displayName: r.display_name,
      refreshTokenEnc: r.refresh_token_enc,
      rootNamespaceId: r.root_namespace_id,
      homeNamespaceId: r.home_namespace_id,
      isTeam: !!r.is_team,
      status: r.status,
      lastError: r.last_error,
      connectedBy: r.connected_by,
      connectedAt: r.connected_at,
      updatedAt: r.updated_at,
    }

  return {
    get: async () => map(await db.get(`SELECT ${COLS} FROM dropbox_connection WHERE id = 1`)),

    async save(c) {
      const now = nowIso()
      await db.run(
        `INSERT INTO dropbox_connection (id, ${COLS}) VALUES (1, ?, ?, ?, ?, ?, ?, ?, 'ok', NULL, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET account_id = excluded.account_id, email = excluded.email,
           display_name = excluded.display_name, refresh_token_enc = excluded.refresh_token_enc,
           root_namespace_id = excluded.root_namespace_id, home_namespace_id = excluded.home_namespace_id,
           is_team = excluded.is_team, status = 'ok', last_error = NULL,
           connected_by = excluded.connected_by, connected_at = excluded.connected_at, updated_at = excluded.updated_at`,
        [c.accountId, c.email, c.displayName, c.refreshTokenEnc, c.rootNamespaceId, c.homeNamespaceId, c.isTeam, c.connectedBy, now, now]
      )
    },

    setRootNamespace: (id) => db.run('UPDATE dropbox_connection SET root_namespace_id = ?, updated_at = ? WHERE id = 1', [id, nowIso()]),

    setStatus: (status, lastError = null) =>
      db.run('UPDATE dropbox_connection SET status = ?, last_error = ?, updated_at = ? WHERE id = 1', [status, lastError, nowIso()]),

    remove: () => db.run('DELETE FROM dropbox_connection WHERE id = 1'),
  }
}

/** CSRF state for the OAuth round trip: single use, ten minutes, bound to the admin who started it. */
export function createOAuthStateRepo(db) {
  return {
    async create(userId) {
      const state = randomToken(24)
      const now = Date.now()
      await db.run('DELETE FROM oauth_states WHERE expires_at < ?', [new Date(now).toISOString()])
      await db.run('INSERT INTO oauth_states (state_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)', [
        sha256(state),
        userId,
        new Date(now).toISOString(),
        new Date(now + 10 * 60_000).toISOString(),
      ])
      return state
    },
    /** True once, for a live state issued to this user. */
    async consume(state, userId) {
      const r = await db.run('DELETE FROM oauth_states WHERE state_hash = ? AND user_id = ? AND expires_at > ?', [
        sha256(state || ''),
        userId,
        nowIso(),
      ])
      return r.changes === 1
    },
  }
}
