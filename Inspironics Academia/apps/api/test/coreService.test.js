import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, test } from 'node:test';
import { startHarness } from './helpers/coreHarness.js';

// POST /api/core/identity/resolve and the gateway service assertion (contract §3, §4.2–§4.4).
const k1 = crypto.randomBytes(32).toString('base64');
const k2 = crypto.randomBytes(32).toString('base64');
const h = await startHarness('core-service', {
  APEX_IDENTITY_KEYS: JSON.stringify({ k1, k2 }), APEX_IDENTITY_ISSUER: 'apex-gateway', APEX_IDENTITY_TRUSTED_SOURCES: 'loopback',
});
const { signAssertion, verifyServiceAssertion, parseKeys } = await import('../src/core/index.js');

let admin; let lee;
before(async () => {
  admin = await h.register('ada@example.com');
  lee = await h.invite(admin, 'lee@example.com');
});
after(() => h.stop());

const now = () => Math.floor(Date.now() / 1000);
const claims = (over = {}) => ({ iss: 'apex-gateway', aud: 'core', iat: now(), exp: now() + 60, ...over });
const gateway = h.client();
const resolve = (sub, header) => gateway.call('POST', '/core/identity/resolve', { sub }, header === undefined ? {} : { 'X-Apex-Service': header });

test('a valid assertion resolves the user, active roles and confirmed links', async () => {
  const p = await admin.ok('POST', '/core/identity-links', { core_user_id: lee.id, app: 'slidesvault', app_user_id: 'sv-9' });
  const admin2 = await h.invite(admin, 'bob@example.com', { role: 'admin' });
  await admin2.ok('POST', `/core/identity-links/${p.id}/confirm`, {});
  const r = await resolve(lee.id, signAssertion(claims(), 'k1', k1));
  assert.equal(r.status, 200);
  assert.equal(r.data.active, true);
  assert.deepEqual(r.data.user, { id: lee.id, email: 'lee@example.com', full_name: 'lee' });
  assert.deepEqual(r.data.roles.map((x) => x.role).sort(), ['learner', 'staff']);
  assert.ok(r.data.roles.every((x) => Object.keys(x).sort().join() === 'role,scope_id,scope_type'));
  assert.deepEqual(r.data.links, { showcase: null, slidesvault: 'sv-9' });
});

test('the previous kid still verifies during rotation', async () => {
  const r = await resolve(lee.id, signAssertion(claims(), 'k2', k2));
  assert.equal(r.status, 200);
  assert.equal(r.data.active, true);
});

test('disabled or missing users resolve to active:false', async () => {
  await admin.ok('PATCH', `/entities/User/${lee.id}`, { disabled: true });
  assert.deepEqual((await resolve(lee.id, signAssertion(claims(), 'k1', k1))).data, { active: false });
  await admin.ok('PATCH', `/entities/User/${lee.id}`, { disabled: false });
  assert.deepEqual((await resolve('no-such-user', signAssertion(claims(), 'k1', k1))).data, { active: false });
});

test('ending a user’s sessions sets sessions_valid_after for the gateway (security review L1)', async () => {
  const fresh = await h.invite(admin, 'epoch@example.com');
  const before = await resolve(fresh.id, signAssertion(claims(), 'k1', k1));
  assert.equal(before.data.sessions_valid_after, null, 'no cut-off until sessions are ended');
  const cut = Date.now();
  await admin.ok('PATCH', `/entities/User/${fresh.id}`, { disabled: true }); // ends all of its sessions
  await admin.ok('PATCH', `/entities/User/${fresh.id}`, { disabled: false });
  const after = await resolve(fresh.id, signAssertion(claims(), 'k1', k1));
  assert.equal(after.data.active, true);
  assert.ok(Date.parse(after.data.sessions_valid_after) >= cut - 1000, 'Apex sessions from before the disable are revoked by the gateway');
});

test('missing, tampered, expired, wrong-aud, wrong-iss and unknown-kid assertions are rejected', async () => {
  const good = signAssertion(claims(), 'k1', k1);
  const [kid, payload, sig] = good.split('.');
  const tamperedPayload = Buffer.from(JSON.stringify({ ...claims(), aud: 'core', extra: 1 })).toString('base64url');
  const flip = (s) => (s[0] === 'A' ? `B${s.slice(1)}` : `A${s.slice(1)}`);
  const cases = {
    missing: undefined,
    empty: '',
    garbage: 'not-an-assertion',
    'tampered payload': `${kid}.${tamperedPayload}.${sig}`,
    'tampered signature': `${kid}.${payload}.${flip(sig)}`,
    'signed with another key': signAssertion(claims(), 'k1', crypto.randomBytes(32).toString('base64')),
    expired: signAssertion(claims({ iat: now() - 120, exp: now() - 60 }), 'k1', k1),
    'issued in the future': signAssertion(claims({ iat: now() + 300, exp: now() + 360 }), 'k1', k1),
    'lifetime too long': signAssertion(claims({ exp: now() + 3600 }), 'k1', k1),
    'wrong audience': signAssertion(claims({ aud: 'showcase' }), 'k1', k1),
    'wrong issuer': signAssertion(claims({ iss: 'someone-else' }), 'k1', k1),
    'unknown kid': signAssertion(claims(), 'k9', k1),
    'kid swapped': `k2.${payload}.${sig}`,
  };
  for (const [name, header] of Object.entries(cases)) {
    const r = await resolve(lee.id, header);
    assert.equal(r.status, 401, name);
    assert.ok(!('active' in (r.data || {})), `${name}: no identity data`);
  }
  // A session cookie is not a substitute for the service assertion.
  assert.equal((await admin.call('POST', '/core/identity/resolve', { sub: lee.id })).status, 401);
});

test('a request from a source outside APEX_IDENTITY_TRUSTED_SOURCES is rejected', async () => {
  process.env.APEX_IDENTITY_TRUSTED_SOURCES = '10.0.0.0/8';
  try {
    assert.equal((await resolve(lee.id, signAssertion(claims(), 'k1', k1))).status, 401);
  } finally {
    process.env.APEX_IDENTITY_TRUSTED_SOURCES = 'loopback';
  }
  assert.equal((await resolve(lee.id, signAssertion(claims(), 'k1', k1))).status, 200);
});

test('without configured keys nothing verifies', async () => {
  const saved = process.env.APEX_IDENTITY_KEYS;
  delete process.env.APEX_IDENTITY_KEYS;
  try {
    assert.equal((await resolve(lee.id, signAssertion(claims(), 'k1', k1))).status, 401);
  } finally {
    process.env.APEX_IDENTITY_KEYS = saved;
  }
});

test('verifyServiceAssertion: order, source matching and key parsing (unit)', () => {
  const keys = parseKeys(JSON.stringify({ k1, short: Buffer.from('tiny').toString('base64'), 'bad kid!': k1 }));
  assert.deepEqual([...keys.keys()], ['k1'], 'short keys and malformed kids are ignored');
  assert.equal(parseKeys('{not json').size, 0);
  const opts = { keys, issuer: 'apex-gateway', trustedSources: 'loopback' };
  const good = signAssertion(claims(), 'k1', k1);
  assert.equal(verifyServiceAssertion(good, { ...opts, remoteAddress: '127.0.0.1' }).ok, true);
  assert.equal(verifyServiceAssertion(good, { ...opts, remoteAddress: '::ffff:127.0.0.1' }).ok, true);
  assert.equal(verifyServiceAssertion(good, { ...opts, remoteAddress: '::1' }).ok, true);
  assert.equal(verifyServiceAssertion(good, { ...opts, remoteAddress: '192.168.1.5' }).reason, 'source');
  assert.equal(verifyServiceAssertion(good, { ...opts, remoteAddress: undefined }).reason, 'source');
  assert.equal(verifyServiceAssertion(good, { ...opts, trustedSources: '172.18.0.0/16, 10.1.2.3', remoteAddress: '172.18.4.4' }).ok, true);
  assert.equal(verifyServiceAssertion(good, { ...opts, trustedSources: '172.18.0.0/16, 10.1.2.3', remoteAddress: '10.1.2.3' }).ok, true);
  // Signature is checked before claims: a forged token with a bad audience reports the signature.
  const forged = signAssertion(claims({ aud: 'x' }), 'k1', crypto.randomBytes(32).toString('base64'));
  assert.equal(verifyServiceAssertion(forged, { ...opts, remoteAddress: '127.0.0.1' }).reason, 'signature');
  assert.equal(verifyServiceAssertion(signAssertion(claims({ iat: 'x' }), 'k1', k1), { ...opts, remoteAddress: '127.0.0.1' }).reason, 'expiry');
});
