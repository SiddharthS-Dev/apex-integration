import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { after, test } from 'node:test';

// Safeguards against targeting the real database (db/safety.js). Nothing here may open or write any file
// under apps/api/data: the probes use paths that do not exist, and the default database is only stat'ed.
const run = promisify(execFile);
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(apiRoot, 'data');
const { DEFAULT_DATA_DIR, isInDefaultDataDir, cliTargetCheck, describeTarget, assertNotDefaultDbUnderTest } = await import('../src/db/safety.js');
const { createSqliteDriver } = await import('../src/db/sqlite.js');

const probeDir = path.join(dataDir, `__safety-probe-${process.pid}__`);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-safety-'));
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
  // Only ever created if a guard failed; removed so a failure leaves nothing behind.
  fs.rmSync(probeDir, { recursive: true, force: true });
});

const statOf = (f) => { try { const s = fs.statSync(f); return { size: s.size, mtimeMs: s.mtimeMs }; } catch { return null; } };
const defaultFiles = ['academy.db', 'academy.db-wal', 'academy.db-shm'].map((f) => path.join(dataDir, f));
const snapshot = () => defaultFiles.map(statOf);

function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ['SQLITE_PATH', 'DATA_DIR', 'DATABASE_URL', 'APEX_ALLOW_DEFAULT_DB']) if (!(k in extra)) delete env[k];
  return env;
}
const cli = (rel, args, env) => run(process.execPath, [path.join(apiRoot, rel), ...args], { cwd: tmp, env, windowsHide: true, timeout: 60_000 })
  .then((r) => ({ code: 0, ...r }), (e) => ({ code: e.code, stdout: e.stdout, stderr: e.stderr }));

test('the default data directory is apps/api/data and path matching is exact', () => {
  assert.equal(DEFAULT_DATA_DIR, dataDir);
  assert.equal(isInDefaultDataDir(path.join(dataDir, 'academy.db')), true);
  assert.equal(isInDefaultDataDir(path.join(dataDir, 'sub', 'x.db')), true);
  assert.equal(isInDefaultDataDir(path.join(apiRoot, 'data-copy', 'academy.db')), false);
  assert.equal(isInDefaultDataDir(path.join(tmp, 'academy.db')), false);
  assert.equal(isInDefaultDataDir(':memory:'), false);
  if (process.platform === 'win32') assert.equal(isInDefaultDataDir(path.join(dataDir.toUpperCase(), 'academy.db')), true);
});

test('CLI decision: default data dir refused unless explicitly allowed; Postgres target redacted', () => {
  const sqlitePath = path.join(dataDir, 'academy.db');
  assert.equal(cliTargetCheck({ databaseUrl: '', sqlitePath }, [], {}).ok, false);
  assert.equal(cliTargetCheck({ databaseUrl: '', sqlitePath }, ['--allow-default-db'], {}).ok, true);
  assert.equal(cliTargetCheck({ databaseUrl: '', sqlitePath }, [], { APEX_ALLOW_DEFAULT_DB: '1' }).ok, true);
  assert.equal(cliTargetCheck({ databaseUrl: '', sqlitePath }, [], { APEX_ALLOW_DEFAULT_DB: 'true' }).ok, false, 'only the exact value 1');
  assert.equal(cliTargetCheck({ databaseUrl: '', sqlitePath: path.join(tmp, 'x.db') }, [], {}).ok, true);
  const pg = describeTarget({ databaseUrl: 'postgres://user:secret@db.internal:5432/core', sqlitePath });
  assert.equal(pg, 'postgres db.internal:5432/core');
  assert.ok(!pg.includes('secret'));
});

test('under the test runner the SQLite driver refuses the default data directory before touching anything', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'running under node --test');
  const probe = path.join(probeDir, 'probe.db');
  assert.throws(() => createSqliteDriver(probe), /Refusing to open .* default data directory/);
  assert.equal(fs.existsSync(probeDir), false, 'no directory or file was created');
  assert.throws(() => assertNotDefaultDbUnderTest(path.join(dataDir, 'academy.db')), /default data directory/);
  assert.doesNotThrow(() => assertNotDefaultDbUnderTest(path.join(dataDir, 'academy.db'), {}), 'outside the test runner (server) it is allowed');
});

test('migrate-cli refuses an SQLITE_PATH inside the default data directory and prints the target', async () => {
  const probe = path.join(probeDir, 'probe.db');
  const r = await cli('src/db/migrate-cli.js', [], cleanEnv({ SQLITE_PATH: probe }));
  assert.equal(r.code, 2, r.stderr);
  assert.match(r.stderr, /migrate: target sqlite .*probe\.db/);
  assert.match(r.stderr, /refusing to run against the default data directory/);
  assert.equal(fs.existsSync(probeDir), false);
});

test('migrate-cli and the Core CLIs with no SQLITE_PATH refuse the default database and leave it untouched', async () => {
  const before = snapshot();
  const cases = [
    ['src/db/migrate-cli.js', [], 'migrate'],
    ['src/core/cli/grant-admin.js', ['--email', 'nobody@example.com', '--reason', 'safety test'], 'core:grant-admin'],
    ['src/core/cli/rollback-identity.js', ['--yes'], 'core:rollback-identity'],
  ];
  for (const [script, args, name] of cases) {
    const r = await cli(script, args, cleanEnv());
    assert.equal(r.code, 2, `${script}: ${r.stderr}`);
    assert.ok(r.stderr.includes(`${name}: target sqlite ${path.join(dataDir, 'academy.db')}`), `${script} prints the resolved target: ${r.stderr}`);
    assert.match(r.stderr, /refusing to run against the default data directory/);
    assert.ok(!/Migrations complete|"ok":true/.test(r.stdout || ''), `${script} did nothing`);
  }
  assert.deepEqual(snapshot(), before, 'academy.db (and its WAL/SHM) unchanged');
  assert.deepEqual(fs.readdirSync(tmp), [], 'nothing written to the working directory');
});

test('migrate-cli still runs against an explicit disposable SQLITE_PATH', async () => {
  const file = path.join(tmp, 'ok', 'cli.db');
  const r = await cli('src/db/migrate-cli.js', [], cleanEnv({ SQLITE_PATH: file, LOG_LEVEL: 'error' }));
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, /migrate: target sqlite .*cli\.db/);
  assert.match(r.stdout, /Migrations complete/);
  assert.ok(fs.existsSync(file));
});
