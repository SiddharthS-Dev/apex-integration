/**
 * ENCRYPTION_KEY rotation: ENCRYPTION_KEY_PREVIOUS, the key ring, and the
 * rewrap-secrets CLI (src/db/rewrap.js). Disposable databases in a temp
 * directory only; the real database is only stat'ed.
 */
import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadConfig } from '../src/config.js'
import { decrypt, decryptWithIndex, encrypt, parseKey, parsePreviousKeys, resolveEncryptionKeys } from '../src/lib/crypto.js'
import { createSqliteDb } from '../src/db/sqlite.js'
import { DEFAULT_DATA_DIR } from '../src/db/safety.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = mkdtempSync(path.join(os.tmpdir(), 'insp-keyrot-'))
after(() => rmSync(tmp, { recursive: true, force: true }))

const AAD = 'dropbox-refresh-token'
const OLD = crypto.randomBytes(32).toString('hex')
const OLDER = crypto.randomBytes(32).toString('base64')
const NEW = crypto.randomBytes(32).toString('hex')
const ring = (env) => resolveEncryptionKeys(loadConfig({ NODE_ENV: 'production', ...env }))

test('(a) ciphertext from the old key opens after rotation; (b) new ciphertext uses the new key only', () => {
  const before = ring({ ENCRYPTION_KEY: OLD })
  const old = encrypt(before, 'refresh-token', AAD)
  const older = encrypt(parseKey(OLDER), 'older-token', AAD)

  const rotated = ring({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: `${OLD},${OLDER}` })
  assert.equal(rotated.length, 3)
  assert.deepEqual(decryptWithIndex(rotated, old, AAD), { plaintext: 'refresh-token', keyIndex: 1 })
  assert.deepEqual(decryptWithIndex(rotated, older, AAD), { plaintext: 'older-token', keyIndex: 2 })
  assert.throws(() => decrypt(rotated, old, 'another-purpose'), /failed authentication/, 'the AAD still binds')

  const fresh = encrypt(rotated, 'new-token', AAD)
  assert.equal(decrypt(parseKey(NEW), fresh, AAD), 'new-token')
  assert.throws(() => decrypt(before, fresh, AAD), /failed authentication/, 'the old key alone cannot open it')
})

test('(c) a wrong key still fails', () => {
  const box = encrypt(parseKey(OLD), 'secret', AAD)
  assert.throws(() => decrypt(ring({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLDER }), box, AAD), /failed authentication/)
  assert.throws(() => decrypt(crypto.randomBytes(32), box, AAD))
})

test('(d) a malformed previous key is rejected: an error in production, a warning otherwise', () => {
  const bad = 'c2hvcnQ='
  const p = parsePreviousKeys(`${OLD}, ${bad}`)
  assert.equal(p.keys.length, 1)
  assert.match(p.errors[0], /ENCRYPTION_KEY_PREVIOUS entry 2 must decode to exactly 32 bytes/)
  assert.ok(!p.errors[0].includes(bad) && !p.errors[0].includes(OLD), 'no key material in the message')

  const prod = loadConfig({ NODE_ENV: 'production', ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: bad })
  assert.ok(prod.problems.some((x) => x.level === 'error' && /ENCRYPTION_KEY_PREVIOUS/.test(x.message)))
  assert.throws(() => resolveEncryptionKeys(prod), /ENCRYPTION_KEY_PREVIOUS must decode/)

  const dev = loadConfig({ NODE_ENV: 'development', ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: `${bad},${OLD}` })
  assert.ok(dev.problems.some((x) => x.level === 'warn' && /ENCRYPTION_KEY_PREVIOUS entry 1/.test(x.message)))
  assert.ok(!dev.problems.some((x) => x.level === 'error' && /PREVIOUS/.test(x.message)))
  const warned = []
  const keys = resolveEncryptionKeys(dev, { warn: (m) => warned.push(m) })
  assert.equal(keys.length, 2, 'the malformed entry is skipped, the good one kept')
  assert.equal(warned.length, 1)
  assert.deepEqual(loadConfig({ ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD }).problems.filter((x) => /PREVIOUS/.test(x.message)), [])
})

/* ------------------------------------------------- (e) rewrap-secrets ------ */

const node = (script, args, env) =>
  spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', path.join(HERE, '..', script), ...args], {
    // Every variable the CLI reads is given explicitly, so apps/api/.env cannot fill one in.
    env: { ...process.env, DATABASE_URL: '', ENCRYPTION_KEY_PREVIOUS: '', APEX_ALLOW_DEFAULT_DB: '', NODE_ENV: 'test', ...env },
    encoding: 'utf8',
    timeout: 60_000,
  })
const lastJson = (out) => JSON.parse(out.trim().split('\n').pop())

test('(e) rewrap-secrets re-encrypts the stored refresh token under the current key on a disposable database', () => {
  const file = path.join(tmp, 'rewrap.db')
  const migrated = node('src/db/migrate.js', [], { SQLITE_PATH: file, ENCRYPTION_KEY: NEW })
  assert.equal(migrated.status, 0, migrated.stderr)

  const now = new Date().toISOString()
  const db = createSqliteDb(file)
  const put = (enc) =>
    db.run(
      `INSERT INTO dropbox_connection (id, account_id, refresh_token_enc, connected_at, updated_at) VALUES (1, 'dbid:1', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET refresh_token_enc = excluded.refresh_token_enc`,
      [enc, now, now]
    )
  return (async () => {
    await put(encrypt(parseKey(OLD), 'stored-token', AAD))
    await db.close()

    const env = { SQLITE_PATH: file, ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD }
    const dry = node('src/db/rewrap.js', ['--dry-run'], env)
    assert.equal(dry.status, 0, dry.stderr)
    assert.match(dry.stdout, /Rewrap target: sqlite .*rewrap\.db/)
    assert.deepEqual(lastJson(dry.stdout), { ok: true, dry_run: true, checked: 1, already_current: 0, rewrapped: 1, changed_meanwhile: 0, failed: [] })

    const r = node('src/db/rewrap.js', [], env)
    assert.equal(r.status, 0, r.stderr)
    assert.deepEqual(lastJson(r.stdout), { ok: true, dry_run: false, checked: 1, already_current: 0, rewrapped: 1, changed_meanwhile: 0, failed: [] })
    for (const s of ['stored-token', OLD, NEW]) assert.ok(!(r.stdout + r.stderr).includes(s), 'nothing secret printed')

    const db2 = createSqliteDb(file)
    const row = await db2.get('SELECT account_id, refresh_token_enc FROM dropbox_connection WHERE id = 1')
    assert.equal(decrypt(parseKey(NEW), row.refresh_token_enc, AAD), 'stored-token')
    assert.throws(() => decrypt(parseKey(OLD), row.refresh_token_enc, AAD))
    assert.equal(row.account_id, 'dbid:1')

    const again = node('src/db/rewrap.js', [], env)
    assert.deepEqual(lastJson(again.stdout).already_current, 1, 'idempotent')

    // A value no configured key opens is reported and left as it is.
    const stranger = encrypt(crypto.randomBytes(32), 'x', AAD)
    await db2.run('UPDATE dropbox_connection SET refresh_token_enc = ? WHERE id = 1', [stranger])
    await db2.close()
    const failed = node('src/db/rewrap.js', [], env)
    assert.equal(failed.status, 1)
    assert.deepEqual(lastJson(failed.stdout).failed, ['dropbox_connection.refresh_token_enc#1'])

    const malformed = node('src/db/rewrap.js', [], { ...env, ENCRYPTION_KEY_PREVIOUS: 'short' })
    assert.equal(malformed.status, 1)
    assert.match(malformed.stderr, /ENCRYPTION_KEY_PREVIOUS must decode/)
  })()
})

test('(e) rewrap-secrets refuses the default database unless asked by name, and leaves it untouched', () => {
  const real = path.join(DEFAULT_DATA_DIR, 'app.db')
  const stamp = (p) => (existsSync(p) ? statSync(p).mtimeMs : null)
  const before = [real, `${real}-wal`, `${real}-shm`].map(stamp)
  const r = node('src/db/rewrap.js', [], { SQLITE_PATH: real, ENCRYPTION_KEY: NEW, ENCRYPTION_KEY_PREVIOUS: OLD })
  assert.equal(r.status, 2, r.stderr)
  assert.match(r.stdout, /Rewrap target: sqlite .*app\.db/)
  assert.match(r.stderr, /Refusing to rewrap secrets in .*--allow-default-db/)
  assert.deepEqual([real, `${real}-wal`, `${real}-shm`].map(stamp), before)
})

test('a truncated GCM tag is rejected, not accepted with a weaker check', () => {
  const key = crypto.randomBytes(32)
  const [v, iv, tag, body] = encrypt(key, 'refresh-token', AAD).split('.')
  const short = Buffer.from(tag, 'base64url').subarray(0, 4).toString('base64url')
  assert.throws(() => decrypt(key, [v, iv, short, body].join('.'), AAD))
  assert.equal(decrypt(key, [v, iv, tag, body].join('.'), AAD), 'refresh-token')
})
