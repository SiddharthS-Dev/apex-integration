import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';

// Fixes from the 2026-11-17 security audit (docs/security/APEX_Security_Audit.md):
//  1. a password-reset link is redeemed at most once, even by concurrent requests;
//  2. reset/invitation links are withheld from the production log and blanked from the outbox once sent;
//  3. cookie-bearing writes need our Origin or Referer, and a public Host header is never an origin;
//  4. unsafe production configuration is refused at start-up;
//  5. self-registration is closed by default in production;
//  6. scrypt N=2^17, older hashes still verify and are upgraded at sign-in;
//  7. deleting a user removes their sign-in history and email; LOGIN_HISTORY_RETENTION_DAYS purges.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-secaudit-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  NODE_ENV: 'test', ALLOW_REGISTRATION: 'true', JOBS_ENABLED: 'false',
});
delete process.env.ALLOW_FIRST_USER_ADMIN;
delete process.env.BOOTSTRAP_ADMIN_EMAIL;
delete process.env.EMAIL_LOG_SECRETS;
const silence = { log: console.log, error: console.error };
let captured = [];
console.log = (...a) => { captured.push(a.join(' ')); };
console.error = (...a) => { captured.push(a.join(' ')); };

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');
const { createUser, deleteUser, findUserByEmail, purgeLoginHistory, recordLogin } = await import('../src/repo/users.js');
const { hashPassword, needsRehash, verifyPassword } = await import('../src/auth/passwords.js');
const { sendMail } = await import('../src/notify/mailer.js');
const { enqueueEmail } = await import('../src/notify/outbox.js');
const { sweepOnboarding } = await import('../src/core/onboarding/service.js');
const { startupProblems, isLoopbackOrigin } = await import('../src/startupChecks.js');

let server;
let base;

async function call(method, url, { body, cookie, headers = {} } = {}) {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, cookie: set ? set.split(';')[0] : null };
}

async function signedIn(email, password) {
  const r = await call('POST', '/auth/login', { body: { email, password } });
  assert.equal(r.status, 200, `sign-in ${email}`);
  return r.cookie;
}

const latestBody = async (email, kind) => (await db().query(
  'SELECT * FROM email_outbox WHERE to_email = ? AND kind = ? ORDER BY created_at DESC LIMIT 1', [email, kind],
))[0];

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  // The first account becomes admin outside production.
  assert.equal((await call('POST', '/auth/register', { body: { email: 'admin@example.com', password: 'Admin-pass-1234' } })).status, 201);
});

after(async () => {
  [console.log, console.error] = [silence.log, silence.error];
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('1. a reset link is redeemed once, even by concurrent requests', async () => {
  const email = 'reset@example.com';
  assert.equal((await call('POST', '/auth/register', { body: { email, password: 'Reset-pass-1234' } })).status, 201);
  assert.equal((await call('POST', '/auth/reset-password-request', { body: { email }, headers: { 'X-Forwarded-For': '10.1.0.1' } })).status, 200);
  const token = (await latestBody(email, 'password_reset')).text_body.match(/token=([A-Za-z0-9_-]+)/)[1];

  // A weak password does not burn the link.
  assert.equal((await call('POST', '/auth/reset-password', { body: { resetToken: token, newPassword: 'short' }, headers: { 'X-Forwarded-For': '10.1.0.2' } })).status, 400);

  const results = await Promise.all(['A', 'B', 'C'].map((s, i) => call('POST', '/auth/reset-password', {
    body: { resetToken: token, newPassword: `Winner-${s}-pass-1234` }, headers: { 'X-Forwarded-For': `10.1.1.${i}` },
  })));
  assert.equal(results.filter((r) => r.status === 200).length, 1, 'exactly one redemption wins');
  assert.ok(results.filter((r) => r.status !== 200).every((r) => r.status === 400));
  const again = await call('POST', '/auth/reset-password', { body: { resetToken: token, newPassword: 'Another-pass-1234' }, headers: { 'X-Forwarded-For': '10.1.2.1' } });
  assert.equal(again.status, 400, 'a used link stays used');
});

test('2a. the log transport withholds reset/invite links in production unless EMAIL_LOG_SECRETS=true', async () => {
  const before = { NODE_ENV: process.env.NODE_ENV, EMAIL_LOG_SECRETS: process.env.EMAIL_LOG_SECRETS };
  const link = 'https://apex.example/reset-password?token=secret-token-value-123';
  const cases = [
    [{ NODE_ENV: 'production', EMAIL_LOG_SECRETS: '' }, 'password_reset', false],
    [{ NODE_ENV: 'production', EMAIL_LOG_SECRETS: '' }, 'invite', false],
    [{ NODE_ENV: 'production', EMAIL_LOG_SECRETS: 'true' }, 'password_reset', true],
    [{ NODE_ENV: 'development', EMAIL_LOG_SECRETS: '' }, 'password_reset', true],
    [{ NODE_ENV: 'production', EMAIL_LOG_SECRETS: '' }, 'test', true],
  ];
  try {
    for (const [env, kind, shown] of cases) {
      Object.assign(process.env, env);
      captured = [];
      await sendMail({ to: 'x@example.com', subject: 's', text: `Open ${link}`, kind });
      assert.equal(captured.join('\n').includes('secret-token-value-123'), shown, JSON.stringify({ env, kind }));
    }
  } finally {
    process.env.NODE_ENV = before.NODE_ENV;
    if (before.EMAIL_LOG_SECRETS === undefined) delete process.env.EMAIL_LOG_SECRETS;
    else process.env.EMAIL_LOG_SECRETS = before.EMAIL_LOG_SECRETS;
  }
});

test('2b. the sweep blanks delivered or failed reset/invite bodies, and leaves queued and other mail alone', async () => {
  const put = async (kind, status, to) => {
    await enqueueEmail({ to, kind, subject: 's', text: `token=${kind}-${status}-secret` });
    await db().run('UPDATE email_outbox SET status = ? WHERE to_email = ?', [status, to]);
  };
  await put('password_reset', 'sent', 'sweep1@example.com');
  await put('invite', 'failed', 'sweep2@example.com');
  await put('invite', 'queued', 'sweep3@example.com');
  await put('test', 'sent', 'sweep4@example.com');
  await sweepOnboarding(db());
  assert.equal((await latestBody('sweep1@example.com', 'password_reset')).text_body, '[removed: one-time secret]');
  assert.equal((await latestBody('sweep2@example.com', 'invite')).text_body, '[removed: one-time secret]');
  assert.match((await latestBody('sweep3@example.com', 'invite')).text_body, /secret/, 'still to be sent');
  assert.match((await latestBody('sweep4@example.com', 'test')).text_body, /secret/, 'not a secret-bearing kind');
});

test('3. cookie-bearing writes need our Origin or Referer; public Host headers are never an origin', async () => {
  const cookie = await signedIn('admin@example.com', 'Admin-pass-1234');
  const patch = (headers) => call('PATCH', '/auth/me', { cookie, body: { full_name: 'Ada' }, headers });

  assert.equal((await patch({})).status, 403, 'a cookie write with neither Origin nor Referer');
  assert.equal((await patch({ Origin: 'https://evil.example' })).status, 403, 'a foreign Origin');
  assert.equal((await patch({ Origin: 'null' })).status, 403, 'an opaque Origin');
  assert.equal((await patch({ Referer: 'https://evil.example/page' })).status, 403, 'a foreign Referer');
  assert.equal((await patch({ Host: 'evil.example', Origin: 'http://evil.example' })).status, 403, 'a public Host is not believed');
  assert.equal((await patch({ Origin: base })).status, 200, 'our loopback origin (dev proxy)');
  assert.equal((await patch({ Referer: `${base}/academia/profile` })).status, 200, 'our Referer when Origin is absent');
  assert.equal((await patch({ Origin: 'http://localhost:5173' })).status, 200, 'APP_ORIGIN');

  // Cookie-less writes have no session to ride on: sign-in works without Origin (as above), and a
  // header-less sign-out is allowed (the gateway signs each app out server-side with only its cookie).
  assert.equal((await call('POST', '/auth/logout', { cookie })).status, 200);
});

test('4. unsafe production configuration is refused at start-up', () => {
  const ok = { appOrigin: 'https://apex.example', cookieSecure: true, tokenEncryptionKey: '', bootstrapAdminPassword: '', email: { provider: 'resend' } };
  assert.deepEqual(startupProblems({ NODE_ENV: 'production' }, ok).errors, []);
  assert.equal(startupProblems({ NODE_ENV: 'production' }, { ...ok, cookieSecure: false }).errors.length, 1, 'non-Secure cookies on a public origin');
  assert.deepEqual(startupProblems({ NODE_ENV: 'production' }, { ...ok, cookieSecure: false, appOrigin: 'http://localhost:4173' }).errors, [], 'staging and start.bat prod: loopback over http');
  assert.deepEqual(startupProblems({ NODE_ENV: 'development' }, { ...ok, cookieSecure: false }).errors, []);

  assert.equal(startupProblems({ NODE_ENV: 'production' }, { ...ok, tokenEncryptionKey: 'too-short' }).errors.length, 1);
  assert.deepEqual(startupProblems({ NODE_ENV: 'production' }, { ...ok, tokenEncryptionKey: crypto.randomBytes(32).toString('base64') }).errors, []);
  assert.equal(startupProblems({ NODE_ENV: 'development' }, { ...ok, tokenEncryptionKey: 'too-short' }).warnings.length, 1, 'a warning outside production');

  assert.equal(startupProblems({ NODE_ENV: 'production' }, { ...ok, bootstrapAdminPassword: 'Short-pass1' }).errors.length, 1);
  assert.deepEqual(startupProblems({ NODE_ENV: 'production' }, { ...ok, bootstrapAdminPassword: crypto.randomBytes(24).toString('base64url') }).errors, [], 'staging generates 32 characters');
  const localShort = startupProblems({ NODE_ENV: 'production' }, { ...ok, appOrigin: 'http://localhost:4173', cookieSecure: false, bootstrapAdminPassword: 'Short-pass1' });
  assert.deepEqual(localShort.errors, []);
  assert.equal(localShort.warnings.length, 1, 'loopback production only warns (the account is still not created)');

  assert.equal(startupProblems({ NODE_ENV: 'production', EMAIL_LOG_SECRETS: 'true' }, { ...ok, email: { provider: 'log' } }).warnings.length, 1);
  assert.ok(isLoopbackOrigin('http://127.0.0.1:4177') && isLoopbackOrigin('http://[::1]:5173') && !isLoopbackOrigin('http://10.0.0.5'));
});

test('5. self-registration is closed by default in production, and an explicit true opens it', () => {
  const configUrl = new URL('../src/config.js', import.meta.url).href;
  const read = (env) => {
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `const { config } = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify(config.allowRegistration));`], {
      env: { ...process.env, ...env }, encoding: 'utf8', cwd: path.dirname(fileURLToPath(import.meta.url)),
    });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout.trim().split('\n').pop());
  };
  assert.equal(read({ NODE_ENV: 'production', ALLOW_REGISTRATION: '' }), false);
  assert.equal(read({ NODE_ENV: 'production', ALLOW_REGISTRATION: 'true' }), true);
  assert.equal(read({ NODE_ENV: 'development', ALLOW_REGISTRATION: '' }), true);
});

test('6. scrypt N=2^17; an older N=2^14 hash still verifies and is upgraded at sign-in', async () => {
  const fresh = await hashPassword('Fresh-pass-1234');
  assert.equal(fresh.split('$')[1], String(2 ** 17));
  assert.equal(needsRehash(fresh), false);
  assert.ok(await verifyPassword('Fresh-pass-1234', fresh));

  const salt = crypto.randomBytes(16);
  const old = ['scrypt', 16384, 8, 1, salt.toString('base64'), (await promisify(crypto.scrypt)('Legacy-pass-1234', salt, 64, { N: 16384, r: 8, p: 1 })).toString('base64')].join('$');
  assert.ok(await verifyPassword('Legacy-pass-1234', old));
  assert.equal(needsRehash(old), true);
  assert.equal(await verifyPassword('Legacy-pass-1234', 'scrypt$9999999999$8$1$AAAA$AAAA'), false, 'absurd stored parameters are refused, not computed');

  await createUser({ email: 'legacy@example.com', passwordHash: old });
  assert.equal((await call('POST', '/auth/login', { body: { email: 'legacy@example.com', password: 'Wrong-pass-1234' } })).status, 401);
  assert.equal((await findUserByEmail('legacy@example.com')).password_hash, old, 'a failed sign-in changes nothing');
  await signedIn('legacy@example.com', 'Legacy-pass-1234');
  const upgraded = (await findUserByEmail('legacy@example.com')).password_hash;
  assert.notEqual(upgraded, old);
  assert.equal(needsRehash(upgraded), false);
  await signedIn('legacy@example.com', 'Legacy-pass-1234');
});

test('7. deleting a user removes their sign-in history and email; retention purges old history', async () => {
  const email = 'gone@example.com';
  assert.equal((await call('POST', '/auth/register', { body: { email, password: 'Gone-pass-1234' } })).status, 201);
  const user = await findUserByEmail(email);
  await recordLogin({ userId: null, email, success: false, reason: 'locked', ip: '10.9.9.9' });
  await call('POST', '/auth/login', { body: { email, password: 'Gone-pass-1234' } });
  await enqueueEmail({ userId: user.id, to: email, kind: 'test', subject: 's', text: 'hello' });
  await enqueueEmail({ to: email, kind: 'onboarding_code', subject: 's', text: 'code 123456' });
  await recordLogin({ userId: null, email: 'keep@example.com', success: false, reason: 'invalid_credentials' });

  const admin = await signedIn('admin@example.com', 'Admin-pass-1234');
  const del = await call('DELETE', `/entities/User/${user.id}`, { cookie: admin, headers: { Origin: base } });
  assert.ok([200, 204].includes(del.status), `delete answered ${del.status}`);
  const count = async (sql, args) => Number((await db().query(sql, args))[0].n);
  assert.equal(await count('SELECT COUNT(*) AS n FROM login_history WHERE user_id = ? OR lower(email) = ?', [user.id, email]), 0);
  assert.equal(await count('SELECT COUNT(*) AS n FROM email_outbox WHERE user_id = ? OR lower(to_email) = ?', [user.id, email]), 0);
  assert.ok(await count("SELECT COUNT(*) AS n FROM login_history WHERE email = 'keep@example.com'", []) >= 1, 'others are untouched');

  await db().run("UPDATE login_history SET created_at = '2000-01-01T00:00:00.000Z' WHERE email = 'keep@example.com'");
  assert.equal(await purgeLoginHistory(0), 0, 'unset keeps everything');
  assert.ok((await purgeLoginHistory(30)) >= 1);
  assert.equal(await count("SELECT COUNT(*) AS n FROM login_history WHERE email = 'keep@example.com'", []), 0);
  assert.ok(await count('SELECT COUNT(*) AS n FROM login_history', []) >= 1, 'recent history is kept');
});

test('deleteUser is also safe for an id that no longer exists', async () => {
  await deleteUser('no-such-user');
});
