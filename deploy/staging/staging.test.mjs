/**
 * Unit tests for the staging tooling: secret generation, the smoke test's own helpers, and the
 * consistency of compose.yml with the generated variables. No Docker needed.
 *
 *   node --test deploy/staging/staging.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { parseKeys, verifyAssertion } from '../../apex/identity.mjs'
import { validateStore } from '../../apex/identity-keys.mjs'
import { freshVars, identityVars, newStore, parseEnv, pruneStore, rotateStore, serialise } from './generate-secrets.mjs'
import { INTRUDER, cookieHeader, forgeAssertion, parseEnv as smokeParseEnv, updateJar } from './smoke.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-staging-'))

test('generated variables round-trip through the env file format', () => {
  const vars = freshVars({ port: 4180 })
  const text = serialise(vars)
  assert.deepEqual(parseEnv(text), vars)
  assert.deepEqual(smokeParseEnv(text), vars, 'the smoke test reads the file the same way')
  assert.equal(vars.APEX_PUBLIC_URL, 'http://localhost:4180')
  assert.ok(vars.BOOTSTRAP_ADMIN_PASSWORD.length >= 8)
  assert.match(vars.BOOTSTRAP_ADMIN_EMAIL, /\.invalid$/)
  for (const k of ['CORE_DB_PASSWORD', 'SHOWCASE_DB_PASSWORD', 'SLIDESVAULT_DB_PASSWORD', 'POSTGRES_PASSWORD']) {
    assert.match(vars[k], /^[0-9a-f]{48}$/, `${k} is URL-safe (it goes into DATABASE_URL)`)
  }
  assert.equal(Buffer.from(vars.SLIDESVAULT_TOKEN_ENCRYPTION_KEY, 'base64').length, 32)
  assert.equal(Buffer.from(vars.CORE_TOKEN_ENCRYPTION_KEY, 'base64').length, 32)
  assert.equal(Buffer.from(vars.SHOWCASE_ENCRYPTION_KEY, 'hex').length, 32)
  assert.notEqual(freshVars().POSTGRES_PASSWORD, vars.POSTGRES_PASSWORD, 'random every time')
})

test('each service gets only its own audience keys; the gateway the whole store', () => {
  const store = newStore()
  const v = identityVars(store)
  assert.deepEqual(validateStore(JSON.parse(v.APEX_IDENTITY_KEYS_STORE)), store)
  assert.equal(v.APEX_IDENTITY_KID, store.current)
  const sets = ['CORE', 'SHOWCASE', 'SLIDESVAULT'].map((a) => JSON.parse(v[`APEX_IDENTITY_KEYS_${a}`]))
  for (const s of sets) assert.deepEqual(Object.keys(s), [store.current])
  const values = sets.map((s) => s[store.current])
  assert.equal(new Set(values).size, 3, 'no key shared across audiences')
  assert.deepEqual(values, [store.keys[store.current].core, store.keys[store.current].showcase, store.keys[store.current].slidesvault])
})

test('rotation keeps the previous kid for overlap; prune drops it', () => {
  const first = newStore()
  const rotated = rotateStore(first)
  assert.notEqual(rotated.current, first.current)
  assert.deepEqual(Object.keys(rotated.keys).sort(), [first.current, rotated.current].sort())
  assert.deepEqual(rotated.keys[first.current], first.keys[first.current])
  const twice = rotateStore(rotated)
  assert.equal(Object.keys(twice.keys).length, 2, 'older kids are dropped')
  const pruned = pruneStore(rotated)
  assert.deepEqual(Object.keys(pruned.keys), [rotated.current])
  // After rotation, an app holding both kids accepts assertions under either.
  const showcaseKeys = parseKeys(JSON.parse(identityVars(rotated).APEX_IDENTITY_KEYS_SHOWCASE))
  for (const kid of [first.current, rotated.current]) {
    const key = Buffer.from(rotated.keys[kid].showcase, 'base64')
    const header = forgeAssertion({ kid, key, audience: 'showcase', claims: INTRUDER })
    assert.equal(verifyAssertion(header, { keys: showcaseKeys, audience: 'showcase' }).ok, true)
  }
})

test('the CLI writes a 0600 file, refuses to overwrite, and rotates in place', () => {
  const out = path.join(tmp, '.env.staging')
  const cli = (...args) => execFileSync(process.execPath, [path.join(HERE, 'generate-secrets.mjs'), '--out', out, ...args], { encoding: 'utf8' })
  cli()
  const before = parseEnv(fs.readFileSync(out, 'utf8'))
  if (process.platform !== 'win32') assert.equal(fs.statSync(out).mode & 0o777, 0o600)
  assert.throws(() => cli(), /already exists/)
  const printed = cli('--rotate-identity-keys')
  const after = parseEnv(fs.readFileSync(out, 'utf8'))
  assert.notEqual(after.APEX_IDENTITY_KID, before.APEX_IDENTITY_KID)
  assert.equal(after.POSTGRES_PASSWORD, before.POSTGRES_PASSWORD, 'other secrets kept')
  assert.equal(after.BOOTSTRAP_ADMIN_PASSWORD, before.BOOTSTRAP_ADMIN_PASSWORD)
  assert.deepEqual(Object.keys(JSON.parse(after.APEX_IDENTITY_KEYS_STORE).keys).sort(), [before.APEX_IDENTITY_KID, after.APEX_IDENTITY_KID].sort())
  for (const secret of [after.BOOTSTRAP_ADMIN_PASSWORD, after.POSTGRES_PASSWORD, JSON.parse(after.APEX_IDENTITY_KEYS_CORE)[after.APEX_IDENTITY_KID]]) {
    assert.ok(!printed.includes(secret), 'no secret is printed')
  }
  cli('--prune-identity-keys')
  assert.deepEqual(Object.keys(JSON.parse(parseEnv(fs.readFileSync(out, 'utf8')).APEX_IDENTITY_KEYS_STORE).keys), [after.APEX_IDENTITY_KID])
})

test('forged assertions have the gateway format: refused for the key, not for their shape', () => {
  const realKey = crypto.randomBytes(32)
  const keys = parseKeys({ kreal: realKey.toString('base64') })
  const ok = forgeAssertion({ kid: 'kreal', key: realKey, audience: 'slidesvault', claims: INTRUDER })
  assert.equal(verifyAssertion(ok, { keys, audience: 'slidesvault' }).ok, true, 'with the real key it would verify')
  const wrongKey = forgeAssertion({ kid: 'kreal', key: crypto.randomBytes(32), audience: 'slidesvault', claims: INTRUDER })
  assert.equal(verifyAssertion(wrongKey, { keys, audience: 'slidesvault' }).reason, 'signature')
  const unknownKid = forgeAssertion({ kid: 'kforged', key: crypto.randomBytes(32), audience: 'slidesvault', claims: INTRUDER })
  assert.equal(verifyAssertion(unknownKid, { keys, audience: 'slidesvault' }).reason, 'unknown_kid')
  const service = forgeAssertion({ kid: 'kreal', key: realKey, audience: 'core' })
  assert.equal(verifyAssertion(service, { keys, audience: 'core', requireSubject: false }).ok, true)
})

test('cookie jar keeps live cookies and drops cleared ones', () => {
  const jar = new Map()
  updateJar(jar, ['apex_session=abc; Path=/; HttpOnly; SameSite=Lax', 'iea_session=def; Path=/academia/; HttpOnly'])
  assert.equal(cookieHeader(jar), 'apex_session=abc; iea_session=def')
  updateJar(jar, ['apex_session=; Path=/; Max-Age=0', 'iea_session=x; Expires=Thu, 01 Jan 1970 00:00:00 GMT'])
  assert.equal(jar.size, 0)
})

test('compose.yml reads only variables that are generated, defaulted or documented', () => {
  const compose = fs.readFileSync(path.join(HERE, 'compose.yml'), 'utf8').replace(/\r\n/g, '\n') // CRLF on a Windows checkout
  const example = fs.readFileSync(path.join(HERE, '.env.staging.example'), 'utf8')
  const generated = new Set(Object.keys(freshVars()))
  const documented = new Set([...example.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1]))
  const used = [...compose.matchAll(/\$\{([A-Z][A-Z0-9_]*)(:?[-?][^}]*)?\}/g)].map((m) => ({ name: m[1], defaulted: (m[2] || '').includes('-') }))
  assert.ok(used.length > 20)
  for (const { name, defaulted } of used) {
    assert.ok(documented.has(name), `${name} is documented in .env.staging.example`)
    assert.ok(generated.has(name) || defaulted, `${name} is generated or has a default`)
  }
  for (const name of generated) assert.ok(documented.has(name), `${name} is documented`)
  // Only the gateway publishes, and only on loopback.
  const ports = [...compose.matchAll(/^\s+ports:\s*\n((?:\s+-.*\n)+)/gm)].map((m) => m[1].trim())
  assert.equal(ports.length, 1)
  assert.match(ports[0], /^- '127\.0\.0\.1:/)
  // Each service holds its own audience's keys only.
  assert.equal((compose.match(/^\s+APEX_IDENTITY_KEYS_STORE:/gm) || []).length, 1)
  for (const a of ['CORE', 'SHOWCASE', 'SLIDESVAULT']) assert.equal((compose.match(new RegExp(`\\$\\{APEX_IDENTITY_KEYS_${a}\\b`, 'g')) || []).length, 1)
})

test('backup files: encrypted round trip; wrong key or one flipped byte is refused with no output', async () => {
  const { decryptFile, encryptTo, parseKey, verifyFile } = await import('./backup.mjs')
  const { Readable } = await import('node:stream')
  const key = crypto.randomBytes(32)
  const plain = crypto.randomBytes(300_000)
  const enc = path.join(tmp, 'db.dump.enc')
  await encryptTo(Readable.from([plain.subarray(0, 100_000), plain.subarray(100_000)]), enc, key)
  const raw = fs.readFileSync(enc)
  assert.ok(raw.subarray(0, 8).equals(Buffer.from('APEXBK1\n')))
  assert.equal(raw.indexOf(plain.subarray(0, 64)), -1, 'nothing in clear')
  assert.equal(await verifyFile(enc, key), true)
  const out = path.join(tmp, 'db.dump')
  await decryptFile(enc, out, key)
  assert.ok(fs.readFileSync(out).equals(plain))

  assert.equal(await verifyFile(enc, crypto.randomBytes(32)), false)
  await assert.rejects(decryptFile(enc, path.join(tmp, 'wrong'), crypto.randomBytes(32)), /cannot decrypt/)
  assert.equal(fs.existsSync(path.join(tmp, 'wrong')), false)
  assert.equal(fs.existsSync(path.join(tmp, 'wrong.partial')), false)
  const tampered = Buffer.from(raw)
  tampered[5000] ^= 1
  fs.writeFileSync(path.join(tmp, 't.enc'), tampered)
  assert.equal(await verifyFile(path.join(tmp, 't.enc'), key), false)

  const empty = path.join(tmp, 'empty.enc')
  await encryptTo(Readable.from([]), empty, key)
  await decryptFile(empty, path.join(tmp, 'empty'), key)
  assert.equal(fs.readFileSync(path.join(tmp, 'empty')).length, 0)

  assert.throws(() => parseKey(''), /32 random bytes/)
  assert.throws(() => parseKey(crypto.randomBytes(16).toString('base64')), /32 random bytes/)
  assert.equal(parseKey(key.toString('base64')).length, 32)
})

test('backup retention drops old sets, always keeps the newest three, ignores other folders', async () => {
  const { expiredSets, setName } = await import('./backup.mjs')
  const now = Date.UTC(2026, 10, 30, 12, 0, 0)
  const day = (d) => setName(new Date(now - d * 86_400_000))
  assert.match(day(0), /^\d{8}T\d{6}Z$/)
  const names = [day(1), day(5), day(20), day(40), 'notes', '20260101T000000Z.partial']
  assert.deepEqual(expiredSets(names, { now, retentionDays: 14 }).sort(), [day(40)].sort(), 'day 20 is one of the newest three')
  assert.deepEqual(expiredSets([...names, day(2)], { now, retentionDays: 14 }).sort(), [day(20), day(40)].sort())
  assert.deepEqual(expiredSets([day(100), day(200), day(300)], { now, retentionDays: 14 }), [], 'a stopped schedule never ages every set away')
})

test('generate-secrets --add-missing adds new variables (the backup key) and keeps the rest', () => {
  const out = path.join(tmp, '.env.addmissing')
  const cli = (...args) => execFileSync(process.execPath, [path.join(HERE, 'generate-secrets.mjs'), '--out', out, ...args], { encoding: 'utf8' })
  cli()
  const original = parseEnv(fs.readFileSync(out, 'utf8'))
  const { BACKUP_ENCRYPTION_KEY: _dropped, ...older } = original
  fs.writeFileSync(out, serialise(older))
  const printed = cli('--add-missing')
  assert.match(printed, /Added BACKUP_ENCRYPTION_KEY/)
  const after = parseEnv(fs.readFileSync(out, 'utf8'))
  assert.equal(Buffer.from(after.BACKUP_ENCRYPTION_KEY, 'base64').length, 32)
  assert.ok(!printed.includes(after.BACKUP_ENCRYPTION_KEY), 'the key is not printed')
  for (const [k, v] of Object.entries(older)) assert.equal(after[k], v, `${k} kept`)
  assert.match(cli('--add-missing'), /already has every variable/)
})

test('backup key rotation: (a) old sets still decrypt and verify, (b) new sets need the new key, (c) a wrong key fails', async () => {
  const { decryptFile, encryptTo, verifyFile } = await import('./backup.mjs')
  const { Readable } = await import('node:stream')
  const oldKey = crypto.randomBytes(32)
  const olderKey = crypto.randomBytes(32)
  const newKey = crypto.randomBytes(32)
  const plain = crypto.randomBytes(50_000)
  const oldSet = path.join(tmp, 'rot-old.enc')
  const olderSet = path.join(tmp, 'rot-older.enc')
  const newSet = path.join(tmp, 'rot-new.enc')
  await encryptTo(Readable.from([plain]), oldSet, oldKey)
  await encryptTo(Readable.from([plain]), olderSet, olderKey)
  await encryptTo(Readable.from([plain]), newSet, newKey)
  const ring = [newKey, oldKey, olderKey]

  for (const set of [oldSet, olderSet, newSet]) {
    assert.equal(await verifyFile(set, ring), true)
    const out = `${set}.out`
    await decryptFile(set, out, ring)
    assert.ok(fs.readFileSync(out).equals(plain))
  }
  assert.equal(await verifyFile(newSet, [oldKey, olderKey]), false, 'a new set does not open with the old keys')
  await assert.rejects(decryptFile(newSet, path.join(tmp, 'rot-x'), oldKey), /cannot decrypt/)

  await assert.rejects(decryptFile(oldSet, path.join(tmp, 'rot-wrong'), [newKey, crypto.randomBytes(32)]), /cannot decrypt .*tried 2 keys/)
  assert.equal(fs.existsSync(path.join(tmp, 'rot-wrong')), false)
  assert.equal(fs.existsSync(path.join(tmp, 'rot-wrong.partial')), false)
  assert.equal(await verifyFile(oldSet, [newKey, crypto.randomBytes(32)]), false)
})

test('backup key rotation: (d) BACKUP_ENCRYPTION_KEY_PREVIOUS is validated like the main key; the CLI uses it', async () => {
  const { parsePreviousKeys, encryptTo } = await import('./backup.mjs')
  const { Readable } = await import('node:stream')
  const k1 = crypto.randomBytes(32).toString('base64')
  const k2 = crypto.randomBytes(32).toString('base64')
  assert.deepEqual(parsePreviousKeys(''), [])
  assert.equal(parsePreviousKeys(`${k1}, ${k2}`).length, 2)
  assert.throws(() => parsePreviousKeys(`${k1},c2hvcnQ=`), /BACKUP_ENCRYPTION_KEY_PREVIOUS entry 2 must be 32 random bytes/)
  try {
    parsePreviousKeys('c2hvcnQ=')
  } catch (error) {
    assert.ok(!error.message.includes('c2hvcnQ='), 'the value is not echoed')
  }

  // The CLI: a set made with the old key verifies and decrypts after rotation, via the env file.
  const setDir = path.join(tmp, 'sets', '20261118T020000Z')
  fs.mkdirSync(setDir, { recursive: true })
  const plain = Buffer.from('pg_dump bytes')
  await encryptTo(Readable.from([plain]), path.join(setDir, 'core.dump.enc'), Buffer.from(k1, 'base64'))
  const { sha256File } = await import('./backup.mjs')
  fs.writeFileSync(path.join(setDir, 'manifest.json'), JSON.stringify({ set: '20261118T020000Z', files: [{ file: 'core.dump.enc', sha256: await sha256File(path.join(setDir, 'core.dump.enc')) }] }))
  const envFile = path.join(tmp, '.env.backup-rot')
  const env = { ...process.env }
  delete env.BACKUP_ENCRYPTION_KEY
  delete env.BACKUP_ENCRYPTION_KEY_PREVIOUS
  const backup = (vars, ...args) => {
    fs.writeFileSync(envFile, serialise(vars))
    try {
      return { code: 0, out: execFileSync(process.execPath, [path.join(HERE, 'backup.mjs'), ...args, '--env-file', envFile], { encoding: 'utf8', env, stdio: 'pipe' }) }
    } catch (error) {
      return { code: error.status, out: `${error.stdout}${error.stderr}` }
    }
  }
  assert.equal(backup({ BACKUP_ENCRYPTION_KEY: k2 }, 'verify', setDir).code, 1, 'without the previous key the old set fails')
  const ok = backup({ BACKUP_ENCRYPTION_KEY: k2, BACKUP_ENCRYPTION_KEY_PREVIOUS: k1 }, 'verify', setDir)
  assert.equal(ok.code, 0, ok.out)
  assert.match(ok.out, /verified: 1 files/)
  const out = path.join(tmp, 'core.dump')
  assert.equal(backup({ BACKUP_ENCRYPTION_KEY: k2, BACKUP_ENCRYPTION_KEY_PREVIOUS: k1 }, 'decrypt', path.join(setDir, 'core.dump.enc'), out).code, 0)
  assert.ok(fs.readFileSync(out).equals(plain))
  const bad = backup({ BACKUP_ENCRYPTION_KEY: k2, BACKUP_ENCRYPTION_KEY_PREVIOUS: 'c2hvcnQ=' }, 'verify', setDir)
  assert.equal(bad.code, 1)
  assert.match(bad.out, /BACKUP_ENCRYPTION_KEY_PREVIOUS must be 32 random bytes/)
  for (const k of [k1, k2]) assert.ok(!ok.out.includes(k) && !bad.out.includes(k), 'no key printed')
})

test('generate-secrets --rotate moves the current key to <NAME>_PREVIOUS and writes a fresh one', () => {
  const out = path.join(tmp, '.env.rotate')
  const cli = (...args) => execFileSync(process.execPath, [path.join(HERE, 'generate-secrets.mjs'), '--out', out, ...args], { encoding: 'utf8', stdio: 'pipe' })
  cli()
  const first = parseEnv(fs.readFileSync(out, 'utf8'))
  const printed = cli('--rotate', 'CORE_TOKEN_ENCRYPTION_KEY')
  const second = parseEnv(fs.readFileSync(out, 'utf8'))
  if (process.platform !== 'win32') assert.equal(fs.statSync(out).mode & 0o777, 0o600)
  assert.notEqual(second.CORE_TOKEN_ENCRYPTION_KEY, first.CORE_TOKEN_ENCRYPTION_KEY)
  assert.equal(Buffer.from(second.CORE_TOKEN_ENCRYPTION_KEY, 'base64').length, 32)
  assert.equal(second.CORE_TOKEN_ENCRYPTION_KEY_PREVIOUS, first.CORE_TOKEN_ENCRYPTION_KEY)
  for (const [k, v] of Object.entries(first)) if (!k.startsWith('CORE_TOKEN_ENCRYPTION_KEY')) assert.equal(second[k], v, `${k} kept`)
  for (const k of [first.CORE_TOKEN_ENCRYPTION_KEY, second.CORE_TOKEN_ENCRYPTION_KEY]) assert.ok(!printed.includes(k), 'no key printed')

  cli('--rotate', 'CORE_TOKEN_ENCRYPTION_KEY')
  const third = parseEnv(fs.readFileSync(out, 'utf8'))
  assert.equal(third.CORE_TOKEN_ENCRYPTION_KEY_PREVIOUS, `${second.CORE_TOKEN_ENCRYPTION_KEY},${first.CORE_TOKEN_ENCRYPTION_KEY}`, 'newest first')

  cli('--rotate', 'SHOWCASE_ENCRYPTION_KEY')
  const fourth = parseEnv(fs.readFileSync(out, 'utf8'))
  assert.match(fourth.SHOWCASE_ENCRYPTION_KEY, /^[0-9a-f]{64}$/, 'same encoding as generated')
  assert.equal(fourth.SHOWCASE_ENCRYPTION_KEY_PREVIOUS, third.SHOWCASE_ENCRYPTION_KEY)
  cli('--rotate', 'BACKUP_ENCRYPTION_KEY')
  assert.equal(parseEnv(fs.readFileSync(out, 'utf8')).BACKUP_ENCRYPTION_KEY_PREVIOUS, fourth.BACKUP_ENCRYPTION_KEY)

  assert.throws(() => cli('--rotate', 'POSTGRES_PASSWORD'), /--rotate takes one of/)
  assert.throws(() => cli('--rotate'), /--rotate takes one of/)
})
