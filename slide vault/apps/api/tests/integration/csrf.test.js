/**
 * CSRF origin guard (src/http/security.js originGuard).
 *
 * A cookie-bearing write must name one of our origins; a foreign Origin is
 * refused everywhere; cookie-less writes (the gateway's server-side sign-in,
 * assertion-authenticated requests) and a header-less sign-out still work.
 *
 * POST /api/analytics/view with an empty body is the probe: past the guard it
 * is a 400 (validation) for a signed-in user; stopped by the guard it is a 403
 * with code BAD_ORIGIN.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { issueAssertion } from '../../src/http/apexIdentity.js';
import { createTestStack, startServer } from '../helpers/testEnv.js';

async function withClient(fn, { configOverrides = {}, clientOptions } = {}) {
  const stack = await createTestStack({ configOverrides });
  const client = await startServer(stack.app, clientOptions);
  try {
    await fn({ stack, client });
  } finally {
    await client.close();
    await stack.close();
  }
}

const probe = (client, headers) => client.post('/api/analytics/view', {}, { headers });

test('a signed-in write from our own origin passes the guard', async () => {
  await withClient(async ({ client }) => {
    assert.equal((await client.login()).status, 200);
    const res = await probe(client);
    assert.equal(res.status, 400, 'reaches the route (validation error), not refused by the guard');
  });
});

test('a write naming a foreign Origin is refused, signed in or not', async () => {
  await withClient(async ({ client }) => {
    const anon = await client.post('/api/auth/login', { email: 'a@b.c', password: 'x' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(anon.status, 403);
    assert.equal(anon.body.code, 'BAD_ORIGIN');

    assert.equal((await client.login()).status, 200);
    const signedIn = await probe(client, { Origin: 'https://evil.example' });
    assert.equal(signedIn.status, 403);
    assert.equal(signedIn.body.code, 'BAD_ORIGIN');
  });
});

test('an opaque "null" Origin (sandboxed frame) is never ours', async () => {
  await withClient(async ({ client }) => {
    assert.equal((await client.login()).status, 200);
    const res = await probe(client, { Origin: 'null' });
    assert.equal(res.status, 403);
    assert.equal(res.body.code, 'BAD_ORIGIN');
  });
});

test('the Referer stands in for a missing Origin', async () => {
  await withClient(
    async ({ client }) => {
      assert.equal((await client.login()).status, 200);
      assert.equal((await probe(client, { Referer: 'http://localhost:5173/library?q=1' })).status, 400);
      const foreign = await probe(client, { Referer: 'https://evil.example/page' });
      assert.equal(foreign.status, 403);
    },
    { clientOptions: { origin: null } }
  );
});

test('a cookie-bearing write with neither Origin nor Referer is refused', async () => {
  await withClient(
    async ({ client }) => {
      assert.equal((await client.login()).status, 200, 'cookie-less sign-in (as the gateway does it) passes');
      const res = await probe(client);
      assert.equal(res.status, 403);
      assert.equal(res.body.code, 'BAD_ORIGIN');
    },
    { clientOptions: { origin: null } }
  );
});

test('a header-less sign-out with the cookie still works (the gateway signs apps out this way)', async () => {
  await withClient(
    async ({ client }) => {
      assert.equal((await client.login()).status, 200);
      const res = await client.post('/api/auth/logout');
      assert.equal(res.status < 400, true, `logout answered ${res.status}`);
      assert.equal((await client.get('/api/auth/me')).status, 401);
    },
    { clientOptions: { origin: null } }
  );
});

test('the Host header does not make an origin ours (DNS rebinding)', async () => {
  await withClient(async ({ client }) => {
    assert.equal((await client.login()).status, 200);
    // The test server is reached at 127.0.0.1:<port>; that origin is not configured.
    const res = await probe(client, { Origin: client.base });
    assert.equal(res.status, 403);
  });
});

test('CORS_ORIGINS entries are accepted', async () => {
  await withClient(
    async ({ client }) => {
      assert.equal((await client.login()).status, 200);
      assert.equal((await probe(client, { Origin: 'https://apex.example' })).status, 400);
    },
    { configOverrides: { CORS_ORIGINS: 'http://localhost:5173,https://apex.example' } }
  );
});

test('a gateway-asserted write with no cookie and no Origin is not refused by the guard', async () => {
  const key = crypto.randomBytes(32);
  const kid = 'kcsrf';
  await withClient(
    async ({ client }) => {
      const header = issueAssertion({
        audience: 'slidesvault',
        kid,
        key,
        claims: { sub: 'core-9', app_user_id: null, email: 'c9@x.io', name: 'C Nine', roles: [{ role: 'staff', scope_type: 'organization', scope_id: 'o' }] },
      });
      const res = await probe(client, { 'X-Apex-Identity': header });
      assert.equal(res.status, 400, 'authenticated by the assertion and reaches validation');
    },
    {
      configOverrides: { APEX_IDENTITY_MODE: 'required', APEX_IDENTITY_KEYS: JSON.stringify({ [kid]: key.toString('base64') }) },
      clientOptions: { origin: null },
    }
  );
});
