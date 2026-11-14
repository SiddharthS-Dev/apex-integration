/**
 * Apex identity assertion (R1 identity contract §4.4): X-Apex-Identity from the
 * gateway in off, optional and required mode, the local account it maps to,
 * and migration 005_core_user_id up and down.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildConfig, validateConfig } from '../../src/config/index.js';
import { createSqliteDriver } from '../../src/db/sqliteDriver.js';
import { MIGRATIONS, rollbackMigration, runMigrations } from '../../src/db/migrations.js';
import { issueAssertion, signAssertion } from '../../src/http/apexIdentity.js';
import { nullLogger } from '../../src/util/logger.js';
import { ADMIN, TEST_KEY, createTestStack, startServer } from '../helpers/testEnv.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const KEY = crypto.randomBytes(32);
const KID = 'ktest1';
const KEYS = JSON.stringify({ [KID]: KEY.toString('base64') });
const STAFF = [{ role: 'staff', scope_type: 'organization', scope_id: 'org-1' }];
const nowS = () => Math.floor(Date.now() / 1000);

const assertion = (claims = {}, { audience = 'slidesvault' } = {}) =>
  issueAssertion({
    audience,
    kid: KID,
    key: KEY,
    claims: { sub: 'core-1', app_user_id: null, email: 'core1@x.io', name: 'Core One', roles: STAFF, ...claims },
  });
const raw = (payload, key = KEY, kid = KID) => signAssertion(payload, { kid, key });
const base = (over = {}) => ({
  iss: 'apex-gateway',
  aud: 'slidesvault',
  sub: 'core-1',
  roles: STAFF,
  iat: nowS(),
  exp: nowS() + 60,
  ...over,
});

async function withMode(mode, fn, overrides = {}) {
  const stack = await createTestStack({
    configOverrides: { APEX_IDENTITY_MODE: mode, APEX_IDENTITY_KEYS: KEYS, ...overrides },
  });
  const client = await startServer(stack.app);
  try {
    await fn({ stack, client });
  } finally {
    await client.close();
    await stack.close();
  }
}

const me = (client, header) =>
  client.get('/api/auth/me', header === undefined ? {} : { headers: { 'X-Apex-Identity': header } });

test('the verifier is a byte-for-byte copy of apex/identity.mjs', (t) => {
  const original = path.resolve(HERE, '../../../../../apex/identity.mjs');
  if (!fs.existsSync(original)) return t.skip('apex/identity.mjs is not in this checkout');
  assert.ok(
    fs.readFileSync(path.join(HERE, '../../src/http/apexIdentity.js')).equals(fs.readFileSync(original)),
    'copy apex/identity.mjs over src/http/apexIdentity.js'
  );
});

test('mode off: the header is ignored entirely', async () => {
  await withMode('off', async ({ client }) => {
    const admin = assertion({ roles: [{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }] });
    assert.equal((await me(client, admin)).status, 401);
    assert.equal((await me(client, 'garbage')).status, 401);
    assert.equal((await client.login()).status, 200);
    const res = await me(client, 'garbage');
    assert.equal(res.status, 200, 'an invalid header does not disturb a legacy session');
    assert.equal(res.body.email, ADMIN.email);
  });
});

test('optional: a valid assertion is that identity, with a new passwordless local account', async () => {
  await withMode('optional', async ({ stack, client }) => {
    const res = await me(client, assertion());
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'core1@x.io');
    assert.equal(res.body.role, 'user');
    const row = await stack.container.users.findByCoreUserId('core-1');
    assert.equal(row.id, res.body.id);
    assert.equal(row.password_hash, '', 'no password');
    assert.equal((await me(client, assertion())).body.id, row.id, 'found again, not created twice');
  });
});

test('optional: every malformed, tampered, stale or misdirected assertion is 401', async () => {
  await withMode('optional', async ({ client }) => {
    const [kid, body, sig] = assertion().split('.');
    const cases = {
      tampered: `${kid}.${Buffer.from(JSON.stringify(base({ sub: 'someone-else' }))).toString('base64url')}.${sig}`,
      'bad signature': raw(base(), crypto.randomBytes(32)),
      expired: raw(base({ iat: nowS() - 120, exp: nowS() - 60 })),
      'future iat': raw(base({ iat: nowS() + 60, exp: nowS() + 120 })),
      'exp - iat too long': raw(base({ exp: nowS() + 600 })),
      'wrong aud': assertion({}, { audience: 'showcase' }),
      'wrong iss': raw(base({ iss: 'not-the-gateway' })),
      'unknown kid': raw(base(), KEY, 'kother'),
      format: `${kid}.${body}`,
    };
    for (const [name, header] of Object.entries(cases)) {
      const res = await me(client, header);
      assert.equal(res.status, 401, name);
      assert.equal(res.body.code, 'APEX_IDENTITY_INVALID', name);
    }
  });
});

test('optional: an assertion from an untrusted source address is 401', async () => {
  await withMode(
    'optional',
    async ({ client }) => {
      assert.equal((await me(client, assertion())).status, 401);
    },
    { APEX_IDENTITY_TRUSTED_SOURCES: '10.0.0.0/8' }
  );
});

test('optional: no header falls back to the legacy session', async () => {
  await withMode('optional', async ({ client }) => {
    assert.equal((await client.login()).status, 200);
    const res = await me(client);
    assert.equal(res.status, 200);
    assert.equal(res.body.email, ADMIN.email);
  });
});

test('roles: none is 403; app_admin here is admin; app_admin of the Showcase is not; nothing is stored', async () => {
  await withMode('optional', async ({ stack, client }) => {
    const none = await me(client, assertion({ roles: [] }));
    assert.equal(none.status, 403);
    assert.equal(none.body.code, 'APEX_NO_ROLE');
    assert.ok(!(await stack.container.users.findByCoreUserId('core-1')), 'no account for someone with no role');

    const as = (roles) => client.get('/api/auth/users', { headers: { 'X-Apex-Identity': assertion({ roles }) } });
    assert.equal((await as([{ role: 'app_admin', scope_type: 'app', scope_id: 'slidesvault' }])).status, 200);
    assert.equal((await as([{ role: 'platform_admin', scope_type: 'platform', scope_id: '' }])).status, 200);
    assert.equal((await as([{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }])).status, 403);
    assert.equal((await as(STAFF)).status, 403);

    const row = await stack.container.users.findByCoreUserId('core-1');
    assert.equal(row.role, 'user', 'the asserted admin role was never written');
  });
});

test('local account: never merged by email; a confirmed link (app_user_id) is used; a disabled one is refused', async () => {
  await withMode('optional', async ({ stack, client }) => {
    const { users, db } = stack.container;
    const existing = await users.create({ email: 'core1@x.io', password: 'some-long-password', role: 'admin' });

    const res = await me(client, assertion());
    assert.equal(res.status, 200);
    assert.notEqual(res.body.id, existing.id, 'the same email does not reuse the existing account');
    assert.notEqual(res.body.email, 'core1@x.io');
    assert.equal(res.body.role, 'user');

    const linked = await me(client, assertion({ sub: 'core-2', app_user_id: existing.id }));
    assert.equal(linked.body.id, existing.id);
    assert.equal(linked.body.role, 'user', 'the asserted role, not the stored admin');

    assert.equal((await me(client, assertion({ sub: 'core-3', app_user_id: 'no-such-user' }))).status, 403);
    await db.execute("UPDATE app_user SET status = 'disabled' WHERE id = ?", [existing.id]);
    assert.equal((await me(client, assertion({ sub: 'core-2', app_user_id: existing.id }))).status, 403);
  });
});

test('required: no header is 401 except health and the public routes; legacy sign-in is 403', async () => {
  await withMode('required', async ({ client }) => {
    const none = await client.get('/api/files');
    assert.equal(none.status, 401);
    assert.equal(none.body.code, 'APEX_IDENTITY_REQUIRED');
    assert.equal((await client.get('/api/users')).status, 401);
    assert.equal((await client.get('/api/health')).status, 200);
    assert.equal((await client.get('/api/auth/config')).status, 200);

    assert.equal((await client.login()).status, 403, 'password sign-in');
    assert.equal((await client.post('/api/auth/register', { email: 'n@x.io', password: 'long-enough-pw' })).status, 403);
    assert.equal((await client.get('/api/auth/google/start')).status, 403);

    const res = await me(client, assertion());
    assert.equal(res.status, 200);
    assert.equal(res.body.email, 'core1@x.io');
    assert.equal((await me(client, 'garbage')).status, 401);
  });
});

test('required: a pre-existing legacy session is never honoured, on any path spelling (review M1)', async () => {
  await withMode('required', async ({ stack, client }) => {
    const admin = await stack.container.users.findByEmail(ADMIN.email);
    const { token } = await stack.container.sessions.create({ userId: admin.id });
    const h = { headers: { Cookie: `${stack.container.config.session.cookieName}=${token}` } };
    for (const path of ['/api/auth/me', '/API/auth/me', '/Api/Auth/Me']) {
      const res = await client.get(path, h);
      assert.notEqual(res.status, 200, `${path} must not authenticate from the cookie`);
    }
    for (const path of ['/API/login-history', '/API/presentations', '/API/users', '/aPi/files']) {
      assert.equal((await client.get(path, h)).status, 401, path);
    }
    assert.equal((await client.get('/API/health')).status, 200, 'public routes stay public in any case');
  });
});

test('config: an unknown mode is a fatal error and runs as required; mode on without keys is fatal', () => {
  const cfg = buildConfig({ DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY, APEX_IDENTITY_MODE: 'requried', APEX_IDENTITY_KEYS: KEYS });
  assert.equal(cfg.identity.mode, 'required');
  assert.ok(validateConfig(cfg).errors.some((e) => /APEX_IDENTITY_MODE/.test(e)));
  const noKeys = buildConfig({ DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY, APEX_IDENTITY_MODE: 'optional' });
  assert.ok(validateConfig(noKeys).errors.some((e) => /APEX_IDENTITY_KEYS/.test(e)));
  const off = buildConfig({ DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY });
  assert.equal(off.identity.mode, 'off');
  assert.ok(!validateConfig(off).errors.some((e) => /APEX_IDENTITY/.test(e)));
});

test('migration 005_core_user_id: up adds a nullable unique column, down removes it cleanly', async (t) => {
  const db = createSqliteDriver(
    buildConfig({ DB_DRIVER: 'sqlite', DB_FILE: ':memory:', DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY }),
    nullLogger
  );
  t.after(() => db.close());
  await runMigrations(db, nullLogger);
  const cols = async () => (await db.query('PRAGMA table_info(app_user)')).map((c) => c.name);
  assert.ok((await cols()).includes('core_user_id'));

  await db.execute(
    "INSERT INTO app_user (id, email, created_at, updated_at) VALUES ('a', 'a@x.io', 't', 't'), ('b', 'b@x.io', 't', 't')"
  );
  await db.execute("UPDATE app_user SET core_user_id = 'c1' WHERE id = 'a'");
  await assert.rejects(db.execute("UPDATE app_user SET core_user_id = 'c1' WHERE id = 'b'"), 'unique where set');

  assert.equal(await rollbackMigration(db, '005_core_user_id', nullLogger), true);
  assert.ok(!(await cols()).includes('core_user_id'));
  assert.equal((await db.query("SELECT id FROM schema_migrations WHERE id = '005_core_user_id'")).length, 0);
  assert.equal((await db.query('SELECT id FROM app_user')).length, 2, 'no account is lost');
  assert.equal(await rollbackMigration(db, '005_core_user_id', nullLogger), false);
  await assert.rejects(rollbackMigration(db, '004_classification_source'), /no rollback/);

  await runMigrations(db, nullLogger);
  assert.ok((await cols()).includes('core_user_id'), 'and it applies again');
});

test('migration 005 SQL is portable: plain ADD COLUMN and a unique index, nothing SQLite-only', () => {
  const m = MIGRATIONS.find((x) => x.id === '005_core_user_id');
  assert.deepEqual(m.statements, [
    'ALTER TABLE app_user ADD COLUMN core_user_id TEXT',
    'CREATE UNIQUE INDEX IF NOT EXISTS uq_app_user_core_user_id ON app_user (core_user_id)',
  ]);
  assert.deepEqual(m.down, ['DROP INDEX IF EXISTS uq_app_user_core_user_id', 'ALTER TABLE app_user DROP COLUMN core_user_id']);
});
