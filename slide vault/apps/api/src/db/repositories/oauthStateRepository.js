/**
 * OAuth state and authorization-code bookkeeping.
 *
 * Two independent single-use guarantees live here:
 *  - `state` protects the callback against CSRF. It is stored hashed, is
 *    short-lived, and is consumed atomically so a replayed callback is
 *    rejected rather than processed twice.
 *  - the authorization `code` is single-use at Dropbox. React StrictMode,
 *    a browser retry or a double-click would otherwise burn it and show the
 *    admin a spurious failure, so the first exchange result is remembered and
 *    replayed (spec §76).
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

/** Hashing means a leaked database backup carries no usable state value. */
export const hashValue = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

export class OAuthStateRepository {
  constructor(db) {
    this.db = db;
  }

  /**
   * Issues a new state token. The raw value is returned once, to be put in the
   * authorization URL; only its hash is stored.
   */
  async issue({ provider = 'dropbox', userId = '', redirectAfter = '', ttlMinutes = 10 } = {}) {
    const state = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000).toISOString();
    await this.db.execute(
      `INSERT INTO oauth_state (id, provider, state_hash, user_id, redirect_after, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), provider, hashValue(state), userId, redirectAfter, expiresAt, now()]
    );
    return { state, expiresAt };
  }

  /**
   * Validates and consumes a state in one atomic step.
   *
   * @returns {Promise<{ok: true, record: object} | {ok: false, reason: string}>}
   */
  async consume(state, provider = 'dropbox') {
    if (!state || typeof state !== 'string') return { ok: false, reason: 'missing' };

    const stateHash = hashValue(state);
    return this.db.transaction(async (tx) => {
      const row = await tx.queryOne(
        'SELECT * FROM oauth_state WHERE state_hash = ? AND provider = ?',
        [stateHash, provider]
      );
      if (!row) return { ok: false, reason: 'unknown' };
      if (row.used_at) return { ok: false, reason: 'already_used' };
      if (new Date(row.expires_at).getTime() < Date.now()) return { ok: false, reason: 'expired' };

      // The WHERE used_at IS NULL makes this a compare-and-set: two concurrent
      // callbacks race here and exactly one sees changes === 1.
      const result = await tx.execute(
        'UPDATE oauth_state SET used_at = ? WHERE state_hash = ? AND used_at IS NULL',
        [now(), stateHash]
      );
      if (!result.changes) return { ok: false, reason: 'already_used' };

      return { ok: true, record: row };
    });
  }

  /** Remembers the outcome of an authorization-code exchange. */
  async recordCodeExchange(code, outcome, result, provider = 'dropbox') {
    await this.db.execute(
      `INSERT INTO oauth_code_exchange (code_hash, provider, outcome, result_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (code_hash) DO NOTHING`,
      [hashValue(code), provider, outcome, JSON.stringify(result ?? {}), now()]
    );
  }

  /** The stored outcome of a previous exchange of this code, if any. */
  async findCodeExchange(code) {
    const row = await this.db.queryOne('SELECT * FROM oauth_code_exchange WHERE code_hash = ?', [
      hashValue(code),
    ]);
    if (!row) return null;
    let result = {};
    try {
      result = JSON.parse(row.result_json);
    } catch {
      result = {};
    }
    return { outcome: row.outcome, result, createdAt: row.created_at };
  }

  /**
   * Claims a code for exchange. Returns false when another request already
   * claimed it — that caller owns the exchange and this one must wait for its
   * recorded result.
   */
  async claimCode(code, provider = 'dropbox') {
    const result = await this.db.execute(
      `INSERT INTO oauth_code_exchange (code_hash, provider, outcome, result_json, created_at)
       VALUES (?, ?, 'pending', '{}', ?)
       ON CONFLICT (code_hash) DO NOTHING`,
      [hashValue(code), provider, now()]
    );
    return result.changes > 0;
  }

  /** Overwrites a pending claim with its final outcome. */
  async completeCode(code, outcome, result) {
    await this.db.execute(
      'UPDATE oauth_code_exchange SET outcome = ?, result_json = ? WHERE code_hash = ?',
      [outcome, JSON.stringify(result ?? {}), hashValue(code)]
    );
  }

  /** Releases a claim so a genuine retry is possible after a transient failure. */
  async releaseCode(code) {
    await this.db.execute("DELETE FROM oauth_code_exchange WHERE code_hash = ? AND outcome = 'pending'", [
      hashValue(code),
    ]);
  }

  /** Retention: states expire in minutes, exchange records in a day. */
  async purgeExpired() {
    const stateCutoff = now();
    const codeCutoff = new Date(Date.now() - 24 * 3600_000).toISOString();
    const states = await this.db.execute('DELETE FROM oauth_state WHERE expires_at < ?', [stateCutoff]);
    const codes = await this.db.execute('DELETE FROM oauth_code_exchange WHERE created_at < ?', [codeCutoff]);
    return { states: states.changes, codes: codes.changes };
  }
}
