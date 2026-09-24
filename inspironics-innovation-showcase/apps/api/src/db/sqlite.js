/**
 * SQLite driver over node:sqlite (Node's built-in; no native module to build).
 *
 * node:sqlite is synchronous, which is fine for a development database; the
 * methods are async only so callers are written the same way for Postgres.
 *
 * Cross-process locking uses a lease row in `app_locks` rather than an
 * advisory lock (SQLite has none): acquiring is a single conditional upsert,
 * and a crashed holder's lease simply expires.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { createMutex } from '../lib/concurrency.js'
import { randomId } from '../lib/crypto.js'

/** node:sqlite binds null/number/bigint/string/Buffer only. */
const bind = (params = []) =>
  params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))

export function createSqliteDb(file) {
  if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true })
  const raw = new DatabaseSync(file)
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

  const statements = new Map()
  const prepare = (sql) => {
    let st = statements.get(sql)
    if (!st) {
      st = raw.prepare(sql)
      statements.set(sql, st)
    }
    return st
  }

  const handle = {
    all: async (sql, params) => prepare(sql).all(...bind(params)),
    get: async (sql, params) => prepare(sql).get(...bind(params)),
    run: async (sql, params) => {
      const r = prepare(sql).run(...bind(params))
      return { changes: Number(r.changes) }
    },
  }

  const txLock = createMutex()

  return {
    dialect: 'sqlite',
    ...handle,
    exec: async (sql) => raw.exec(sql),

    /** Transactions are serialised: one connection, so they must not interleave. */
    transaction: (fn) =>
      txLock(async () => {
        raw.exec('BEGIN IMMEDIATE')
        try {
          const result = await fn(handle)
          raw.exec('COMMIT')
          return result
        } catch (error) {
          raw.exec('ROLLBACK')
          throw error
        }
      }),

    async tryLock(name, ttlMs) {
      const owner = randomId()
      const take = () =>
        prepare(
          `INSERT INTO app_locks (name, owner, expires_at) VALUES (?, ?, ?)
           ON CONFLICT(name) DO UPDATE SET owner = excluded.owner, expires_at = excluded.expires_at
           WHERE app_locks.expires_at < ? OR app_locks.owner = excluded.owner`
        ).run(name, owner, Date.now() + ttlMs, Date.now())
      if (Number(take().changes) === 0) return null
      return {
        renew: async () => Number(take().changes) > 0,
        release: async () => {
          prepare('DELETE FROM app_locks WHERE name = ? AND owner = ?').run(name, owner)
        },
      }
    },

    close: async () => raw.close(),
  }
}
