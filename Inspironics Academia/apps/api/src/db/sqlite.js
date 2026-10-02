import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLite driver on Node's built-in node:sqlite (no native module to compile). Development default.
export function createSqliteDriver(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const normalize = (params = []) => params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));

  return {
    dialect: 'sqlite',
    async query(sql, params) {
      return db.prepare(sql).all(...normalize(params));
    },
    async run(sql, params) {
      const r = db.prepare(sql).run(...normalize(params));
      return { changes: Number(r.changes) };
    },
    async exec(sql) {
      db.exec(sql);
    },
    async transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = await fn(this);
        db.exec('COMMIT');
        return result;
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
    },
    async close() {
      db.close();
    },
  };
}
