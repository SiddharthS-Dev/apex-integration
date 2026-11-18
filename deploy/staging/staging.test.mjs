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
  const compose = fs.readFileSync(path.join(HERE, 'compose.yml'), 'utf8')
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
