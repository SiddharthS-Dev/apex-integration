/**
 * The real database is out of reach of tests and of an accidental migration:
 * under the test runner no SQLite file in apps/api/data may be opened, and the
 * migration CLI refuses that directory unless asked for by name. Nothing here
 * opens, creates or touches anything in apps/api/data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSqliteDriver } from '../../src/db/sqliteDriver.js';
import { DEFAULT_DATA_DIR, assertTestSafeSqlite, defaultDbRefusal, isInDefaultDataDir } from '../../src/db/safety.js';
import { SERVER_ROOT } from '../../src/config/index.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const real = path.join(DEFAULT_DATA_DIR, 'slidesvault.db');
const stamp = (p) => (fs.existsSync(p) ? fs.statSync(p).mtimeMs : null);

test('the default data directory is the one the config defaults to', () => {
  assert.equal(DEFAULT_DATA_DIR, path.join(SERVER_ROOT, 'data'));
  assert.ok(isInDefaultDataDir(real));
  assert.ok(!isInDefaultDataDir(':memory:'));
  assert.ok(!isInDefaultDataDir(path.join(os.tmpdir(), 'x.db')));
  assert.ok(!isInDefaultDataDir(`${DEFAULT_DATA_DIR}-other${path.sep}x.db`));
});

test('under the test runner, opening a SQLite file in the real data directory throws before anything is touched', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this runs under node --test');
  const before = stamp(real);
  assert.throws(() => createSqliteDriver({ db: { file: real } }), /Refusing to open .* under the test runner/);
  assert.throws(() => createSqliteDriver({ db: { file: path.join(DEFAULT_DATA_DIR, 'never-created', 'x.db') } }), /Refusing/);
  assert.equal(fs.existsSync(path.join(DEFAULT_DATA_DIR, 'never-created')), false, 'no directory was created');
  assert.equal(stamp(real), before, 'the real file is untouched');
  assert.doesNotThrow(() => assertTestSafeSqlite(real, {}), 'outside the test runner the server opens it as before');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-safe-'));
  try {
    const db = createSqliteDriver({ db: { file: path.join(dir, 'ok.db') } });
    db.raw.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the migration CLI refuses the default database unless asked by name, after printing the target', () => {
  assert.match(defaultDbRefusal(real, { argv: [], env: {} }), /Refusing to migrate/);
  assert.equal(defaultDbRefusal(real, { argv: ['--allow-default-db'], env: {} }), null);
  assert.equal(defaultDbRefusal(real, { argv: [], env: { APEX_ALLOW_DEFAULT_DB: '1' } }), null);

  const before = stamp(real);
  const run = spawnSync(process.execPath, [path.join(HERE, '../../scripts/migrate.js')], {
    env: { ...process.env, DB_DRIVER: 'sqlite', DB_FILE: real, APEX_ALLOW_DEFAULT_DB: '', LOG_LEVEL: 'silent' },
    encoding: 'utf8',
    timeout: 30_000,
  });
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stdout, /Migration target: sqlite .*slidesvault\.db/);
  assert.match(run.stderr, /Refusing to migrate .*--allow-default-db/);
  assert.equal(stamp(real), before, 'the real file is untouched');
});
