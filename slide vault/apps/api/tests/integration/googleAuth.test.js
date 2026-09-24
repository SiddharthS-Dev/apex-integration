/**
 * Google sign-in.
 *
 * The cases that matter here are the ones that decide *who gets in*: the
 * domain filter, auto-creation, the verified-email claim and the audience
 * check. Each of them is the only thing standing between a stranger with a
 * Google account and the whole library, so each gets a test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConfig, validateConfig } from '../../src/config/index.js';
import { GoogleAuthService } from '../../src/services/auth/GoogleAuthService.js';
import { ROLES } from '../../src/db/repositories/userRepository.js';
import { createTestStack, startServer, TEST_KEY } from '../helpers/testEnv.js';
import { nullLogger } from '../../src/util/logger.js';

const CLIENT_ID = 'test-client-id.apps.googleusercontent.com';

const GOOGLE_ENV = {
  GOOGLE_OAUTH_ENABLED: 'true',
  GOOGLE_CLIENT_ID: CLIENT_ID,
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:4000/api/auth/google/callback',
};

/** An unsigned JWT — the service reads claims, it does not verify signatures. */
function idToken(claims = {}) {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return [
    encode({ alg: 'RS256', typ: 'JWT' }),
    encode({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      exp: Math.floor(Date.now() / 1000) + 600,
      email: 'someone@inspironics.net',
      email_verified: true,
      name: 'Some One',
      ...claims,
    }),
    'signature',
  ].join('.');
}

/** A fetch that answers Google's token endpoint and nothing else. */
function googleFetch(claims = {}, { ok = true, body } = {}) {
  return async () => ({
    ok,
    status: ok ? 200 : 400,
    json: async () => body ?? { id_token: idToken(claims), access_token: 'at' },
  });
}

async function serviceFor(stack, fetchImpl, overrides = {}) {
  const { container } = stack;
  return new GoogleAuthService({
    config: buildConfig({
      ...GOOGLE_ENV,
      DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY,
      SESSION_TTL_HOURS: '12',
      ...overrides,
    }),
    oauthStates: container.oauthStates,
    users: container.users,
    sessions: container.sessions,
    loginHistory: container.loginHistory,
    audit: container.audit,
    logger: nullLogger,
    fetchImpl,
  });
}

/** Issues a state and runs the callback, the way the route does. */
async function signIn(service, fetchImpl, claims) {
  const { url } = await service.buildAuthUrl({ redirectAfter: '/library' });
  const state = new URL(url).searchParams.get('state');
  service.fetchImpl = fetchImpl ?? googleFetch(claims);
  return service.handleCallback({ code: 'auth-code', state, ip: '127.0.0.1' });
}

test('the authorization URL carries the client id and a single-use state', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack);
    const { url } = await service.buildAuthUrl({ redirectAfter: '/library' });
    const parsed = new URL(url);

    assert.equal(parsed.origin + parsed.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
    assert.equal(parsed.searchParams.get('client_id'), CLIENT_ID);
    assert.equal(parsed.searchParams.get('response_type'), 'code');
    assert.equal(parsed.searchParams.get('scope'), 'openid email profile');
    assert.ok(parsed.searchParams.get('state'));

    // A sign-in needs no long-lived grant, so none is requested.
    assert.equal(parsed.searchParams.get('access_type'), 'online');
  } finally {
    await stack.close();
  }
});

test('an existing user signs in and gets a session', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    await stack.container.users.create({
      email: 'someone@inspironics.net',
      password: 'a-real-password',
      fullName: 'Some One',
      role: ROLES.USER,
    });

    const service = await serviceFor(stack);
    const result = await signIn(service);

    assert.equal(result.user.email, 'someone@inspironics.net');
    assert.equal(result.redirectAfter, '/library');
    assert.ok(result.token);

    // The session is real: it resolves back to the same user.
    const session = await stack.container.sessions.resolve(result.token);
    assert.equal(session.user_id, result.user.id);
  } finally {
    await stack.close();
  }
});

test('an unknown account is refused while auto-creation is off', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack);
    await assert.rejects(signIn(service), /no account for that address/i);
    assert.ok(!(await stack.container.users.findByEmail('someone@inspironics.net')));
  } finally {
    await stack.close();
  }
});

test('auto-creation makes a plain user, never an administrator', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack, undefined, {
      GOOGLE_AUTO_CREATE_USERS: 'true',
      GOOGLE_ALLOWED_DOMAINS: 'inspironics.net',
    });

    const result = await signIn(service);
    assert.equal(result.user.role, ROLES.USER);

    // Created without a password, so the account cannot also be reached
    // through the password form.
    assert.equal(result.user.password_hash, '');
  } finally {
    await stack.close();
  }
});

test('an address outside the allowed domains is refused', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack, undefined, {
      GOOGLE_AUTO_CREATE_USERS: 'true',
      GOOGLE_ALLOWED_DOMAINS: 'inspironics.net',
    });

    await assert.rejects(
      signIn(service, googleFetch({ email: 'stranger@gmail.com' })),
      /not permitted to sign in/i
    );
    assert.ok(!(await stack.container.users.findByEmail('stranger@gmail.com')));
  } finally {
    await stack.close();
  }
});

test('an unverified Google email cannot claim an existing account', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    // The address of a real, privileged account.
    await stack.container.users.create({
      email: 'admin@inspironics.net',
      password: 'the-admins-password',
      role: ROLES.ADMIN,
    });

    const service = await serviceFor(stack);
    await assert.rejects(
      signIn(service, googleFetch({ email: 'admin@inspironics.net', email_verified: false })),
      /unverified email/i
    );
  } finally {
    await stack.close();
  }
});

test('a token issued for another application is refused', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack);
    await assert.rejects(
      signIn(service, googleFetch({ aud: 'someone-elses-client-id' })),
      /different application/i
    );
  } finally {
    await stack.close();
  }
});

test('a token from another issuer is refused', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const service = await serviceFor(stack);
    await assert.rejects(
      signIn(service, googleFetch({ iss: 'https://evil.example.com' })),
      /not issued by Google/i
    );
  } finally {
    await stack.close();
  }
});

test('a replayed callback is rejected', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    await stack.container.users.create({ email: 'someone@inspironics.net', password: 'pw' });
    const service = await serviceFor(stack);

    const { url } = await service.buildAuthUrl({});
    const state = new URL(url).searchParams.get('state');
    service.fetchImpl = googleFetch();

    await service.handleCallback({ code: 'auth-code', state, ip: '127.0.0.1' });
    await assert.rejects(
      service.handleCallback({ code: 'auth-code', state, ip: '127.0.0.1' }),
      /no longer valid/i
    );
  } finally {
    await stack.close();
  }
});

test('a forged state is rejected before any token exchange', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    let exchanged = false;
    const service = await serviceFor(stack, async () => {
      exchanged = true;
      return { ok: true, status: 200, json: async () => ({ id_token: idToken() }) };
    });

    await assert.rejects(
      service.handleCallback({ code: 'auth-code', state: 'made-up', ip: '127.0.0.1' }),
      /no longer valid/i
    );
    assert.equal(exchanged, false, 'the code must not be exchanged without a valid state');
  } finally {
    await stack.close();
  }
});

test('a deactivated account cannot sign in through Google', async () => {
  const stack = await createTestStack({ withApp: false });
  try {
    const user = await stack.container.users.create({
      email: 'someone@inspironics.net',
      password: 'pw',
    });
    await stack.db.execute('UPDATE app_user SET status = ? WHERE id = ?', ['disabled', user.id]);

    const service = await serviceFor(stack);
    await assert.rejects(signIn(service), /deactivated/i);
  } finally {
    await stack.close();
  }
});

/* ------------------------------------------------------------- the route */

test('/api/auth/config hides Google until it is configured', async () => {
  const stack = await createTestStack();
  const server = await startServer(stack.app);
  try {
    const response = await server.get('/api/auth/config');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { password: true, google: false });
  } finally {
    await server.close();
    await stack.close();
  }
});

test('/api/auth/config advertises Google once it is configured', async () => {
  const stack = await createTestStack({ configOverrides: GOOGLE_ENV });
  const server = await startServer(stack.app);
  try {
    const response = await server.get('/api/auth/config');
    assert.equal(response.body.google, true);
  } finally {
    await server.close();
    await stack.close();
  }
});

test('/api/auth/google/start redirects to Google', async () => {
  const stack = await createTestStack({ configOverrides: GOOGLE_ENV });
  const server = await startServer(stack.app);
  try {
    const response = await server.get('/api/auth/google/start');
    assert.equal(response.status, 302);
    assert.ok(response.headers.get('location').startsWith('https://accounts.google.com/'));
  } finally {
    await server.close();
    await stack.close();
  }
});

test('a cancelled consent screen returns to the sign-in page, not a JSON body', async () => {
  const stack = await createTestStack({ configOverrides: GOOGLE_ENV });
  const server = await startServer(stack.app);
  try {
    const response = await server.get('/api/auth/google/callback?error=access_denied');
    assert.equal(response.status, 302);

    const location = new URL(response.headers.get('location'));
    assert.equal(location.pathname, '/login');
    assert.match(location.searchParams.get('error'), /cancelled/i);
  } finally {
    await server.close();
    await stack.close();
  }
});

/* ------------------------------------------------------ the safety gate */

test('auto-creation without a domain filter refuses to start', () => {
  const { errors } = validateConfig(
    buildConfig({
      DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY,
      ...GOOGLE_ENV,
      GOOGLE_AUTO_CREATE_USERS: 'true',
      GOOGLE_ALLOWED_DOMAINS: '',
    })
  );
  assert.ok(
    errors.some((e) => e.includes('GOOGLE_ALLOWED_DOMAINS')),
    'an open door must be a fatal misconfiguration, not a warning'
  );
});

test('auto-creation with a domain filter is accepted', () => {
  const { errors } = validateConfig(
    buildConfig({
      DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY,
      ...GOOGLE_ENV,
      GOOGLE_AUTO_CREATE_USERS: 'true',
      GOOGLE_ALLOWED_DOMAINS: 'inspironics.net, @example.com',
    })
  );
  assert.deepEqual(errors, []);
});
