/**
 * SQLite driver built on node:sqlite — no native module to compile, which is
 * what makes `npm install && npm start` work on a Windows laptop.
 *
 * The driver is synchronous underneath; the async surface exists so callers
 * are written once against the Postgres semantics too.
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * node:sqlite binds only null, number, bigint, string and Buffer. Everything
 * else in application code (booleans, undefined, Date, plain objects) is
 * coerced here rather than at 200 call sites.
 */
function bindable(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value;
  if (typeof value === 'object') return JSON.stringify(value);
  return value;
}

export function createSqliteDriver(cfg, logger) {
  const file = cfg.db.file;
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });

  const handle = new DatabaseSync(file);
  // WAL keeps readers from blocking the sync writer; NORMAL is the documented
  // safe pairing with WAL (a crash can lose the last commit, never the file).
  handle.exec('PRAGMA journal_mode = WAL');
  handle.exec('PRAGMA synchronous = NORMAL');
  handle.exec('PRAGMA foreign_keys = ON');
  handle.exec('PRAGMA busy_timeout = 5000');

  logger?.info?.('Database ready', { driver: 'sqlite', file });

  let depth = 0; // SQLite has no nested transactions; track re-entry instead.

  const driver = {
    dialect: 'sqlite',
    raw: handle,

    async query(sql, params = []) {
      return handle.prepare(sql).all(...params.map(bindable));
    },

    async queryOne(sql, params = []) {
      const rows = await driver.query(sql, params);
      return rows[0] ?? null;
    },

    async execute(sql, params = []) {
      const result = handle.prepare(sql).run(...params.map(bindable));
      return { changes: Number(result.changes ?? 0), lastInsertRowid: result.lastInsertRowid };
    },

    async transaction(fn) {
      if (depth > 0) return fn(driver); // already inside one — join it
      handle.exec('BEGIN IMMEDIATE');
      depth += 1;
      try {
        const result = await fn(driver);
        handle.exec('COMMIT');
        return result;
      } catch (error) {
        try {
          handle.exec('ROLLBACK');
        } catch {
          // A failed rollback means the transaction was already unwound.
        }
        throw error;
      } finally {
        depth -= 1;
      }
    },

    async close() {
      handle.close();
    },
  };

  return driver;
}
