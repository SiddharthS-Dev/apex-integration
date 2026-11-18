import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { createSqliteDriver } from '../src/db/sqlite.js';

// One SQLite connection serves the process: concurrent transactions must not collide, and a write
// from outside an open transaction must not be swept into it (or rolled back with it).

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-tx-'));
const db = createSqliteDriver(path.join(dir, 'tx.db'));
await db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
after(async () => { await db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

const tick = () => new Promise((r) => setTimeout(r, 5));

test('concurrent transactions run one after another instead of failing', async () => {
  const insertMany = (tag) => db.transaction(async (tx) => {
    for (let i = 0; i < 20; i++) { await tx.run('INSERT INTO t (v) VALUES (?)', [`${tag}${i}`]); await tick(); }
  });
  const results = await Promise.allSettled([insertMany('a'), insertMany('b'), insertMany('c')]);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'fulfilled', 'fulfilled']);
  assert.equal((await db.query('SELECT count(*) n FROM t'))[0].n, 60);
});

test('a write from outside an open transaction survives that transaction\'s rollback', async () => {
  await db.run('DELETE FROM t');
  const failing = db.transaction(async (tx) => {
    await tx.run('INSERT INTO t (v) VALUES (?)', ['inside']);
    await tick();
    throw new Error('boom');
  });
  const outside = db.run('INSERT INTO t (v) VALUES (?)', ['outside']);
  await assert.rejects(failing, /boom/);
  await outside;
  assert.deepEqual((await db.query('SELECT v FROM t')).map((r) => r.v), ['outside']);
});

test('a transaction started inside another joins it', async () => {
  await db.run('DELETE FROM t');
  await db.transaction(async (tx) => {
    await tx.run('INSERT INTO t (v) VALUES (?)', ['outer']);
    await tx.transaction(async (inner) => inner.run('INSERT INTO t (v) VALUES (?)', ['inner']));
  });
  assert.equal((await db.query('SELECT count(*) n FROM t'))[0].n, 2);
});
