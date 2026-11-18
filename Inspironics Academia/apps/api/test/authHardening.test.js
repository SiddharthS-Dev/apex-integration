import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, mock, test } from 'node:test';

// Sign-in hardening (audit F-014) and first-user-admin in development (F-011), over HTTP:
//  - an unknown email still costs a password-hash compare (no account-existence timing oracle);
//  - LOGIN_MAX_FAILURES consecutive failures lock that email (429) even with the right password;
//  - a successful sign-in clears the failure count.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-authhard-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  NODE_ENV: 'test', LOGIN_MAX_FAILURES: '3',
});
delete process.env.ALLOW_FIRST_USER_ADMIN;
delete process.env.BOOTSTRAP_ADMIN_EMAIL;
const silence = console.log;
console.log = () => {};

// Count scrypt calls; passwords.js binds crypto.scrypt when it is first imported, so mock it first.
const scrypt = mock.method(crypto, 'scrypt');

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
async function call(url, body) {
  const res = await fetch(`${base}/api${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, retryAfter: res.headers.get('retry-after') };
}

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
  mock.restoreAll();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('outside production the first registered account still becomes admin', async () => {
  const first = await call('/auth/register', { email: 'first@example.com', password: 'First-pass-123' });
  assert.equal(first.status, 201);
  assert.equal(first.data.user.role, 'admin');
  const second = await call('/auth/register', { email: 'second@example.com', password: 'Second-pass-123' });
  assert.equal(second.data.user.role, 'user');
});

test('an unknown email still runs a password-hash compare', async () => {
  const before = scrypt.mock.callCount();
  const r = await call('/auth/login', { email: 'nobody@example.com', password: 'Whatever-123' });
  assert.equal(r.status, 401);
  assert.ok(scrypt.mock.callCount() > before, 'scrypt must run for an unknown email');
  // The same work as a wrong password for a real account: one scrypt call each.
  const mid = scrypt.mock.callCount();
  assert.equal((await call('/auth/login', { email: 'second@example.com', password: 'Wrong-pass-123' })).status, 401);
  assert.equal(scrypt.mock.callCount() - mid, mid - before);
});

test('repeated failures lock the account, even against the right password', async () => {
  await call('/auth/register', { email: 'victim@example.com', password: 'Victim-pass-123' });
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await call('/auth/login', { email: 'victim@example.com', password: `Wrong-${i}-pass` })).status, 401);
  }
  const locked = await call('/auth/login', { email: 'victim@example.com', password: 'Victim-pass-123' });
  assert.equal(locked.status, 429);
  assert.match(locked.data.error || JSON.stringify(locked.data), /failed sign-in attempts/i);
  assert.ok(Number(locked.retryAfter) > 0);
  // Other accounts are unaffected.
  assert.equal((await call('/auth/login', { email: 'first@example.com', password: 'First-pass-123' })).status, 200);
});

test('a successful sign-in resets the failure count', async () => {
  await call('/auth/register', { email: 'careful@example.com', password: 'Careful-pass-123' });
  for (let i = 0; i < 2; i += 1) await call('/auth/login', { email: 'careful@example.com', password: 'nope-nope-1' });
  assert.equal((await call('/auth/login', { email: 'careful@example.com', password: 'Careful-pass-123' })).status, 200);
  for (let i = 0; i < 2; i += 1) assert.equal((await call('/auth/login', { email: 'careful@example.com', password: 'nope-nope-1' })).status, 401);
  assert.equal((await call('/auth/login', { email: 'careful@example.com', password: 'Careful-pass-123' })).status, 200);
});
