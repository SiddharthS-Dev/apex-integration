/**
 * OAuth and token-lifecycle integration tests.
 *
 * These exercise the real DropboxAuthService against the fake Dropbox, so the
 * things that are easy to get wrong — single-use codes, state replay,
 * concurrent refresh, 401 recovery — are covered by behaviour rather than by
 * reading the code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, connectDropbox } from '../helpers/testEnv.js';
import { TokenCipher } from '../../src/crypto/tokenCipher.js';
import { DropboxAuthenticationError } from '../../src/integrations/dropbox/errors.js';

test('the authorization URL requests offline access and carries a state', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { url } = await stack.container.auth.getAuthorizationUrl({ userId: 'user-1' });
  const parsed = new URL(url);

  assert.equal(parsed.origin + parsed.pathname, 'https://www.dropbox.com/oauth2/authorize');
  assert.equal(parsed.searchParams.get('response_type'), 'code');
  assert.equal(
    parsed.searchParams.get('token_access_type'),
    'offline',
    'without offline access Dropbox returns no refresh token'
  );
  assert.equal(parsed.searchParams.get('client_id'), 'fake-app-key');
  assert.ok(parsed.searchParams.get('state'), 'a CSRF state must be present');
  assert.ok(!url.includes('fake-app-secret'), 'the app secret never goes in a URL');
});

test('exchanging a code stores an encrypted refresh token and the account', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  const result = await stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state });

  assert.equal(result.connected, true);
  assert.equal(result.account_email, 'avery.raman@inspironics.net');

  // The row itself must not contain the plaintext token.
  const row = await stack.db.queryOne('SELECT * FROM storage_connection WHERE provider = ?', ['dropbox']);
  assert.ok(row.refresh_token_encrypted.startsWith('v1.'));
  assert.ok(!row.refresh_token_encrypted.includes('refresh-token-valid'));
  assert.equal(
    new TokenCipher(stack.config.dropbox.tokenEncryptionKey).decrypt(row.refresh_token_encrypted),
    'refresh-token-valid'
  );

  // And no access token is persisted anywhere.
  const dump = JSON.stringify(row);
  assert.ok(!dump.includes('access-'), 'an access token must never be written to the database');
});

test('a replayed authorization code returns the first result instead of failing', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  const first = await stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state });

  // React StrictMode mounts the callback twice with the same code and state.
  const second = await stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state });

  assert.equal(second.replayed, true);
  assert.equal(second.account_email, first.account_email);
  assert.equal(stack.dropbox.callsTo('/oauth2/token').length, 1, 'Dropbox is asked exactly once');
});

test('concurrent callbacks with the same code produce one exchange', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  const results = await Promise.allSettled([
    stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state }),
    stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state }),
  ]);

  const succeeded = results.filter((r) => r.status === 'fulfilled');
  assert.ok(succeeded.length >= 1, 'at least one caller must succeed');
  assert.equal(
    stack.dropbox.callsTo('/oauth2/token').length,
    1,
    'the second caller must not burn the single-use code'
  );
});

test('an unknown, expired or reused state is rejected', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  const { auth, oauthStates } = stack.container;

  await assert.rejects(
    auth.exchangeAuthorizationCode('auth-code-valid', { state: 'never-issued' }),
    (error) => error instanceof DropboxAuthenticationError && /state rejected: unknown/.test(error.message)
  );

  const expired = await oauthStates.issue({ ttlMinutes: -1 });
  await assert.rejects(
    auth.exchangeAuthorizationCode('auth-code-valid', { state: expired.state }),
    /state rejected: expired/
  );

  const used = await oauthStates.issue({ ttlMinutes: 10 });
  await oauthStates.consume(used.state);
  await assert.rejects(
    auth.exchangeAuthorizationCode('auth-code-valid', { state: used.state }),
    /state rejected: already_used/
  );
});

test('a state is consumed exactly once under concurrency', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  const verdicts = await Promise.all([
    stack.container.oauthStates.consume(state),
    stack.container.oauthStates.consume(state),
    stack.container.oauthStates.consume(state),
  ]);

  assert.equal(verdicts.filter((v) => v.ok).length, 1);
  assert.equal(verdicts.filter((v) => !v.ok).length, 2);
});

test('Dropbox returning no refresh token is reported clearly', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  stack.dropbox.state.behavior.noRefreshTokenInExchange = true;

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  await assert.rejects(
    stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state }),
    /token_access_type=offline/
  );
});

test('an invalid authorization code is rejected and recorded as failed', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  await assert.rejects(stack.container.auth.exchangeAuthorizationCode('bogus-code', { state }));

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.connection_status, 'error');
  assert.equal(connection.refreshToken, '', 'nothing is stored after a failed exchange');
});

/* ----------------------------------------------------------- token cache */

test('the access token is cached and not re-minted on every call', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const first = await stack.container.auth.getValidAccessToken();
  const second = await stack.container.auth.getValidAccessToken();

  assert.equal(first, second);
  assert.equal(stack.dropbox.state.tokenRefreshCount, 1);
});

test('concurrent token requests trigger exactly one refresh', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  // Requests A, B and C all find the cache empty at the same moment.
  const tokens = await Promise.all([
    stack.container.auth.getValidAccessToken(),
    stack.container.auth.getValidAccessToken(),
    stack.container.auth.getValidAccessToken(),
  ]);

  assert.equal(new Set(tokens).size, 1, 'B and C must reuse A’s token');
  assert.equal(stack.dropbox.state.tokenRefreshCount, 1, 'only one refresh may reach Dropbox');
});

test('a revoked refresh token marks the connection as needing reconnection', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);
  stack.dropbox.state.behavior.rejectRefreshToken = true;

  await assert.rejects(stack.container.auth.getValidAccessToken(), (error) => {
    // The operator sees what Dropbox actually said; the user sees advice.
    assert.match(error.message, /refused the refresh token/);
    assert.match(error.userMessage, /reconnect Dropbox/i);
    assert.doesNotMatch(error.userMessage, /refresh_token|400/);
    return true;
  });

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.connection_status, 'error');
  assert.match(connection.last_error, /Reconnect Dropbox/);
});

test('asking for a token while disconnected fails with a clear message', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());

  await assert.rejects(stack.container.auth.getValidAccessToken(), (error) => {
    assert.ok(error instanceof DropboxAuthenticationError);
    assert.match(error.userMessage, /not connected/i);
    return true;
  });
});

test('disconnecting revokes at Dropbox and clears the stored credential', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);
  await stack.container.auth.getValidAccessToken();

  const result = await stack.container.auth.revokeAccess({ actor: { id: 'u1', email: 'a@b.c' } });

  assert.equal(result.disconnected, true);
  assert.equal(result.revoked, true);

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.refreshToken, '');
  assert.equal(connection.connection_status, 'disconnected');
  assert.equal(connection.account_email, '');

  const events = await stack.container.audit.list({ limit: 10 });
  assert.ok(events.some((event) => event.action === 'dropbox.disconnected'));
});

test('a credential written with a different key surfaces as a connection error', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  // Simulate a rotated DROPBOX_TOKEN_ENCRYPTION_KEY.
  const foreign = new TokenCipher(Buffer.alloc(32, 9)).encrypt('refresh-token-valid');
  await stack.db.execute('UPDATE storage_connection SET refresh_token_encrypted = ? WHERE provider = ?', [
    foreign,
    'dropbox',
  ]);

  const connection = await stack.container.connections.get('dropbox');
  assert.match(connection.credentialError, /Reconnect Dropbox/);

  const { ConnectionRepository } = await import('../../src/db/repositories/connectionRepository.js');
  assert.equal(ConnectionRepository.sanitize(connection).connection_status, 'error');
});

test('the sanitized connection view cannot leak the refresh token', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const { ConnectionRepository } = await import('../../src/db/repositories/connectionRepository.js');
  const connection = await stack.container.connections.get('dropbox');
  const safe = ConnectionRepository.sanitize(connection);

  assert.ok(!('refreshToken' in safe));
  assert.ok(!('refresh_token_encrypted' in safe));
  assert.ok(!JSON.stringify(safe).includes('refresh-token-valid'));
});
