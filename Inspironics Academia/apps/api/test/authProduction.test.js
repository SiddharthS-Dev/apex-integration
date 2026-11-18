import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { after, before, test } from 'node:test';

// Audit F-011: in production the first self-registered account must not become admin (unless
// ALLOW_FIRST_USER_ADMIN=true); BOOTSTRAP_ADMIN_EMAIL remains the supported way to get an admin.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-authprod-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  NODE_ENV: 'production', COOKIE_SECURE: 'false', BOOTSTRAP_ADMIN_EMAIL: 'boss@example.com',
});
delete process.env.ALLOW_FIRST_USER_ADMIN;
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');
const { config } = await import('../src/config.js');

let server;
let base;
const register = async (body) => {
  const res = await fetch(`${base}/api/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, data: await res.json() };
};

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  console.log = silence;
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('production defaults ALLOW_FIRST_USER_ADMIN to off', () => {
  assert.equal(config.isProduction, true);
  assert.equal(config.allowFirstUserAdmin, false);
});

test('the first self-registered account in production is an ordinary user', async () => {
  const r = await register({ email: 'early@example.com', password: 'Early-pass-123' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
});

test('registering with the bootstrap admin email does not grant admin (security review L3)', async () => {
  const r = await register({ email: 'boss@example.com', password: 'Boss-pass-1234' });
  assert.equal(r.status, 201);
  assert.equal(r.data.user.role, 'user');
});

test('ALLOW_FIRST_USER_ADMIN=true restores first-user-admin in production', () => {
  const configUrl = pathToFileURL(path.resolve(import.meta.dirname, '../src/config.js')).href;
  const read = (extra) => execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { config } = await import(${JSON.stringify(configUrl)}); process.stdout.write(String(config.allowFirstUserAdmin));`],
  { env: { ...process.env, ...extra }, encoding: 'utf8' });
  assert.equal(read({ NODE_ENV: 'production', ALLOW_FIRST_USER_ADMIN: 'true' }), 'true');
  assert.equal(read({ NODE_ENV: 'development', ALLOW_FIRST_USER_ADMIN: '' }), 'true');
});
