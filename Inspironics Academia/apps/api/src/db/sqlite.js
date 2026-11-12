import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// SQLite driver on Node's built-in node:sqlite (no native module to compile). Development default.
//
// One connection serves the whole process, so a transaction is a property of the connection, not of
// the caller. While one is open (BEGIN … await … COMMIT), statements from other requests would run
// inside it — and be rolled back with it — and a second transaction would fail with "cannot start a
// transaction within a transaction". So transactions run one at a time, and a statement from outside
// the open transaction waits until it has ended. The transaction's own statements are recognised
// through AsyncLocalStorage; a transaction started inside another simply joins it.
export function createSqliteDriver(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

  const normalize = (params = []) => params.map((p) => (typeof p === 'boolean' ? (p ? 1 : 0) : p === undefined ? null : p));

  const inTransaction = new AsyncLocalStorage();
  let open = null; // settles when the open transaction ends
  let queue = Promise.resolve(); // transactions, one after another
  const outsideWait = async () => {
    while (open && !inTransaction.getStore()) await open;
  };

  return {
    dialect: 'sqlite',
    async query(sql, params) {
      await outsideWait();
      return db.prepare(sql).all(...normalize(params));
    },
    async run(sql, params) {
      await outsideWait();
      const r = db.prepare(sql).run(...normalize(params));
      return { changes: Number(r.changes) };
    },
    async exec(sql) {
      await outsideWait();
      db.exec(sql);
    },
    async transaction(fn) {
      if (inTransaction.getStore()) return fn(this);
      const previous = queue;
      let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous.catch(() => {});
      let end;
      open = new Promise((resolve) => { end = resolve; });
      try {
        db.exec('BEGIN IMMEDIATE');
        try {
          const result = await inTransaction.run(true, () => fn(this));
          db.exec('COMMIT');
          return result;
        } catch (err) {
          db.exec('ROLLBACK');
          throw err;
        }
      } finally {
        open = null;
        end();
        release();
      }
    },
    async close() {
      db.close();
    },
  };
}
