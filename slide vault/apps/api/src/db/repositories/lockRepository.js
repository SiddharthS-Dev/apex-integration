/**
 * Database-backed advisory locks.
 *
 * The cross-instance half of the concurrency story. In-process, a SingleFlight
 * is enough; with three app instances behind a load balancer, "only one sync
 * runs" and "only one token refresh is in flight" need a shared authority.
 * The database is already shared, so it is the authority — no Redis required
 * for a small deployment, and the same interface can be backed by Redis later.
 *
 * Every lock carries an expiry: a killed process must not hold a lock forever.
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

export class LockRepository {
  constructor(db, { owner = `${process.pid}-${crypto.randomUUID().slice(0, 8)}` } = {}) {
    this.db = db;
    this.owner = owner;
  }

  /**
   * Tries to take a lock. Returns a handle, or null when someone else holds it.
   * An expired lock is stolen — that is the recovery path after a crash.
   */
  async acquire(name, ttlMs) {
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const timestamp = now();

    const inserted = await this.db.execute(
      `INSERT INTO advisory_lock (name, owner, acquired_at, expires_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (name) DO NOTHING`,
      [name, this.owner, timestamp, expiresAt]
    );
    if (inserted.changes > 0) return this.#handle(name, expiresAt);

    // Someone holds it. Take it over only if their lease has run out; the
    // expires_at check in the WHERE makes that atomic against another stealer.
    const stolen = await this.db.execute(
      'UPDATE advisory_lock SET owner = ?, acquired_at = ?, expires_at = ? WHERE name = ? AND expires_at < ?',
      [this.owner, timestamp, expiresAt, name, timestamp]
    );
    return stolen.changes > 0 ? this.#handle(name, expiresAt) : null;
  }

  /** Runs `fn` while holding `name`, or returns `onBusy()` if it is taken. */
  async withLock(name, ttlMs, fn, onBusy = null) {
    const handle = await this.acquire(name, ttlMs);
    if (!handle) {
      if (onBusy) return onBusy();
      const error = new Error(`Another instance is already running "${name}".`);
      error.code = 'LOCK_BUSY';
      error.status = 409;
      throw error;
    }
    try {
      return await fn(handle);
    } finally {
      await handle.release();
    }
  }

  async isHeld(name) {
    const row = await this.db.queryOne('SELECT expires_at FROM advisory_lock WHERE name = ?', [name]);
    return Boolean(row) && new Date(row.expires_at).getTime() > Date.now();
  }

  #handle(name, expiresAt) {
    return {
      name,
      owner: this.owner,
      expiresAt,
      /** Extends the lease for a long-running job. */
      renew: async (ms) => {
        const next = new Date(Date.now() + ms).toISOString();
        const result = await this.db.execute(
          'UPDATE advisory_lock SET expires_at = ? WHERE name = ? AND owner = ?',
          [next, name, this.owner]
        );
        return result.changes > 0;
      },
      // Scoped by owner: a lock already stolen by another instance after an
      // expiry must not be released out from under its new holder.
      release: async () => {
        await this.db.execute('DELETE FROM advisory_lock WHERE name = ? AND owner = ?', [name, this.owner]);
      },
    };
  }
}

export const LOCKS = {
  SYNC: 'dropbox:sync',
  TOKEN_REFRESH: 'dropbox:token-refresh',
  RENAME: 'dropbox:rename',
};
