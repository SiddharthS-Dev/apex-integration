/**
 * The complete lifecycle, over real HTTP.
 *
 * This is the scenario the specification asks to be demonstrated before the
 * integration may be called done:
 *
 *   fresh application -> admin signs in -> connects Dropbox -> OAuth callback
 *   -> refresh token stored encrypted -> account detected -> folder browser
 *   -> folder selected -> initial sync -> files indexed -> a new file appears
 *   -> next sync detects it -> title resolved -> thumbnail generated
 *   -> a user opens the file -> the backend serves the preview
 *   -> the access token expires -> the backend refreshes -> the request continues
 *
 * Nothing is stubbed except Dropbox itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, startServer, ADMIN } from '../helpers/testEnv.js';
import { buildPptx } from '../helpers/fakeDropbox.js';
import { TokenCipher } from '../../src/crypto/tokenCipher.js';

test('the full Dropbox lifecycle, end to end', async (t) => {
  const deck = await buildPptx({
    slides: [['Autonomous Sustainable Infrastructure Platform', 'Engineering']],
    title: '',
  });

  const stack = await createTestStack({
    files: [
      { path: '/Company/Decks/Quarterly Review.pdf' },
      { path: '/Company/Decks/Untitled (12).pptx', content: deck },
      { path: '/Company/Other/ignored.pdf' },
    ],
  });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  /* ------------------------------------------------ 1. a fresh application */
  const anonymous = await http.get('/api/dropbox/status');
  assert.equal(anonymous.status, 401, 'nothing is reachable without signing in');

  const liveness = await http.get('/api/health');
  assert.equal(liveness.status, 200);
  assert.equal(liveness.body.status, 'ok');

  /* -------------------------------------------------------- 2. admin login */
  const login = await http.login(ADMIN.email, ADMIN.password);
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'admin');
  assert.ok(!JSON.stringify(login.body).includes('password'), 'no credential is echoed back');

  const status = await http.get('/api/dropbox/status');
  assert.equal(status.status, 200);
  assert.equal(status.body.connection_status, 'disconnected');

  /* ----------------------------------------------------- 3. connect Dropbox */
  const authUrl = await http.get('/api/dropbox/auth/url');
  assert.equal(authUrl.status, 200);

  const authorizeUrl = new URL(authUrl.body.url);
  assert.equal(authorizeUrl.searchParams.get('token_access_type'), 'offline');
  const state = authorizeUrl.searchParams.get('state');
  assert.ok(state);

  /* ----------------------------------------------------- 4. OAuth callback */
  // Dropbox redirects the browser back with the code and the state.
  const callback = await http.get(
    `/api/dropbox/oauth/callback?code=auth-code-valid&state=${encodeURIComponent(state)}`
  );
  assert.equal(callback.status, 302);
  const redirect = new URL(callback.headers.get('location'));
  assert.equal(redirect.pathname, '/dropbox-settings');
  assert.equal(redirect.searchParams.get('dropbox_connected'), '1');

  /* ------------------------------ 5. the refresh token is stored encrypted */
  const row = await stack.db.queryOne('SELECT * FROM storage_connection WHERE provider = ?', ['dropbox']);
  assert.ok(row.refresh_token_encrypted.startsWith('v1.'), 'stored as AES-256-GCM ciphertext');
  assert.equal(
    new TokenCipher(stack.config.dropbox.tokenEncryptionKey).decrypt(row.refresh_token_encrypted),
    'refresh-token-valid'
  );

  /* ---------------------------------------------------- 6. account detected */
  const connected = await http.get('/api/dropbox/status');
  assert.equal(connected.body.connection_status, 'connected');
  assert.equal(connected.body.account_email, 'avery.raman@inspironics.net');
  assert.equal(connected.body.account_name, 'Avery Raman');
  // The status endpoint is the most likely place for a credential to escape.
  const statusText = JSON.stringify(connected.body);
  assert.ok(!statusText.includes('refresh-token-valid'));
  assert.ok(!statusText.includes('fake-app-secret'));
  assert.ok(!statusText.includes('access-'));

  /* ------------------------------------------------------ 7. folder browser */
  const root = await http.get('/api/dropbox/folders');
  assert.equal(root.status, 200);
  assert.ok(root.body.entries.some((entry) => entry.name === 'company'));

  const company = await http.get('/api/dropbox/folders?path=/Company');
  assert.deepEqual(company.body.entries.map((entry) => entry.name).sort(), ['decks', 'other']);

  /* ------------------------------------------------- 8. the admin picks one */
  const chosen = await http.post('/api/dropbox/folder', { root_folder: '/Company/Decks' });
  assert.equal(chosen.status, 200);
  assert.equal(chosen.body.root_folder, '/Company/Decks');

  /* ------------------------------------------------------- 9. initial sync */
  const firstSync = await http.post('/api/dropbox/sync', { trigger: 'manual' });
  assert.equal(firstSync.status, 200);
  assert.equal(firstSync.body.status, 'success');
  assert.equal(firstSync.body.total, 2, 'only the selected folder is indexed');
  assert.equal(firstSync.body.new, 2);

  /* ----------------------------------------------------- 10. files indexed */
  const library = await http.get('/api/presentations');
  assert.equal(library.body.total, 2);

  const untitled = library.body.items.find((item) => item.dropbox_id);
  assert.ok(untitled.thumbnail_url, 'every indexed file has a cached thumbnail');

  const derived = library.body.items.find((item) => item.title !== 'Quarterly Review');
  assert.equal(
    derived.title,
    'Autonomous Sustainable Infrastructure Platform',
    'the generically-named deck was retitled from its content'
  );

  /* ------------------------------------------ 11. a new file appears later */
  stack.dropbox.addFile({ path: '/Company/Decks/Zero Trust Architecture.pdf' });

  const secondSync = await http.post('/api/dropbox/sync', { trigger: 'scheduled' });
  assert.equal(secondSync.body.new, 1, 'the new file is detected');
  assert.equal(secondSync.body.skipped, 2, 'the unchanged ones are skipped');
  assert.equal(secondSync.body.updated, 0);

  /* ----------------------------------------------- 12. a user opens a file */
  const target = (await http.get('/api/presentations')).body.items.find(
    (item) => item.title === 'Autonomous Sustainable Infrastructure Platform'
  );

  const preview = await http.get(`/api/dropbox/files/${target.id}/preview`);
  assert.equal(preview.status, 200);
  assert.equal(preview.body.contentType, 'application/pdf');
  assert.ok(!JSON.stringify(preview.body).includes('dropboxusercontent'), 'no raw Dropbox URL is exposed');

  const content = await http.get(`/api/dropbox/files/${target.id}/content`);
  assert.equal(content.status, 200);
  assert.equal(content.headers.get('content-type'), 'application/pdf');
  const bytes = await content.response.arrayBuffer();
  assert.ok(bytes.byteLength > 0, 'the bytes are proxied through the backend');

  /* ----------------------------- 13. the token expires mid-request and recovers */
  const refreshesBefore = stack.dropbox.state.tokenRefreshCount;
  stack.dropbox.state.behavior.expireNextAccessToken = true;

  const afterExpiry = await http.post('/api/dropbox/test', {});
  assert.equal(afterExpiry.status, 200);
  assert.equal(afterExpiry.body.ok, true, 'the request continued successfully');
  assert.equal(
    stack.dropbox.state.tokenRefreshCount,
    refreshesBefore + 1,
    'the backend refreshed automatically, exactly once'
  );

  /* --------------------------------------------------- 14. the record trail */
  const logs = await http.get('/api/dropbox/sync/logs');
  assert.equal(logs.body.logs.length, 2);
  assert.equal(logs.body.logs[0].status, 'success');

  const audit = await http.get('/api/dropbox/audit');
  const actions = audit.body.events.map((event) => event.action);
  for (const expected of [
    'auth.login',
    'dropbox.connected',
    'dropbox.folder_changed',
    'sync.started',
    'sync.completed',
    'dropbox.connection_tested',
  ]) {
    assert.ok(actions.includes(expected), `expected an audit record for ${expected}`);
  }
  const auditText = JSON.stringify(audit.body);
  assert.ok(!auditText.includes('refresh-token-valid'), 'the audit trail carries no credential');
  assert.ok(!auditText.includes('auth-code-valid'));

  /* ------------------------------------------------------- 15. health view */
  const health = await http.get('/api/dropbox/health');
  assert.equal(health.body.connected, true);
  assert.equal(health.body.status, 'healthy');
  assert.equal(health.body.indexedFiles, 3);
  assert.equal(health.body.rootFolder, '/Company/Decks');
  assert.equal(health.body.tokenCache.cached, true);
  assert.ok(!('token' in health.body.tokenCache), 'the cache is described, never revealed');

  /* -------------------------------------------------------- 16. disconnect */
  const disconnect = await http.post('/api/dropbox/disconnect', {});
  assert.equal(disconnect.body.disconnected, true);
  assert.equal(disconnect.body.indexedFilesRetained, 3, 'disconnecting does not destroy the catalog');

  const afterDisconnect = await http.get('/api/dropbox/status');
  assert.equal(afterDisconnect.body.connection_status, 'disconnected');
  assert.equal(afterDisconnect.body.account_email, '');
});

test('a non-admin can read the library but cannot touch the connection', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }] });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  // Seed a connection and a synced file as the admin would have.
  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '/Decks',
  });
  await stack.container.sync.run({ trigger: 'manual' });

  await http.post('/api/auth/register', {
    email: 'member@example.com',
    password: 'member-password-1',
    full_name: 'Sana Kapoor',
  });
  const login = await http.login('member@example.com', 'member-password-1');
  assert.equal(login.status, 200);
  assert.equal(login.body.user.role, 'user', 'registration cannot grant the admin role');

  // Reading the library is allowed.
  const library = await http.get('/api/presentations');
  assert.equal(library.status, 200);
  assert.equal(library.body.total, 1);

  // Every administrative route is refused.
  for (const [method, url] of [
    ['get', '/api/dropbox/status'],
    ['get', '/api/dropbox/auth/url'],
    ['get', '/api/dropbox/folders'],
    ['get', '/api/dropbox/health'],
    ['get', '/api/dropbox/sync/logs'],
    ['get', '/api/dropbox/audit'],
    ['get', '/api/metrics'],
    ['post', '/api/dropbox/sync'],
    ['post', '/api/dropbox/disconnect'],
    ['post', '/api/dropbox/folder'],
    ['post', '/api/dropbox/files/rename-untitled'],
  ]) {
    const response = method === 'get' ? await http.get(url) : await http.post(url, {});
    assert.equal(response.status, 403, `${method.toUpperCase()} ${url} should be admin-only`);
  }

  // And so is the direct-download link.
  const [file] = await stack.container.files.list({ status: 'active' });
  const download = await http.get(`/api/dropbox/files/${file.id}/download`);
  assert.equal(download.status, 403);

  // But the proxied content is available, because that is the whole point.
  const content = await http.get(`/api/dropbox/files/${file.id}/content`);
  assert.equal(content.status, 200);
});

test('a cancelled authorization returns the admin to the settings page with a message', async (t) => {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });
  await http.login();

  const cancelled = await http.get(
    '/api/dropbox/oauth/callback?error=access_denied&error_description=The+user+chose+not+to+authorize'
  );
  assert.equal(cancelled.status, 302);
  const redirect = new URL(cancelled.headers.get('location'));
  assert.match(redirect.searchParams.get('dropbox_error'), /chose not to authorize/);

  const status = await http.get('/api/dropbox/status');
  assert.equal(status.body.connection_status, 'disconnected');
});

test('a callback with a forged state does not connect anything', async (t) => {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });
  await http.login();

  const forged = await http.get('/api/dropbox/oauth/callback?code=auth-code-valid&state=forged-by-an-attacker');
  assert.equal(forged.status, 302);
  assert.ok(new URL(forged.headers.get('location')).searchParams.get('dropbox_error'));

  const status = await http.get('/api/dropbox/status');
  assert.equal(status.body.connection_status, 'disconnected');
  assert.equal(stack.dropbox.callsTo('/oauth2/token').length, 0, 'the code was never exchanged');
});

test('the server survives a restart with the connection intact', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }] });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  await http.login();
  const authUrl = await http.get('/api/dropbox/auth/url');
  const state = new URL(authUrl.body.url).searchParams.get('state');
  await http.get(`/api/dropbox/oauth/callback?code=auth-code-valid&state=${encodeURIComponent(state)}`);
  await http.post('/api/dropbox/folder', { root_folder: '/Decks' });

  // Simulate a process restart: the in-memory access token cache is gone, the
  // encrypted refresh token in the database is all that survives.
  stack.container.auth.invalidateAccessToken();
  assert.equal(stack.container.auth.tokenCacheState().cached, false);

  const sync = await http.post('/api/dropbox/sync', {});
  assert.equal(sync.body.status, 'success', 'the connection is usable again without re-authorizing');
  assert.equal(sync.body.new, 1);
});

test('metrics are exposed for the operations that ran', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }] });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  await http.login();
  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '/Decks',
  });
  await http.post('/api/dropbox/sync', {});

  const metrics = await http.get('/api/metrics');
  const text = await metrics.response.text();

  for (const name of [
    'dropbox_api_requests_total',
    'dropbox_auth_refresh_total',
    'dropbox_sync_total',
    'dropbox_files_processed_total',
    'dropbox_sync_duration_seconds',
    'http_requests_total',
  ]) {
    assert.match(text, new RegExp(name), `expected the ${name} metric`);
  }
  assert.ok(!text.includes('refresh-token-valid'), 'metrics carry no credentials');
});
