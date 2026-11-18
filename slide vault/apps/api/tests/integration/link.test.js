/**
 * POST /api/apex/link-proof (R1 linking addendum): the account-holder ownership
 * check the Apex gateway asks for when someone links this SlidesVault account to
 * their Apex account. Gateway only, the sign-in's own password check and
 * limiters, no session, a short proof bound to the challenge and the account.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { issueAssertion, parseKeys, verifyLinkProof } from '../../src/http/apexIdentity.js';
import { ADMIN, createTestStack, startServer } from '../helpers/testEnv.js';

const KEY = crypto.randomBytes(32);
const OLD = crypto.randomBytes(32);
const KEYS = JSON.stringify({ kold: OLD.toString('base64'), knew: KEY.toString('base64') });
const PASSWORD = 'legacy-password-1';

const service = ({ audience = 'slidesvault', key = KEY, kid = 'knew' } = {}) =>
  issueAssertion({ audience, kid, key, claims: { purpose: 'link-proof' } });

async function withApp(overrides, fn) {
  const stack = await createTestStack({ configOverrides: { APEX_IDENTITY_KEYS: KEYS, ...overrides } });
  const client = await startServer(stack.app);
  try {
    await fn({ stack, client });
  } finally {
    await client.close();
    await stack.close();
  }
}

/** As the gateway calls it: no cookie, the service credential. */
const ask = (client, body, headers = { 'X-Apex-Service': service() }) => client.post('/api/apex/link-proof', body, { headers });

const sessions = async (stack) => Number((await stack.db.queryOne('SELECT COUNT(*) AS n FROM user_session')).n);

test('required mode: a proof for the right password, bound to the challenge and account, 60 s, no session', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'required' }, async ({ stack, client }) => {
    const user = await stack.container.users.create({ email: 'owner@x.io', password: PASSWORD });
    const before = await sessions(stack);
    const res = await ask(client, { email: 'Owner@X.io', password: PASSWORD, challenge_id: 'ch-1' });
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('set-cookie'), null, 'no cookie');
    assert.equal(client.jar.size, 0);
    assert.equal(await sessions(stack), before, 'no session');
    const proof = res.body.proof;
    assert.equal(proof.split('.')[0], 'knew', 'the current (last listed) kid');
    const v = verifyLinkProof(proof, { keys: parseKeys(KEYS), app: 'slidesvault', challengeId: 'ch-1' });
    assert.equal(v.ok, true);
    assert.equal(v.claims.app_user_id, user.id);
    assert.equal(v.claims.exp - v.claims.iat, 60);
    assert.equal(verifyLinkProof(proof, { keys: parseKeys(KEYS), app: 'showcase', challengeId: 'ch-1' }).ok, false);
    assert.deepEqual(await stack.container.users.findById(user.id), user, 'the account row is untouched');
    // A proof is no identity assertion; the legacy sign-in stays closed.
    assert.equal((await client.get('/api/auth/me', { headers: { 'X-Apex-Identity': proof } })).status, 401);
    assert.equal((await client.login('owner@x.io', PASSWORD)).status, 403);
  });
});

test('APEX_IDENTITY_KID picks the signing key', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional', APEX_IDENTITY_KID: 'kold' }, async ({ stack, client }) => {
    await stack.container.users.create({ email: 'kid@x.io', password: PASSWORD });
    const res = await ask(client, { email: 'kid@x.io', password: PASSWORD, challenge_id: 'c1' });
    assert.equal(res.body.proof.split('.')[0], 'kold');
  });
});

test('wrong password is 401, and the sign-in limiters are shared with the sign-in', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional' }, async ({ stack, client }) => {
    await stack.container.users.create({ email: 'lock@x.io', password: PASSWORD });
    for (let i = 0; i < 10; i++) {
      assert.equal((await ask(client, { email: 'lock@x.io', password: 'wrong', challenge_id: 'c1' })).status, 401);
    }
    const limited = await ask(client, { email: 'lock@x.io', password: PASSWORD, challenge_id: 'c1' });
    assert.equal(limited.status, 429, 'limited even with the right password');
    assert.equal((await client.login('lock@x.io', PASSWORD)).status, 429, 'the sign-in shares the limiter');
    assert.equal((await ask(client, { email: 'nobody@x.io', password: PASSWORD, challenge_id: 'c1' })).status, 401);
  });
});

test('only the gateway: untrusted source, missing or forged credential are 403; no keys is 503', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'required', APEX_IDENTITY_TRUSTED_SOURCES: '10.0.0.0/8' }, async ({ stack, client }) => {
    await stack.container.users.create({ email: 'a@x.io', password: PASSWORD });
    const res = await ask(client, { email: 'a@x.io', password: PASSWORD, challenge_id: 'c1' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'APEX_GATEWAY_ONLY');
  });
  await withApp({ APEX_IDENTITY_MODE: 'off' }, async ({ stack, client }) => {
    await stack.container.users.create({ email: 'a@x.io', password: PASSWORD });
    const body = { email: 'a@x.io', password: PASSWORD, challenge_id: 'c1' };
    assert.equal((await ask(client, body, {})).status, 403, 'no credential');
    assert.equal((await ask(client, body, { 'X-Apex-Service': service({ key: crypto.randomBytes(32) }) })).status, 403);
    assert.equal((await ask(client, body, { 'X-Apex-Service': service({ audience: 'showcase' }) })).status, 403);
    assert.equal((await ask(client, body)).status, 200, 'works in mode off when keys are configured');
  });
  await withApp({ APEX_IDENTITY_KEYS: '' }, async ({ client }) => {
    assert.equal((await ask(client, { email: ADMIN.email, password: ADMIN.password, challenge_id: 'c1' })).status, 503);
  });
});

test('deactivated and passwordless (Google or Apex) accounts are refused clearly', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional' }, async ({ stack, client }) => {
    const users = stack.container.users;
    const d = await users.create({ email: 'off@x.io', password: PASSWORD });
    await stack.db.execute("UPDATE app_user SET status = 'disabled' WHERE id = ?", [d.id]);
    const off = await ask(client, { email: 'off@x.io', password: PASSWORD, challenge_id: 'c1' });
    assert.equal(off.status, 403);
    assert.equal(off.body.code, 'APEX_LINK_DISABLED');

    await users.create({ email: 'g@x.io' });
    const google = await ask(client, { email: 'g@x.io', password: PASSWORD, challenge_id: 'c1' });
    assert.equal(google.status, 422);
    assert.match(google.body.error, /Google/);

    assert.equal((await ask(client, { email: 'g@x.io', password: PASSWORD, challenge_id: 'bad id!' })).status, 400);
  });
});
