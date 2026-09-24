/**
 * One database interface, two drivers.
 *
 *   db.dialect                      'sqlite' | 'postgres'
 *   db.all(sql, params)  -> rows
 *   db.get(sql, params)  -> row | undefined
 *   db.run(sql, params)  -> { changes }
 *   db.exec(sql)                    multi-statement, no params (migrations)
 *   db.transaction(fn)              fn receives a handle with all/get/run
 *   db.tryLock(name, ttlMs)  -> Lock | null   cross-instance mutual exclusion
 *   db.close()
 *
 * SQL is written once with `?` placeholders and portable types (TEXT ids and
 * ISO timestamps, INTEGER flags, TEXT JSON); the Postgres driver rewrites the
 * placeholders. SQLite (Node's built-in node:sqlite, no native module) is the
 * development default; setting DATABASE_URL switches to Postgres.
 */
import { createPostgresDb } from './postgres.js'
import { createSqliteDb } from './sqlite.js'

/**
 * @typedef {object} Lock
 * @property {() => Promise<boolean>} renew   extend the lease; false if it was lost
 * @property {() => Promise<void>} release
 */

export async function openDatabase(config, log) {
  if (config.db.url) {
    log?.info('Database: postgres')
    return createPostgresDb(config.db.url, log)
  }
  log?.info('Database: sqlite', { path: config.db.sqlitePath })
  return createSqliteDb(config.db.sqlitePath)
}

/** Parse a JSON TEXT column, tolerating null and garbage. */
export function parseJson(text, fallback) {
  if (text === null || text === undefined || text === '') return fallback
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

export const nowIso = () => new Date().toISOString()
