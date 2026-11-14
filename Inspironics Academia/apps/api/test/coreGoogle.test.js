import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// Google sign-in through external_identities (provider, subject) only — never by email (ADR 0003 §6).
// Google is never called: the verifier is replaced, and the tokeninfo verifier gets a fake fetch.
const h = await startHarness('core-google');
const { setGoogleVerifier } = await import('../src/core/index.js');
const { verifyWithTokeninfo } = await import('../src/core/google.js');

// Fake credentials: "sub:<subject>:<email>" — the email is what a real token would also carry.
setGoogleVerifier(async (credential, clientId) => {
  assert.equal(clientId, 'test-client.apps.googleusercontent.com');
  const [kind, sub] = String(credential).split(':');
  if (kind !== 'sub' || !sub) throw new Error('bad token');
  return { sub };
});

let admin; let lee;
before(async () => {
  admin = await h.register('ada@example.com');
  lee = await h.invite(admin, 'lee@example.com');
});
after(() => { setGoogleVerifier(); return h.stop(); });

const enable = () => { process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com'; };
const disable = () => { delete process.env.GOOGLE_CLIENT_ID; };

test('Google routes are absent (404) unless GOOGLE_CLIENT_ID is set; /api/config is unchanged', async () => {
  disable();
  const anon = h.client();
  assert.equal((await anon.call('POST', '/core/auth/google', { credential: 'sub:g-1:lee@example.com' })).status, 404);
  assert.equal((await anon.call('POST', '/core/auth/google/accept-invite', { credential: 'sub:g-1', token: 'x' })).status, 404);
  assert.equal((await lee.call('POST', '/core/external-identities/google', { credential: 'sub:g-1' })).status, 404);
  assert.equal((await anon.ok('GET', '/config')).google_enabled, false);
});

test('an unknown subject gets 401 without any account hint — even when its email matches a user', async () => {
  enable();
  const anon = h.client();
  const r = await anon.call('POST', '/core/auth/google', { credential: 'sub:g-unknown:lee@example.com' });
  assert.equal(r.status, 401);
  assert.deepEqual(r.data, { error: 'Google sign-in failed' });
  const bad = await anon.call('POST', '/core/auth/google', { credential: 'forged' });
  assert.deepEqual(bad, r, 'an invalid token is indistinguishable from an unknown subject');
  assert.equal((await anon.call('GET', '/core/me')).status, 401, 'no session was created');
});

test('linking by possession, then signing in by subject', async () => {
  enable();
  const link = await lee.call('POST', '/core/external-identities/google', { credential: 'sub:g-lee' });
  assert.equal(link.status, 201);
  assert.equal((await lee.call('POST', '/core/external-identities/google', { credential: 'sub:g-lee' })).status, 200, 'idempotent');
  assert.equal((await admin.call('POST', '/core/external-identities/google', { credential: 'sub:g-lee' })).status, 409, 'linked elsewhere');
  assert.equal((await lee.call('POST', '/core/external-identities/google', { credential: 'garbage' })).status, 401);

  const browser = h.client();
  const r = await browser.call('POST', '/core/auth/google', { credential: 'sub:g-lee:someone-else@example.com' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.id, lee.id, 'found through (google, subject), whatever email the token reports');
  assert.equal((await browser.ok('GET', '/core/me')).user.id, lee.id);
  const detail = await admin.ok('GET', `/core/users/${lee.id}`);
  assert.deepEqual(detail.external_identities.map((e) => Object.keys(e).sort().join()), ['provider,verified_at'], 'provider only, no subject');
  assert.equal((await admin.ok('GET', '/core/audit-events?action=external_identity.linked')).length, 1);

  // A disabled account cannot sign in with Google either.
  await admin.ok('PATCH', `/entities/User/${lee.id}`, { disabled: true });
  assert.equal((await h.client().call('POST', '/core/auth/google', { credential: 'sub:g-lee' })).status, 401);
  await admin.ok('PATCH', `/entities/User/${lee.id}`, { disabled: false });
});

test('an invitation can be accepted with a verified Google credential instead of a password', async () => {
  enable();
  const inv = await admin.ok('POST', '/auth/invite', { email: 'nia@example.com' });
  // The invite email carries a set-password link (password_resets row); create the same row here.
  const token = crypto.randomBytes(32).toString('base64url');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  await h.db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', [hash, inv.user.id, new Date(Date.now() + 3600_000).toISOString()]);

  const taken = await h.client().call('POST', '/core/auth/google/accept-invite', { token, credential: 'sub:g-lee' });
  assert.equal(taken.status, 409, 'a subject linked to someone else is refused');
  assert.equal((await h.db.query('SELECT used_at FROM password_resets WHERE token_hash = ?', [hash]))[0].used_at, null, 'and the link is not consumed');

  const nia = h.client();
  const r = await nia.call('POST', '/core/auth/google/accept-invite', { token, credential: 'sub:g-nia' });
  assert.equal(r.status, 200);
  assert.equal(r.data.user.id, inv.user.id);
  assert.equal((await nia.ok('GET', '/core/me')).user.email, 'nia@example.com');
  assert.equal((await h.client().call('POST', '/core/auth/google/accept-invite', { token, credential: 'sub:g-nia2' })).status, 400, 'single use');
  assert.equal((await h.client().call('POST', '/core/auth/google', { credential: 'sub:g-nia' })).status, 200);

  // Not for accounts that have already signed in (that is a reset link, not an invitation).
  const token2 = crypto.randomBytes(32).toString('base64url');
  await h.db.run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)',
    [crypto.createHash('sha256').update(token2).digest('hex'), lee.id, new Date(Date.now() + 3600_000).toISOString()]);
  assert.equal((await h.client().call('POST', '/core/auth/google/accept-invite', { token: token2, credential: 'sub:g-other' })).status, 400);
});

test('the tokeninfo verifier checks audience, issuer, expiry and subject (fake fetch)', async () => {
  const cid = 'cid-1';
  const ok = { aud: cid, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), sub: '1234', email: 'x@example.com', email_verified: 'false' };
  const fake = (body, status = 200) => async (url) => {
    assert.match(url, /^https:\/\/oauth2\.googleapis\.com\/tokeninfo\?id_token=/);
    return { ok: status === 200, status, json: async () => body };
  };
  assert.deepEqual(await verifyWithTokeninfo('tok', cid, { fetchImpl: fake(ok) }), { sub: '1234' }, 'email_verified is irrelevant');
  for (const [name, body, status] of [
    ['audience', { ...ok, aud: 'other' }],
    ['issuer', { ...ok, iss: 'evil.example' }],
    ['expired', { ...ok, exp: '1' }],
    ['no subject', { ...ok, sub: '' }],
    ['google says no', ok, 400],
  ]) {
    await assert.rejects(verifyWithTokeninfo('tok', cid, { fetchImpl: fake(body, status) }), /Google sign-in failed/, name);
  }
  await assert.rejects(verifyWithTokeninfo('', cid, { fetchImpl: fake(ok) }), /Google sign-in failed/);
});
