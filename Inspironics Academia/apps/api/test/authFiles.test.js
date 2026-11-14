import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Accounts and files through the HTTP API: register, sign in, profile, password change, reset links,
// invites, rate limits and sessions; uploading playbooks, the content proxy and lesson media streaming.

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-auth-files-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  EMAIL_PROVIDER: 'log', ALLOW_REGISTRATION: 'true', BOOTSTRAP_ADMIN_EMAIL: 'boss@example.com', MAX_UPLOAD_MB: '1',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { putObject, objectKey } = await import('../src/files/objectStore.js');
const { entities } = await import('../src/repo/entities.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
let ipCounter = 0;

/** A client: its own cookie jar and, by default, its own IP (the API trusts X-Forwarded-For from loopback). */
function client(ip = `10.0.0.${++ipCounter}`) {
  let cookie = '';
  const req = async (method, url, body, headers = {}) => {
    const raw = Buffer.isBuffer(body);
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: {
        'X-Forwarded-For': ip,
        ...(body !== undefined && !raw ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const buf = Buffer.from(await res.arrayBuffer());
    let data = buf.toString();
    try { data = data ? JSON.parse(data) : null; } catch { /* binary or text */ }
    return { status: res.status, data, buf, headers: res.headers };
  };
  return { req, get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const resetLinkFor = async (email) => {
  const [row] = await db().query('SELECT text_body FROM email_outbox WHERE to_email = ? ORDER BY created_at DESC LIMIT 1', [email]);
  return row?.text_body.match(/token=([A-Za-z0-9_-]+)/)?.[1];
};

let admin;
before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  admin = client();
  const first = await admin.req('POST', '/auth/register', { email: 'First@Example.com ', password: 'Admin-pass-123', full_name: 'First' });
  assert.equal(first.status, 201);
  assert.equal(first.data.user.role, 'admin', 'the first account becomes admin');
});

after(async () => {
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('registration validates input and only the first account is admin (never by email)', async () => {
  const c = client();
  assert.equal((await c.req('POST', '/auth/register', { email: 'not-an-email', password: 'Valid-pass-123' })).status, 400);
  assert.equal((await c.req('POST', '/auth/register', { email: 'weak@example.com', password: 'short' })).status, 400);
  assert.equal((await c.req('POST', '/auth/register', { email: 'first@example.com', password: 'Valid-pass-123' })).status, 400, 'emails are unique, case-insensitively');
  const user = await c.req('POST', '/auth/register', { email: 'learner@example.com', password: 'Learner-pass-123', full_name: 'Lee' });
  assert.equal(user.status, 201);
  assert.equal(user.data.user.role, 'user');
  assert.equal(user.data.user.password_hash, undefined, 'never returned');
  const boss = await client().req('POST', '/auth/register', { email: 'boss@example.com', password: 'Boss-pass-1234' });
  assert.equal(boss.data.user.role, 'user', 'registering with BOOTSTRAP_ADMIN_EMAIL does not grant admin (security review L3)');
});

test('sign in, who-am-I, sign out — and wrong passwords are refused and recorded', async () => {
  const c = client();
  assert.equal((await c.req('GET', '/auth/me')).status, 401);
  assert.equal((await c.req('POST', '/auth/login', { email: 'learner@example.com', password: 'wrong-password' })).status, 401);
  assert.equal((await c.req('POST', '/auth/login', { email: 'nobody@example.com', password: 'whatever-123' })).status, 401);
  const ok = await c.req('POST', '/auth/login', { email: ' LEARNER@example.com', password: 'Learner-pass-123' });
  assert.equal(ok.status, 200);
  assert.equal((await c.req('GET', '/auth/me')).data.email, 'learner@example.com');

  const history = await c.req('GET', '/auth/login-history');
  assert.ok(history.data.some((h) => h.success === false || h.success === 0), 'the failed attempt is in the history');
  assert.ok(history.data.every((h) => h.email === 'learner@example.com'), 'learners only see their own history');

  assert.equal((await c.req('POST', '/auth/logout')).status, 200);
  assert.equal((await c.req('GET', '/auth/me')).status, 401);
});

test('profile: name and avatar are validated', async () => {
  const c = client();
  await c.req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' });
  assert.equal((await c.req('PATCH', '/auth/me', {})).status, 400);
  assert.equal((await c.req('PATCH', '/auth/me', { full_name: 42 })).status, 400);
  assert.equal((await c.req('PATCH', '/auth/me', { avatar_url: 'https://evil.example/x.png' })).status, 400);
  assert.equal((await c.req('PATCH', '/auth/me', { avatar_url: `data:image/png;base64,${'A'.repeat(200_001)}` })).status, 400);
  const ok = await c.req('PATCH', '/auth/me', { full_name: '  Lee Learner ', avatar_url: 'data:image/png;base64,iVBORw0KGgo=' });
  assert.equal(ok.data.full_name, 'Lee Learner');
  assert.equal((await c.req('PATCH', '/auth/me', { avatar_url: '' })).data.avatar_url, '');
});

test('changing the password needs the current one and signs out other sessions', async () => {
  const laptop = client();
  const phone = client();
  await laptop.req('POST', '/auth/register', { email: 'pat@example.com', password: 'Pat-pass-12345' });
  await phone.req('POST', '/auth/login', { email: 'pat@example.com', password: 'Pat-pass-12345' });
  assert.equal((await laptop.req('POST', '/auth/change-password', { currentPassword: 'nope-nope-123', newPassword: 'Pat-pass-67890' })).status, 400);
  assert.equal((await laptop.req('POST', '/auth/change-password', { currentPassword: 'Pat-pass-12345', newPassword: 'x' })).status, 400);
  assert.equal((await laptop.req('POST', '/auth/change-password', { currentPassword: 'Pat-pass-12345', newPassword: 'Pat-pass-67890' })).status, 200);
  assert.equal((await laptop.req('GET', '/auth/me')).status, 200, 'this session stays signed in');
  assert.equal((await phone.req('GET', '/auth/me')).status, 401, 'other sessions are signed out');
  assert.equal((await client().req('POST', '/auth/login', { email: 'pat@example.com', password: 'Pat-pass-67890' })).status, 200);
});

test('password reset: a one-time link, never revealing whether an account exists', async () => {
  const c = client();
  assert.deepEqual((await c.req('POST', '/auth/reset-password-request', { email: 'ghost@example.com' })).data, { ok: true });
  assert.deepEqual((await c.req('POST', '/auth/reset-password-request', { email: 'pat@example.com' })).data, { ok: true });
  const token = await resetLinkFor('pat@example.com');
  assert.ok(token, 'the reset link is queued as an email');
  assert.equal(await resetLinkFor('ghost@example.com'), undefined);

  const d = client();
  assert.equal((await d.req('POST', '/auth/reset-password', { newPassword: 'Pat-reset-12345' })).status, 400);
  assert.equal((await d.req('POST', '/auth/reset-password', { resetToken: 'forged', newPassword: 'Pat-reset-12345' })).status, 400);
  assert.equal((await d.req('POST', '/auth/reset-password', { resetToken: token, newPassword: 'x' })).status, 400);
  assert.equal((await d.req('POST', '/auth/reset-password', { resetToken: token, newPassword: 'Pat-reset-12345' })).status, 200);
  assert.equal((await d.req('POST', '/auth/reset-password', { resetToken: token, newPassword: 'Pat-again-12345' })).status, 400, 'a link works once');
  assert.equal((await client().req('POST', '/auth/login', { email: 'pat@example.com', password: 'Pat-reset-12345' })).status, 200);

  await db().run("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'");
  await client().req('POST', '/auth/reset-password-request', { email: 'pat@example.com' });
  const fresh = await resetLinkFor('pat@example.com');
  await db().run("UPDATE password_resets SET expires_at = '2000-01-01T00:00:00.000Z'");
  assert.equal((await client().req('POST', '/auth/reset-password', { resetToken: fresh, newPassword: 'Pat-late-12345' })).status, 400, 'expired links are refused');
});

test('invites: admins only, with a one-time password and the chosen audience', async () => {
  const learner = client();
  await learner.req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' });
  assert.equal((await learner.req('POST', '/auth/invite', { email: 'new@example.com' })).status, 403);
  assert.equal((await admin.req('POST', '/auth/invite', { email: 'bad' })).status, 400);
  assert.equal((await admin.req('POST', '/auth/invite', { email: 'learner@example.com' })).status, 400);
  const inv = await admin.req('POST', '/auth/invite', { email: 'Intern@Example.com', audience: 'intern', role: 'superuser', full_name: 'Ivy' });
  assert.equal(inv.status, 201);
  assert.equal(inv.data.user.role, 'user', 'unknown roles become user');
  assert.equal(inv.data.user.audience, 'intern');
  assert.equal(inv.data.email_sent, false, 'no email service configured');
  assert.equal((await client().req('POST', '/auth/login', { email: 'intern@example.com', password: inv.data.temporary_password })).status, 200);

  assert.equal((await admin.req('GET', `/auth/users/${inv.data.user.id}`)).data.email, 'intern@example.com');
  assert.equal((await admin.req('GET', '/auth/users/missing')).status, 404);
  assert.equal((await learner.req('GET', `/auth/users/${inv.data.user.id}`)).status, 403);
  const all = await admin.req('GET', `/auth/login-history?user_id=${inv.data.user.id}`);
  assert.ok(all.data.length >= 1 && all.data.every((h) => h.email === 'intern@example.com'), 'admins can read one user\'s history');
});

test('a disabled account can neither sign in nor get a reset link', async () => {
  const user = (await db().query("SELECT id FROM users WHERE email = 'learner@example.com'"))[0];
  await db().run('UPDATE users SET disabled = 1 WHERE id = ?', [user.id]);
  assert.equal((await client().req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' })).status, 401);
  const c = client();
  await c.req('POST', '/auth/reset-password-request', { email: 'learner@example.com' });
  assert.equal(await resetLinkFor('learner@example.com'), undefined, 'no reset link for a disabled account');
  await db().run('UPDATE users SET disabled = 0 WHERE id = ?', [user.id]);
});

test('rate limits: repeated sign-in attempts and sensitive requests are throttled per client', async () => {
  const attacker = client('10.9.9.9');
  let last;
  // Targets an address other tests don't sign in with: ten failures also lock that email for 15 minutes
  // whatever the IP (per-account lockout, covered in authHardening.test.js).
  for (let i = 0; i < 11; i++) last = await attacker.req('POST', '/auth/login', { email: 'target@example.com', password: `guess-${i}-xxxx` });
  assert.equal(last.status, 429);
  assert.match(last.data.error, /Too many sign-in attempts/);
  assert.ok(Number(last.headers.get('retry-after')) > 0);
  assert.equal((await client().req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' })).status, 200, 'other clients and accounts are unaffected');

  const spammer = client('10.9.9.10');
  const codes = [];
  for (let i = 0; i < 6; i++) codes.push((await spammer.req('POST', '/auth/reset-password-request', { email: `x${i}@example.com` })).status);
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
});

// ---- files -----------------------------------------------------------------------------------

test('uploads: admins only, PDF/DOCX only, not empty, under the size limit — and content-addressed', async () => {
  const learner = client();
  await learner.req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' });
  const name = { 'X-File-Name': encodeURIComponent('Security Handbook (v2).pdf') };
  const pdf = Buffer.from('%PDF-1.7 fake playbook bytes');
  assert.equal((await learner.req('POST', '/files', pdf, name)).status, 403);
  assert.equal((await admin.req('POST', '/files', pdf, { 'X-File-Name': 'virus.exe' })).status, 400);
  assert.equal((await admin.req('POST', '/files', pdf)).status, 400, 'a file name is required');
  assert.equal((await admin.req('POST', '/files', Buffer.alloc(0), name)).status, 400);
  assert.equal((await admin.req('POST', '/files', Buffer.alloc(1.5 * 1024 * 1024, 1), name)).status, 413);

  const up = await admin.req('POST', '/files', pdf, name);
  assert.equal(up.status, 201);
  assert.match(up.data.file_uri, /^upload:[a-f0-9]{64}$/);
  assert.deepEqual([up.data.file_name, up.data.file_type, up.data.size], ['Security Handbook (v2).pdf', 'pdf', pdf.length]);
  assert.equal((await admin.req('POST', '/files', pdf, name)).data.file_uri, up.data.file_uri, 'same bytes, same key');

  const pb = await entities.Playbook.create({ title: 'Security Handbook', file_url: up.data.file_uri, file_name: up.data.file_name, file_type: 'pdf' });
  const view = await admin.req('GET', `/playbooks/${pb.id}/content`);
  assert.equal(view.status, 200);
  assert.equal(view.headers.get('content-type'), 'application/pdf');
  assert.match(view.headers.get('content-disposition'), /^inline; filename\*=UTF-8''Security%20Handbook%20\(v2\)\.pdf$/);
  assert.deepEqual(view.buf, pdf);
  assert.match((await admin.req('GET', `/playbooks/${pb.id}/content?download=1`)).headers.get('content-disposition'), /^attachment/);
  assert.equal((await learner.req('GET', `/playbooks/${pb.id}/content`)).status, 403, 'learners never get the source file');
  assert.equal((await admin.req('GET', '/playbooks/missing/content')).status, 404);
});

test('lesson media streams to signed-in users with Range support, and only media objects', async () => {
  const video = Buffer.from('0123456789abcdefghij');
  const key = objectKey('media', 'lesson-1', 'video');
  await putObject(key, video, { source: 'media', content_type: 'video/mp4' });
  const other = objectKey('upload', 'private-playbook');
  await putObject(other, Buffer.from('secret playbook'), { source: 'upload' });

  const learner = client();
  await learner.req('POST', '/auth/login', { email: 'learner@example.com', password: 'Learner-pass-123' });
  assert.equal((await client().req('GET', `/media/${key}`)).status, 401);
  const full = await learner.req('GET', `/media/${key}`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(full.headers.get('accept-ranges'), 'bytes');
  assert.deepEqual(full.buf, video);

  const part = await learner.req('GET', `/media/${key}`, undefined, { Range: 'bytes=5-9' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 5-9/20');
  assert.equal(part.buf.toString(), '56789');
  assert.equal((await learner.req('GET', `/media/${key}`, undefined, { Range: 'bytes=-4' })).buf.toString(), 'ghij', 'suffix range');
  assert.equal((await learner.req('GET', `/media/${key}`, undefined, { Range: 'bytes=15-' })).buf.toString(), 'fghij', 'open-ended range');
  assert.equal((await learner.req('GET', `/media/${key}`, undefined, { Range: 'bytes=50-60' })).status, 416);

  assert.equal((await learner.req('GET', `/media/${other}`)).status, 404, 'an uploaded playbook is not served as media');
  assert.equal((await learner.req('GET', '/media/not-a-key')).status, 404);
  assert.equal((await learner.req('GET', `/media/${'a'.repeat(64)}`)).status, 404);
});
