/**
 * The assertion format, the key file and what run.mjs hands each process.
 * No servers. node:test only, like the rest of the gateway.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  accessFor,
  issueAssertion,
  parseIdentityMode,
  parseKeys,
  parseTrustedSources,
  signAssertion,
  verifyAssertion,
} from './identity.mjs'
import { keysFor, loadKeys, prune, readKeys, rotate, signingKey } from './identity-keys.mjs'
import { identityEnv, identityMode } from './gateway-identity.mjs'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-identity-'))
const KEY = crypto.randomBytes(32)
const keys = new Map([['k1', KEY]])
const NOW = Date.UTC(2026, 10, 14, 12, 0, 0)
const nowS = Math.floor(NOW / 1000)
const claims = { sub: 'core-user-1', app_user_id: null, email: 'a@x.io', name: 'A', roles: [{ role: 'staff', scope_type: 'organization', scope_id: 'o1' }] }
const opts = { keys, audience: 'showcase', now: NOW }

test('an issued assertion verifies, with 60 s of life and the claims intact', () => {
  const header = issueAssertion({ audience: 'showcase', kid: 'k1', key: KEY, claims, now: NOW })
  const r = verifyAssertion(header, opts)
  assert.equal(r.ok, true)
  assert.equal(r.claims.iss, 'apex-gateway')
  assert.equal(r.claims.aud, 'showcase')
  assert.equal(r.claims.sub, 'core-user-1')
  assert.equal(r.claims.exp - r.claims.iat, 60)
  assert.deepEqual(r.claims.roles, claims.roles)
})

test('claims cannot override iss, aud, iat or exp', () => {
  const header = issueAssertion({ audience: 'showcase', kid: 'k1', key: KEY, claims: { ...claims, iss: 'evil', aud: 'slidesvault', exp: nowS + 9999 }, now: NOW })
  const r = verifyAssertion(header, opts)
  assert.equal(r.ok, true)
  assert.equal(r.claims.iss, 'apex-gateway')
  assert.equal(r.claims.aud, 'showcase')
  assert.equal(r.claims.exp, nowS + 60)
})

test('verification refuses, in order: format, kid, signature, iss, aud, time, source', () => {
  const sign = (payload, kid = 'k1', key = KEY) => signAssertion(payload, { kid, key })
  const base = { iss: 'apex-gateway', aud: 'showcase', ...claims, iat: nowS, exp: nowS + 60 }
  const good = sign(base)
  const [kid, body, sig] = good.split('.')
  const flipped = sig[0] === 'A' ? `B${sig.slice(1)}` : `A${sig.slice(1)}`
  const cases = [
    ['format', undefined],
    ['format', 'not-an-assertion'],
    ['format', `${kid}.${body}`],
    ['format', `${kid}.${body}.${sig}.x`],
    ['format', `k 1.${body}.${sig}`],
    ['unknown_kid', sign(base, 'k9')],
    ['signature', `${kid}.${body}.${flipped}`],
    ['signature', sign(base, 'k1', crypto.randomBytes(32))],
    ['signature', `${kid}.${Buffer.from(JSON.stringify({ ...base, sub: 'other' })).toString('base64url')}.${sig}`],
    ['issuer', sign({ ...base, iss: 'someone' })],
    ['audience', sign({ ...base, aud: 'slidesvault' })],
    ['expired', sign({ ...base, iat: nowS - 120, exp: nowS })],
    ['not_yet_valid', sign({ ...base, iat: nowS + 31, exp: nowS + 91 })],
    ['lifetime', sign({ ...base, iat: nowS, exp: nowS + 121 })],
    ['subject', sign({ ...base, sub: '' })],
  ]
  for (const [reason, header] of cases) {
    assert.deepEqual(verifyAssertion(header, opts), { ok: false, reason }, `expected ${reason} for ${header}`)
  }
  // Clock skew up to 30 s is allowed; 120 s of life is the most accepted.
  assert.equal(verifyAssertion(sign({ ...base, iat: nowS + 30, exp: nowS + 90 }), opts).ok, true)
  assert.equal(verifyAssertion(sign({ ...base, iat: nowS, exp: nowS + 120 }), opts).ok, true)
  // Source last: a trusted peer passes, anything else is refused.
  const loop = parseTrustedSources()
  assert.equal(verifyAssertion(good, { ...opts, trustedSources: loop, sourceAddress: '127.0.0.1' }).ok, true)
  assert.equal(verifyAssertion(good, { ...opts, trustedSources: loop, sourceAddress: '::ffff:127.0.0.1' }).ok, true)
  assert.equal(verifyAssertion(good, { ...opts, trustedSources: loop, sourceAddress: '::1' }).ok, true)
  assert.deepEqual(verifyAssertion(good, { ...opts, trustedSources: loop, sourceAddress: '10.0.0.5' }), { ok: false, reason: 'source' })
  assert.deepEqual(verifyAssertion(good, { ...opts, trustedSources: loop, sourceAddress: undefined }), { ok: false, reason: 'source' })
})

test('a service assertion has no subject and is verified with requireSubject false', () => {
  const header = issueAssertion({ audience: 'core', kid: 'k1', key: KEY, now: NOW })
  assert.equal(verifyAssertion(header, { keys, audience: 'core', now: NOW, requireSubject: false }).ok, true)
  assert.equal(verifyAssertion(header, { keys, audience: 'core', now: NOW }).reason, 'subject')
})

test('trusted sources: loopback, addresses and CIDRs; nonsense is reported', () => {
  const s = parseTrustedSources('10.0.0.0/8, 192.168.1.7, fd00::/8, nonsense, 1.2.3.4/40')
  assert.deepEqual(s.invalid, ['nonsense', '1.2.3.4/40'])
  assert.equal(s.matches('10.200.1.1'), true)
  assert.equal(s.matches('192.168.1.7'), true)
  assert.equal(s.matches('192.168.1.8'), false)
  assert.equal(s.matches('fd12::1'), true)
  assert.equal(s.matches('127.0.0.1'), false, 'loopback only when listed')
  assert.equal(parseTrustedSources('').matches('127.0.0.1'), true, 'the default is loopback')
})

test('parseKeys keeps only well-formed kids with 32-byte keys', () => {
  const good = crypto.randomBytes(32).toString('base64')
  const map = parseKeys(JSON.stringify({ k1: good, 'bad kid': good, k2: Buffer.alloc(16).toString('base64'), k3: 7 }))
  assert.deepEqual([...map.keys()], ['k1'])
  assert.equal(parseKeys('not json').size, 0)
  assert.equal(parseKeys('').size, 0)
})

test('accessFor: platform_admin or app_admin for this app is admin; other roles member; none null', () => {
  assert.equal(accessFor([{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }], 'showcase'), 'admin')
  assert.equal(accessFor([{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }], 'showcase'), 'admin')
  assert.equal(accessFor([{ role: 'app_admin', scope_type: 'app', scope_id: 'slidesvault' }], 'showcase'), 'member')
  assert.equal(accessFor([{ role: 'learner', scope_type: 'platform', scope_id: '' }], 'showcase'), 'member')
  assert.equal(accessFor([], 'showcase'), null)
  assert.equal(accessFor(undefined, 'showcase'), null)
})

test('modes: off by default, per-app override, a typo fails closed', () => {
  assert.equal(parseIdentityMode(undefined), 'off')
  assert.equal(parseIdentityMode('Required'), 'required')
  assert.equal(parseIdentityMode('requried'), null)
  assert.equal(identityMode('showcase', {}), 'off')
  assert.equal(identityMode('vault', { APEX_IDENTITY_MODE: 'optional' }), 'optional')
  assert.equal(identityMode('vault', { APEX_IDENTITY_MODE: 'optional', APEX_IDENTITY_MODE_SLIDESVAULT: 'required' }), 'required')
  assert.equal(identityMode('showcase', { APEX_IDENTITY_MODE: 'optional', APEX_IDENTITY_MODE_SLIDESVAULT: 'required' }), 'optional')
  assert.equal(identityMode('showcase', { APEX_IDENTITY_MODE: 'onn' }), 'required')
  assert.equal(identityMode('academia', { APEX_IDENTITY_MODE: 'required' }), 'off')
})

test('key file: created once, rotate keeps the previous kid, prune drops it', () => {
  const file = path.join(tmp, 'keys-rotate.json')
  const first = loadKeys(file)
  assert.deepEqual(loadKeys(file), first, 'a second load reads the same file')
  assert.equal(Object.keys(first.keys).length, 1)

  const old = signingKey(first, 'showcase')
  const header = issueAssertion({ audience: 'showcase', kid: old.kid, key: old.key, claims, now: NOW })

  const rotated = rotate(file)
  assert.notEqual(rotated.current, first.current)
  assert.deepEqual(Object.keys(rotated.keys).sort(), [first.current, rotated.current].sort())
  const overlap = parseKeys(keysFor(rotated, 'showcase'))
  assert.equal(verifyAssertion(header, { keys: overlap, audience: 'showcase', now: NOW }).ok, true, 'previous kid still verifies')
  const fresh = signingKey(rotated, 'showcase')
  assert.equal(fresh.kid, rotated.current)
  assert.equal(verifyAssertion(issueAssertion({ audience: 'showcase', ...fresh, claims, now: NOW }), { keys: overlap, audience: 'showcase', now: NOW }).ok, true)

  // A second rotation drops the oldest.
  const again = rotate(file)
  assert.equal(Object.keys(again.keys).length, 2)
  assert.ok(!again.keys[first.current])

  const pruned = prune(file)
  assert.deepEqual(Object.keys(pruned.keys), [again.current])
  const after = parseKeys(keysFor(readKeys(file), 'showcase'))
  assert.deepEqual(verifyAssertion(header, { keys: after, audience: 'showcase', now: NOW }), { ok: false, reason: 'unknown_kid' }, 'pruned kid fails')
})

test('each audience has its own key: a showcase key does not verify for slidesvault', () => {
  const store = loadKeys(path.join(tmp, 'keys-aud.json'))
  const { kid, key } = signingKey(store, 'showcase')
  const header = issueAssertion({ audience: 'slidesvault', kid, key, claims, now: NOW })
  assert.equal(verifyAssertion(header, { keys: parseKeys(keysFor(store, 'slidesvault')), audience: 'slidesvault', now: NOW }).reason, 'signature')
})

test('a malformed key file is refused, not repaired', () => {
  const file = path.join(tmp, 'keys-bad.json')
  fs.writeFileSync(file, JSON.stringify({ current: 'k1', keys: { k1: { core: 'short' } } }))
  assert.throws(() => loadKeys(file), /identity keys/)
})

test('run.mjs gives each API only its own audience keys, and none while off', () => {
  const file = path.join(tmp, 'keys-env.json')
  const store = loadKeys(file)
  const project = (id) => ({ id })

  const off = identityEnv(project('showcase'), {}, file)
  assert.equal(off.APEX_IDENTITY_MODE, 'off')
  assert.equal(off.APEX_IDENTITY_KEYS, '')
  assert.equal(off.APEX_IDENTITY_AUDIENCE, 'showcase')
  assert.equal(off.APEX_IDENTITY_ISSUER, 'apex-gateway')
  assert.equal(identityEnv(project('academia'), {}, file).APEX_IDENTITY_KEYS, '')

  const env = { APEX_IDENTITY_MODE_SLIDESVAULT: 'required', APEX_GOOGLE_CLIENT_ID: 'gid.apps.googleusercontent.com' }
  const vault = identityEnv(project('vault'), env, file)
  assert.equal(vault.APEX_IDENTITY_MODE, 'required')
  assert.equal(vault.APEX_IDENTITY_AUDIENCE, 'slidesvault')
  assert.deepEqual(JSON.parse(vault.APEX_IDENTITY_KEYS), keysFor(store, 'slidesvault'))
  assert.equal(vault.GOOGLE_CLIENT_ID, undefined)
  assert.equal(identityEnv(project('showcase'), env, file).APEX_IDENTITY_KEYS, '', 'the showcase is still off')

  const core = identityEnv(project('academia'), env, file)
  assert.equal(core.APEX_IDENTITY_AUDIENCE, 'core')
  assert.deepEqual(JSON.parse(core.APEX_IDENTITY_KEYS), keysFor(store, 'core'))
  assert.equal(core.GOOGLE_CLIENT_ID, 'gid.apps.googleusercontent.com')
  for (const value of Object.values(JSON.parse(core.APEX_IDENTITY_KEYS))) {
    assert.ok(!Object.values(JSON.parse(vault.APEX_IDENTITY_KEYS)).includes(value), 'no key is shared across audiences')
  }
})

test('APEX_IDENTITY_KEYS_STORE supplies the store instead of the file (containers), validated like it', async () => {
  const { loadKeyStore, validateStore } = await import('./identity-keys.mjs')
  const { createIdentityGateway } = await import('./gateway-identity.mjs')
  const source = loadKeys(path.join(tmp, 'keys-store-source.json'))
  const file = path.join(tmp, 'keys-store-unused.json')
  const env = { APEX_IDENTITY_MODE: 'required', APEX_IDENTITY_KEYS_STORE: JSON.stringify(source) }

  assert.deepEqual(loadKeyStore({ env, file }), validateStore(source))
  assert.equal(fs.existsSync(file), false, 'the file is neither read nor created')

  // The gateway signs with the store's keys; each app verifies with its own audience's keys only.
  const gw = createIdentityGateway({ env, file, now: () => NOW })
  const header = gw.assertionFor('showcase', 'core-user-1', { user: { id: 'core-user-1', email: 'a@x.io' }, roles: claims.roles })
  assert.equal(verifyAssertion(header, { keys: parseKeys(keysFor(source, 'showcase')), audience: 'showcase', now: NOW }).ok, true)
  assert.equal(fs.existsSync(file), false)

  // run.mjs hands out the same keys from the variable.
  assert.deepEqual(JSON.parse(identityEnv({ id: 'vault' }, env, file).APEX_IDENTITY_KEYS), keysFor(source, 'slidesvault'))

  // Unset or blank: the file, exactly as before.
  assert.deepEqual(loadKeyStore({ env: { APEX_IDENTITY_KEYS_STORE: '  ' }, file }), readKeys(file))

  // Malformed: refused, never repaired or ignored.
  assert.throws(() => loadKeyStore({ env: { APEX_IDENTITY_KEYS_STORE: '{not json' }, file }), /not valid JSON/)
  assert.throws(() => loadKeyStore({ env: { APEX_IDENTITY_KEYS_STORE: '{"current":"k1","keys":{"k1":{"core":"short"}}}' }, file }), /identity keys/)
})

test('APEX_UPSTREAM_HOST_<ID> overrides the shared upstream host for that project only', async () => {
  const { upstreamHost } = await import('./projects.mjs')
  assert.equal(upstreamHost('vault', {}), '127.0.0.1')
  assert.equal(upstreamHost('vault', { APEX_UPSTREAM_HOST: 'apps' }), 'apps')
  const env = { APEX_UPSTREAM_HOST: 'apps', APEX_UPSTREAM_HOST_VAULT: ' slidesvault-api ', APEX_UPSTREAM_HOST_ACADEMIA: '' }
  assert.equal(upstreamHost('vault', env), 'slidesvault-api')
  assert.equal(upstreamHost('showcase', env), 'apps')
  assert.equal(upstreamHost('academia', env), 'apps', 'blank falls back')
})

test('child processes never inherit the gateway-only key store or secret files (security review L2)', async () => {
  const { childEnv, GATEWAY_ONLY_ENV } = await import('./identity-keys.mjs')
  const parent = { PATH: '/bin', APEX_IDENTITY_KEYS_STORE: '{"current":"k"}', APEX_IDENTITY_KEYS_FILE: '/x', APEX_SESSION_SECRET_FILE: '/y' }
  const env = childEnv(parent, { APEX_IDENTITY_KEYS: '{"k":"own"}', PORT: '4175' })
  for (const name of GATEWAY_ONLY_ENV) assert.equal(name in env, false, name)
  assert.equal(env.PATH, '/bin')
  assert.equal(env.APEX_IDENTITY_KEYS, '{"k":"own"}')
  assert.equal(parent.APEX_IDENTITY_KEYS_STORE, '{"current":"k"}', 'the parent environment is not mutated')
})
