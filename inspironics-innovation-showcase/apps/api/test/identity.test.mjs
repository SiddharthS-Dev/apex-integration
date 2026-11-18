/**
 * Apex identity assertion (R1 identity contract §4.4): X-Apex-Identity from the
 * gateway, in off, optional and required mode, the local account it maps to,
 * and migration 002_core_user_id up and down.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSqliteDb } from '../src/db/sqlite.js'
import { migrate, rollbackMigration } from '../src/db/migrate.js'
import { MIGRATIONS } from '../src/db/migrations.js'
import { issueAssertion, signAssertion } from '../src/lib/apexIdentity.js'
import { createHarness } from './fakes.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const KEY = crypto.randomBytes(32)
const KID = 'ktest1'
const KEYS = JSON.stringify({ [KID]: KEY.toString('base64') })
const STAFF = [{ role: 'staff', scope_type: 'organization', scope_id: 'org-1' }]

const assertion = (claims = {}, { audience = 'showcase', kid = KID, key = KEY, now = Date.now() } = {}) =>
  issueAssertion({ audience, kid, key, now, claims: { sub: 'core-1', app_user_id: null, email: 'core1@x.io', name: 'Core One', roles: STAFF, ...claims } })

const raw = (payload, key = KEY) => signAssertion(payload, { kid: KID, key })
const nowS = () => Math.floor(Date.now() / 1000)
const base = (over = {}) => ({ iss: 'apex-gateway', aud: 'showcase', sub: 'core-1', roles: STAFF, iat: nowS(), exp: nowS() + 60, ...over })

async function withMode(mode, fn, env = {}) {
  const h = await createHarness({ env: { APEX_IDENTITY_MODE: mode, APEX_IDENTITY_KEYS: KEYS, ...env } })
  try {
    await fn(h)
  } finally {
    await h.close()
  }
}

const me = async (h, header, extra = {}) => {
  const res = await h.client().get('/api/auth/me', { ...(header !== undefined ? { 'X-Apex-Identity': header } : {}), ...extra })
  return { status: res.status, body: await res.json() }
}

test('the verifier is a byte-for-byte copy of apex/identity.mjs', (t) => {
  const original = path.resolve(HERE, '../../../../apex/identity.mjs')
  if (!existsSync(original)) return t.skip('apex/identity.mjs is not in this checkout')
  assert.ok(readFileSync(path.join(HERE, '../src/lib/apexIdentity.js')).equals(readFileSync(original)), 'copy apex/identity.mjs over src/lib/apexIdentity.js')
})

test('mode off: the header is ignored entirely', async () => {
  const h = await createHarness({ env: { APEX_IDENTITY_KEYS: KEYS } })
  try {
    assert.equal(h.config.identity.mode, 'off')
    assert.equal((await me(h, assertion({ roles: [{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }] }))).status, 401)
    assert.equal((await me(h, 'garbage')).status, 401, 'not 401-for-invalid: simply anonymous')
    await h.signIn('first-admin@x.io', 'admin') // a dev install promotes the first sign-in otherwise
    const viewer = await h.signIn('v@x.io')
    const res = await viewer.get('/api/admin/config', { 'X-Apex-Identity': assertion({ roles: [{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }] }) })
    assert.equal(res.status, 403, 'a header cannot raise a legacy session')
    assert.equal((await viewer.post('/api/auth/login', { email: 'v@x.io', password: 'Passw0rd1' })).status, 200)
  } finally {
    await h.close()
  }
})

test('optional: a valid assertion is that identity, with a new passwordless local account', async () => {
  await withMode('optional', async (h) => {
    const r = await me(h, assertion())
    assert.equal(r.status, 200)
    assert.equal(r.body.user.email, 'core1@x.io')
    assert.equal(r.body.user.role, 'viewer')
    assert.equal(r.body.user.hasPassword, false)
    const row = await h.services.repos.users.findByCoreUserId('core-1')
    assert.equal(row.id, r.body.user.id)
    // The next request finds the same account.
    assert.equal((await me(h, assertion())).body.user.id, row.id)
    const session = await (await h.client().get('/api/auth/session', { 'X-Apex-Identity': assertion() })).json()
    assert.ok(session.session.expiresAt > Date.now())
  })
})

test('optional: every malformed, tampered, stale or misdirected assertion is 401', async () => {
  await withMode('optional', async (h) => {
    const good = assertion()
    const [kid, body, sig] = good.split('.')
    const cases = {
      tampered: `${kid}.${Buffer.from(JSON.stringify(base({ sub: 'someone-else' }))).toString('base64url')}.${sig}`,
      'bad signature': raw(base(), crypto.randomBytes(32)),
      expired: raw(base({ iat: nowS() - 120, exp: nowS() - 60 })),
      'future iat': raw(base({ iat: nowS() + 60, exp: nowS() + 120 })),
      'exp - iat too long': raw(base({ exp: nowS() + 600 })),
      'wrong aud': assertion({}, { audience: 'slidesvault' }),
      'wrong iss': raw(base({ iss: 'not-the-gateway' })),
      'unknown kid': signAssertion(base(), { kid: 'kother', key: KEY }),
      format: `${kid}.${body}`,
    }
    for (const [name, header] of Object.entries(cases)) {
      const r = await me(h, header)
      assert.equal(r.status, 401, name)
      assert.equal(r.body.error.code, 'APEX_IDENTITY_INVALID', name)
    }
  })
})

test('optional: an assertion from an untrusted source address is 401', async () => {
  await withMode('optional', async (h) => {
    assert.equal((await me(h, assertion())).status, 401)
  }, { APEX_IDENTITY_TRUSTED_SOURCES: '10.0.0.0/8' })
})

test('optional: no header falls back to the legacy session', async () => {
  await withMode('optional', async (h) => {
    const viewer = await h.signIn('legacy@x.io')
    const res = await viewer.get('/api/auth/me')
    assert.equal(res.status, 200)
    assert.equal((await res.json()).user.email, 'legacy@x.io')
  })
})

test('roles: no roles is 403; app_admin for this app is admin; for the other app it is not; nothing is stored', async () => {
  await withMode('optional', async (h) => {
    const none = await me(h, assertion({ roles: [] }))
    assert.equal(none.status, 403)
    assert.equal(none.body.error.code, 'APEX_NO_ROLE')
    assert.equal(await h.services.repos.users.findByCoreUserId('core-1'), undefined, 'no account is created for someone with no role')

    const admin = assertion({ roles: [{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }] })
    assert.equal((await h.client().get('/api/admin/config', { 'X-Apex-Identity': admin })).status, 200)
    const platform = assertion({ roles: [{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }] })
    assert.equal((await h.client().get('/api/admin/config', { 'X-Apex-Identity': platform })).status, 200)
    const other = assertion({ roles: [{ role: 'app_admin', scope_type: 'app', scope_id: 'slidesvault' }] })
    const res = await h.client().get('/api/admin/config', { 'X-Apex-Identity': other })
    assert.equal(res.status, 403, 'app_admin of SlidesVault is no admin here')

    const row = await h.services.repos.users.findByCoreUserId('core-1')
    assert.equal(row.role, 'viewer', 'the asserted admin role was never written')
  })
})

test('local account: never merged by email; a confirmed link (app_user_id) is used; a disabled one is refused', async () => {
  await withMode('optional', async (h) => {
    const { repos } = h.services
    const existing = await repos.users.create({ email: 'core1@x.io', name: 'Existing', role: 'admin', verified: true })

    const r = await me(h, assertion())
    assert.equal(r.status, 200)
    assert.notEqual(r.body.user.id, existing.id, 'the same email does not reuse the existing account')
    assert.notEqual(r.body.user.email, 'core1@x.io')
    assert.equal(r.body.user.role, 'viewer', 'and certainly not its admin role')

    const linked = await me(h, assertion({ sub: 'core-2', app_user_id: existing.id }))
    assert.equal(linked.body.user.id, existing.id)
    assert.equal(linked.body.user.role, 'viewer', 'the role is the asserted one, not the stored admin')

    assert.equal((await me(h, assertion({ sub: 'core-3', app_user_id: 'no-such-user' }))).status, 403)
    await repos.users.update(existing.id, { disabled: 1 })
    assert.equal((await me(h, assertion({ sub: 'core-2', app_user_id: existing.id }))).status, 403)
  })
})

test('required: no header is 401 except health and the public routes; legacy sign-in is 403', async () => {
  await withMode('required', async (h) => {
    const c = h.client()
    assert.equal((await me(h, undefined)).status, 401)
    assert.equal((await me(h, undefined)).body.error.code, 'APEX_IDENTITY_REQUIRED')
    assert.equal((await c.get('/api/entities/plates')).status, 401)
    assert.equal((await c.get('/api/health')).status, 200)
    assert.equal((await c.get('/api/auth/config')).status, 200)
    assert.equal((await c.get('/api/entities/plates/count')).status, 200)
    const session = await c.get('/api/auth/session')
    assert.deepEqual(await session.json(), { session: null })

    await h.services.repos.users.create({ email: 'pw@x.io', name: 'pw', role: 'viewer', verified: true })
    for (const [p, body] of [
      ['/api/auth/login', { email: 'pw@x.io', password: 'Passw0rd1' }],
      ['/api/auth/register', { email: 'new@x.io', password: 'Passw0rd1' }],
      ['/api/auth/google', { demo: true }],
      ['/api/auth/forgot', { email: 'pw@x.io' }],
    ]) {
      const res = await c.post(p, body)
      assert.equal(res.status, 403, p)
    }
    // A legacy cookie is worth nothing now.
    const r = await me(h, assertion())
    assert.equal(r.status, 200)
    assert.equal((await c.get('/api/entities/plates', { 'X-Apex-Identity': assertion() })).status, 200)
    assert.equal((await me(h, 'garbage')).status, 401)
  })
})

test('a mode that is not off|optional|required runs as required and is a config error', async () => {
  const h = await createHarness({ env: { APEX_IDENTITY_MODE: 'requried', APEX_IDENTITY_KEYS: KEYS } })
  try {
    assert.equal(h.config.identity.mode, 'required')
    assert.ok(h.config.problems.some((p) => p.level === 'error' && /APEX_IDENTITY_MODE/.test(p.message)))
    assert.equal((await me(h, undefined)).status, 401)
  } finally {
    await h.close()
  }
})

test('migration 002_core_user_id: up adds a nullable unique column, down removes it cleanly', async () => {
  const db = createSqliteDb(':memory:')
  try {
    await migrate(db)
    const cols = async () => (await db.all('PRAGMA table_info(users)')).map((c) => c.name)
    assert.ok((await cols()).includes('core_user_id'))
    const now = new Date().toISOString()
    await db.run("INSERT INTO users (id, email, name, role, created_at) VALUES ('a', 'a@x.io', 'A', 'viewer', ?)", [now])
    await db.run("INSERT INTO users (id, email, name, role, created_at) VALUES ('b', 'b@x.io', 'B', 'viewer', ?)", [now])
    await db.run("UPDATE users SET core_user_id = 'c1' WHERE id = 'a'")
    await assert.rejects(db.run("UPDATE users SET core_user_id = 'c1' WHERE id = 'b'"), 'unique where set')

    assert.equal(await rollbackMigration(db, '002_core_user_id'), true)
    assert.ok(!(await cols()).includes('core_user_id'))
    assert.equal((await db.all("SELECT id FROM schema_migrations WHERE id = '002_core_user_id'")).length, 0)
    assert.equal((await db.all('SELECT id FROM users')).length, 2, 'no account is lost')
    assert.equal(await rollbackMigration(db, '002_core_user_id'), false, 'nothing left to roll back')

    assert.deepEqual(await migrate(db), ['002_core_user_id'], 'and it applies again')
    assert.ok((await cols()).includes('core_user_id'))
    await assert.rejects(rollbackMigration(db, '001_init'), /no rollback/)
  } finally {
    await db.close()
  }
})

test('migration 002 SQL is portable: plain ADD COLUMN and a unique index, no SQLite-only syntax', () => {
  const m = MIGRATIONS.find((x) => x.id === '002_core_user_id')
  assert.equal(typeof m.sql, 'string')
  assert.match(m.sql, /ALTER TABLE users ADD COLUMN core_user_id TEXT;/)
  assert.match(m.sql, /CREATE UNIQUE INDEX users_core_user_id ON users\(core_user_id\);/)
  assert.match(m.down, /DROP INDEX IF EXISTS users_core_user_id;/)
  assert.match(m.down, /ALTER TABLE users DROP COLUMN core_user_id;/)
  assert.doesNotMatch(m.sql + m.down, /AUTOINCREMENT|PRAGMA|WITHOUT ROWID/i)
})
