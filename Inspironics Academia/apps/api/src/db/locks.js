import crypto from 'node:crypto';
import { db } from './index.js';

// Cross-instance mutual exclusion.
// Postgres: session-level pg_try_advisory_lock on a dedicated connection.
// SQLite: a lease row in `locks` with an expiry (single host, but also guards against overlapping runs).

function lockKey(name) {
  return crypto.createHash('sha256').update(name).digest().readInt32BE(0);
}

export async function withLock(name, fn, { ttlMs = 60 * 60 * 1000 } = {}) {
  const d = db();
  if (d.dialect === 'postgres') {
    const conn = await d.connect();
    try {
      const [row] = await conn.query('SELECT pg_try_advisory_lock(?) AS ok', [lockKey(name)]);
      if (!row.ok) return { acquired: false };
      try {
        return { acquired: true, result: await fn() };
      } finally {
        await conn.query('SELECT pg_advisory_unlock(?)', [lockKey(name)]);
      }
    } finally {
      conn.release();
    }
  }

  const owner = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + ttlMs).toISOString();
  await d.run(
    `INSERT INTO locks (name, owner, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
     WHERE locks.expires_at < ?`,
    [name, owner, expires, now.toISOString()],
  );
  const [row] = await d.query('SELECT owner FROM locks WHERE name = ?', [name]);
  if (row?.owner !== owner) return { acquired: false };
  try {
    return { acquired: true, result: await fn() };
  } finally {
    await d.run('DELETE FROM locks WHERE name = ? AND owner = ?', [name, owner]);
  }
}

export async function isLocked(name) {
  const d = db();
  if (d.dialect === 'postgres') {
    // Probe: if we can take the lock, nobody holds it — release immediately.
    const conn = await d.connect();
    try {
      const [row] = await conn.query('SELECT pg_try_advisory_lock(?) AS ok', [lockKey(name)]);
      if (row.ok) await conn.query('SELECT pg_advisory_unlock(?)', [lockKey(name)]);
      return !row.ok;
    } finally {
      conn.release();
    }
  }
  const rows = await d.query('SELECT 1 FROM locks WHERE name = ? AND expires_at >= ?', [name, new Date().toISOString()]);
  return rows.length > 0;
}
