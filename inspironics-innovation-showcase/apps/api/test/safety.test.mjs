/**
 * The real database is out of reach of tests and of an accidental migration:
 * under the test runner no SQLite file in apps/api/data may be opened, and the
 * migration CLI refuses that directory unless asked for by name. Nothing here
 * opens, creates or touches anything in apps/api/data.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteDb } from '../src/db/sqlite.js'
import { DEFAULT_DATA_DIR, assertTestSafeSqlite, defaultDbRefusal, isInDefaultDataDir } from '../src/db/safety.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const real = path.join(DEFAULT_DATA_DIR, 'app.db')
const stamp = (p) => (existsSync(p) ? statSync(p).mtimeMs : null)

test('the default data directory is apps/api/data', () => {
  assert.equal(DEFAULT_DATA_DIR, path.resolve(HERE, '..', 'data'))
  assert.ok(isInDefaultDataDir(real))
  assert.ok(isInDefaultDataDir(path.join(DEFAULT_DATA_DIR, 'sub', 'x.db')))
  assert.ok(!isInDefaultDataDir(':memory:'))
  assert.ok(!isInDefaultDataDir(path.join(os.tmpdir(), 'x.db')))
  assert.ok(!isInDefaultDataDir(`${DEFAULT_DATA_DIR}-other${path.sep}x.db`), 'a sibling with the same prefix is not inside')
})

test('under the test runner, opening a SQLite file in the real data directory throws before anything is touched', () => {
  assert.ok(process.env.NODE_TEST_CONTEXT, 'this runs under node --test')
  const before = stamp(real)
  assert.throws(() => createSqliteDb(real), /Refusing to open .* under the test runner/)
  assert.throws(() => createSqliteDb(path.join(DEFAULT_DATA_DIR, 'never-created', 'x.db')), /Refusing/)
  assert.equal(existsSync(path.join(DEFAULT_DATA_DIR, 'never-created')), false, 'no directory was created')
  assert.equal(stamp(real), before, 'the real file is untouched')
  assert.doesNotThrow(() => assertTestSafeSqlite(real, {}), 'outside the test runner the server opens it as before')

  const dir = mkdtempSync(path.join(os.tmpdir(), 'insp-safe-'))
  try {
    const db = createSqliteDb(path.join(dir, 'ok.db'))
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the migration CLI refuses the default database unless asked by name, after printing the target', () => {
  assert.match(defaultDbRefusal(real, { argv: [], env: {} }), /Refusing to migrate/)
  assert.equal(defaultDbRefusal(real, { argv: ['--allow-default-db'], env: {} }), null)
  assert.equal(defaultDbRefusal(real, { argv: [], env: { APEX_ALLOW_DEFAULT_DB: '1' } }), null)
  assert.equal(defaultDbRefusal(path.join(os.tmpdir(), 'x.db'), { argv: [], env: {} }), null)

  // The CLI itself, aimed at the default database. It exits before opening anything (and, since it
  // inherits NODE_TEST_CONTEXT, the driver would refuse as well).
  const before = stamp(real)
  const run = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HERE, '../src/db/migrate.js')], {
    env: { ...process.env, DATABASE_URL: '', SQLITE_PATH: real, APEX_ALLOW_DEFAULT_DB: '' },
    encoding: 'utf8',
    timeout: 30_000,
  })
  assert.equal(run.status, 2, run.stderr)
  assert.match(run.stdout, new RegExp(`Migration target: sqlite .*app\\.db`))
  assert.match(run.stderr, /Refusing to migrate .*--allow-default-db/)
  assert.equal(stamp(real), before, 'the real file is untouched')
})
