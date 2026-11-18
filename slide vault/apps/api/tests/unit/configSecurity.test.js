/**
 * Start-up security rules in src/config/index.js: non-Secure session cookies
 * in production, and the self-registration default.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConfig, isLocalUrl, validateConfig } from '../../src/config/index.js';
import { TEST_KEY, createTestStack, startServer } from '../helpers/testEnv.js';

const prod = (over = {}) =>
  buildConfig({
    NODE_ENV: 'production',
    DB_DRIVER: 'sqlite',
    DB_FILE: ':memory:',
    DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY,
    ...over,
  });

const secureCookieError = (cfg) => validateConfig(cfg).errors.find((e) => e.includes('SESSION_COOKIE_SECURE'));

test('isLocalUrl recognises loopback hosts only', () => {
  for (const url of ['http://localhost:4173/vault', 'http://127.0.0.1:4173', 'http://[::1]:4000', 'http://app.localhost']) {
    assert.equal(isLocalUrl(url), true, url);
  }
  for (const url of ['http://apex.example.com', 'http://10.0.0.5:4000', 'http://0.0.0.0:4000', 'not a url']) {
    assert.equal(isLocalUrl(url), false, url);
  }
});

test('production with non-Secure cookies on a public address refuses to start', () => {
  const cfg = prod({
    SESSION_COOKIE_SECURE: 'false',
    APP_BASE_URL: 'http://apex.example.com/vault',
    API_BASE_URL: 'http://apex.example.com/vault',
  });
  assert.ok(secureCookieError(cfg), 'a fatal error, not a warning');
});

test('production with non-Secure cookies on loopback (the private staging stack) still starts, with a warning', () => {
  const cfg = prod({
    SESSION_COOKIE_SECURE: 'false',
    APP_BASE_URL: 'http://127.0.0.1:4173/vault',
    API_BASE_URL: 'http://127.0.0.1:4173/vault',
  });
  assert.equal(secureCookieError(cfg), undefined);
  assert.ok(validateConfig(cfg).warnings.some((w) => w.includes('SESSION_COOKIE_SECURE')));
});

test('production with Secure cookies on https is fine', () => {
  const cfg = prod({ APP_BASE_URL: 'https://apex.example.com/vault', API_BASE_URL: 'https://apex.example.com/vault' });
  assert.equal(cfg.session.secure, true, 'Secure is the production default');
  assert.equal(secureCookieError(cfg), undefined);
});

test('registration defaults to closed in production and open elsewhere; ALLOW_REGISTRATION wins', () => {
  assert.equal(prod().allowRegistration, false);
  assert.equal(prod({ ALLOW_REGISTRATION: 'true' }).allowRegistration, true);
  assert.equal(buildConfig({ NODE_ENV: 'development' }).allowRegistration, true);
  assert.equal(buildConfig({ NODE_ENV: 'development', ALLOW_REGISTRATION: 'false' }).allowRegistration, false);
});

test('POST /api/auth/register answers 403 when registration is closed, and /config says so', async (t) => {
  const stack = await createTestStack({ configOverrides: { ALLOW_REGISTRATION: 'false' } });
  const client = await startServer(stack.app);
  t.after(async () => {
    await client.close();
    await stack.close();
  });

  const res = await client.post('/api/auth/register', { email: 'new@example.com', password: 'long-enough-password' });
  assert.equal(res.status, 403);
  assert.equal(res.body.code, 'REGISTRATION_CLOSED');
  assert.equal(await stack.container.users.findByEmail('new@example.com'), null, 'no account was created');
  assert.equal((await client.get('/api/auth/config')).body.registration, false);
});

test('POST /api/auth/register still works when registration is open', async (t) => {
  const stack = await createTestStack({ configOverrides: { ALLOW_REGISTRATION: 'true' } });
  const client = await startServer(stack.app);
  t.after(async () => {
    await client.close();
    await stack.close();
  });
  const res = await client.post('/api/auth/register', { email: 'new@example.com', password: 'long-enough-password' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.role, 'user');
});
