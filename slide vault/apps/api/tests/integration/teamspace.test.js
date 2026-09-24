/**
 * Dropbox Business team spaces.
 *
 * A team member has two namespaces: their personal home folder, and the team
 * space. The API defaults to the home namespace, so a library that lives in the
 * team space is invisible unless the member has mounted it — which is exactly
 * the manual step this feature removes.
 *
 * The mechanism is the `Dropbox-API-Path-Root` header, injected by the request
 * executor on every namespace-aware call.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, startServer } from '../helpers/testEnv.js';
import { createFakeDropbox, HOME_NAMESPACE, TEAM_NAMESPACE } from '../helpers/fakeDropbox.js';
import { createDatabase } from '../../src/db/index.js';
import { createContainer, bootstrapAdmin } from '../../src/container.js';
import { nullLogger } from '../../src/util/logger.js';
import { Metrics } from '../../src/services/metrics/metrics.js';
import { testConfig } from '../helpers/testEnv.js';
import { createApp } from '../../src/app.js';
import { isNamespaceAware } from '../../src/integrations/dropbox/DropboxRequestExecutor.js';
import { ConnectionRepository } from '../../src/db/repositories/connectionRepository.js';
import { classifyResponse, DropboxPathRootError } from '../../src/integrations/dropbox/errors.js';

/** A stack whose fake Dropbox is a Business account with a team space. */
async function teamStack({ files = [], withApp = true } = {}) {
  const config = testConfig();
  const dropbox = createFakeDropbox({ files, team: true });
  const db = await createDatabase(config, nullLogger);
  const metrics = new Metrics();
  const container = createContainer({
    config,
    db,
    logger: nullLogger,
    metrics,
    fetchImpl: dropbox.fetchImpl,
  });
  await bootstrapAdmin({ config, users: container.users, logger: nullLogger });

  return {
    config,
    db,
    container,
    dropbox,
    metrics,
    app: withApp ? createApp(container) : null,
    async close() {
      container.scheduler.stop();
      await db.close();
    },
  };
}

/** Completes a real OAuth exchange, which is what records the namespaces. */
async function connectViaOAuth(stack) {
  const { state } = await stack.container.oauthStates.issue({ ttlMinutes: 10 });
  return stack.container.auth.exchangeAuthorizationCode('auth-code-valid', { state });
}

/* ------------------------------------------------------- which endpoints */

test('only path-addressing endpoints carry a path root', () => {
  for (const endpoint of [
    'files/list_folder',
    'files/list_folder/continue',
    'files/get_metadata',
    'files/download',
    'files/get_thumbnail_v2',
    'files/get_preview',
    'files/get_temporary_link',
    'files/move_v2',
    'sharing/list_folders',
  ]) {
    assert.equal(isNamespaceAware(endpoint), true, `${endpoint} should be namespace-aware`);
  }

  // These address the account, not a file. A namespace header on them is
  // meaningless, so it is not sent.
  for (const endpoint of ['users/get_current_account', 'users/get_space_usage', 'auth/token/revoke']) {
    assert.equal(isNamespaceAware(endpoint), false, `${endpoint} should not be namespace-aware`);
  }
});

/* ------------------------------------------------------------- personal */

test('a personal account sends its own namespace and behaves as before', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }], withApp: false });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  const connection = await stack.container.connections.get('dropbox');

  // Root and home are the same id on a personal account.
  assert.equal(connection.root_namespace_id, HOME_NAMESPACE);
  assert.equal(connection.home_namespace_id, HOME_NAMESPACE);
  assert.equal(ConnectionRepository.isTeamSpace(connection), false);

  const result = await stack.container.sync.run({ trigger: 'manual' });
  assert.equal(result.counts.new, 1, 'the personal library still syncs');

  const header = stack.dropbox.pathRootOf('files/list_folder');
  assert.deepEqual(JSON.parse(header), { '.tag': 'root', root: HOME_NAMESPACE });
});

/* ----------------------------------------------------------- team space */

test('a team-space library is invisible without the header, and visible with it', async (t) => {
  const stack = await teamStack({
    files: [
      // The library lives in the team space, not in anyone's personal folder.
      { path: '/Company/Decks/Quarterly Review.pdf', namespace: TEAM_NAMESPACE },
      { path: '/Company/Decks/Zero Trust.pdf', namespace: TEAM_NAMESPACE },
      // The member's own folder has something else entirely.
      { path: '/Personal Notes/Scratch.pdf', namespace: HOME_NAMESPACE },
    ],
    withApp: false,
  });
  t.after(() => stack.close());

  // Before connecting, nothing is recorded and the home namespace is implied —
  // this is what the old behaviour looked like.
  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '',
  });
  const homeOnly = await stack.container.provider.listFolders('');
  assert.deepEqual(
    homeOnly.map((entry) => entry.name),
    ['personal notes'],
    'without a path root, only the member’s own folder is reachable'
  );

  // A real authorization records the namespaces, and the team space appears.
  await connectViaOAuth(stack);
  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.root_namespace_id, TEAM_NAMESPACE);
  assert.equal(connection.home_namespace_id, HOME_NAMESPACE);
  assert.equal(connection.home_path, '/Avery Raman');
  assert.equal(ConnectionRepository.isTeamSpace(connection), true);

  const teamView = await stack.container.provider.listFolders('');
  assert.deepEqual(
    teamView.map((entry) => entry.name),
    ['company'],
    'the team space is browsable without anyone mounting it'
  );
});

test('a team-space folder syncs end to end', async (t) => {
  const stack = await teamStack({
    files: [
      { path: '/Company/Decks/Quarterly Review.pdf', namespace: TEAM_NAMESPACE },
      { path: '/Company/Decks/Zero Trust.pdf', namespace: TEAM_NAMESPACE },
      { path: '/Personal Notes/Scratch.pdf', namespace: HOME_NAMESPACE },
    ],
    withApp: false,
  });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  await stack.container.folders.setRootFolder('/Company/Decks');

  const result = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(result.status, 'success');
  assert.equal(result.counts.new, 2, 'both team-space decks were indexed');

  const files = await stack.container.files.list({ status: 'active' });
  assert.deepEqual(
    files.map((file) => file.name).sort(),
    ['Quarterly Review.pdf', 'Zero Trust.pdf']
  );
  assert.ok(
    !files.some((file) => file.name === 'Scratch.pdf'),
    'the member’s personal folder is outside the chosen root'
  );
});

test('content is fetched from the team namespace too', async (t) => {
  const stack = await teamStack({
    files: [{ path: '/Company/Decks/Quarterly Review.pdf', namespace: TEAM_NAMESPACE }],
    withApp: false,
  });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  await stack.container.folders.setRootFolder('/Company/Decks');
  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });

  // Download, thumbnail and temporary link all address a path, so all three
  // must carry the header or they resolve into the wrong namespace.
  const object = await stack.container.provider.download(file.external_id);
  assert.ok((await object.buffer()).length > 0);
  assert.deepEqual(JSON.parse(stack.dropbox.pathRootOf('files/download')), {
    '.tag': 'root',
    root: TEAM_NAMESPACE,
  });
  assert.deepEqual(JSON.parse(stack.dropbox.pathRootOf('get_thumbnail')), {
    '.tag': 'root',
    root: TEAM_NAMESPACE,
  });
});

test('the account endpoint is not given a path root', async (t) => {
  const stack = await teamStack({ files: [], withApp: false });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  await stack.container.client.getCurrentAccount();

  assert.equal(stack.dropbox.pathRootOf('get_current_account'), null);
});

/* -------------------------------------------------------- self-healing */

test('a moved team space repairs itself and the request continues', async (t) => {
  const stack = await teamStack({
    files: [{ path: '/Company/Decks/Quarterly Review.pdf', namespace: TEAM_NAMESPACE }],
    withApp: false,
  });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  await stack.container.folders.setRootFolder('/Company/Decks');
  await stack.container.sync.run({ trigger: 'manual' });

  // The team is reorganized: Dropbox issues a new root namespace id. The
  // stored one is now stale, and every call would fail without repair.
  stack.dropbox.moveTeamSpace('3000');

  const result = await stack.container.sync.run({ trigger: 'manual', force: true });

  assert.equal(result.status, 'success', 'the sync recovered rather than failing');
  assert.equal(result.counts.updated, 1);

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.root_namespace_id, '3000', 'the new namespace was persisted');

  assert.deepEqual(JSON.parse(stack.dropbox.pathRootOf('files/list_folder')), {
    '.tag': 'root',
    root: '3000',
  });
});

test('invalid_root is classified with the corrected namespace', () => {
  const body = JSON.stringify({
    error_summary: 'invalid_root/...',
    error: {
      '.tag': 'invalid_root',
      invalid_root: { '.tag': 'team', root_namespace_id: '9999', home_namespace_id: '1000' },
    },
  });
  const error = classifyResponse(422, body);

  assert.ok(error instanceof DropboxPathRootError);
  assert.equal(error.newRootNamespaceId, '9999');
  assert.doesNotMatch(error.userMessage, /9999/, 'namespace ids are not user-facing detail');
});

/* ---------------------------------------------------------- migration */

test('a connection made before this feature keeps its old path semantics', async (t) => {
  const stack = await teamStack({
    files: [
      { path: '/Company/Decks/Team Deck.pdf', namespace: TEAM_NAMESPACE },
      { path: '/Decks/Personal Deck.pdf', namespace: HOME_NAMESPACE },
    ],
    withApp: false,
  });
  t.after(() => stack.close());

  // Exactly what an upgraded database looks like: credentials, no namespaces.
  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '/Decks',
  });

  const result = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(result.counts.new, 1);
  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(
    file.name,
    'Personal Deck.pdf',
    'an established sync must not be silently repointed at a different namespace'
  );
  assert.equal(stack.dropbox.pathRootOf('files/list_folder'), null, 'no header is sent');
});

test('the connection test tells an upgraded deployment that a team space is available', async (t) => {
  const stack = await teamStack({
    files: [{ path: '/Decks/Personal Deck.pdf', namespace: HOME_NAMESPACE }],
    withApp: false,
  });
  t.after(() => stack.close());

  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '/Decks',
  });

  const result = await stack.container.health.testConnection({});

  assert.equal(result.ok, true, 'the existing connection still works');
  assert.equal(result.teamSpaceAvailable, true);
  assert.equal(result.teamSpaceEnabled, false);
  assert.match(result.hint, /Reconnect Dropbox/);
});

/* -------------------------------------------------------------- HTTP -- */

test('the admin surface reports the team space', async (t) => {
  const stack = await teamStack({
    files: [{ path: '/Company/Decks/Deck.pdf', namespace: TEAM_NAMESPACE }],
  });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  await http.login();
  const authUrl = await http.get('/api/dropbox/auth/url');
  const state = new URL(authUrl.body.url).searchParams.get('state');
  await http.get(`/api/dropbox/oauth/callback?code=auth-code-valid&state=${encodeURIComponent(state)}`);

  const status = await http.get('/api/dropbox/status');
  assert.equal(status.body.team_space, true);
  assert.equal(status.body.home_path, '/Avery Raman');

  const health = await http.get('/api/dropbox/health');
  assert.equal(health.body.teamSpace, true);

  // The namespace is account topology, not a credential — but check anyway
  // that nothing else came along with it.
  const text = JSON.stringify(status.body);
  assert.ok(!text.includes('refresh-token-valid'));

  const folders = await http.get('/api/dropbox/folders');
  assert.deepEqual(
    folders.body.entries.map((entry) => entry.name),
    ['company'],
    'the browser starts at the team space root'
  );
});

test('disconnecting clears the namespace so the next account starts clean', async (t) => {
  const stack = await teamStack({ files: [], withApp: false });
  t.after(() => stack.close());

  await connectViaOAuth(stack);
  assert.ok((await stack.container.connections.get('dropbox')).root_namespace_id);

  await stack.container.auth.revokeAccess({});

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.root_namespace_id, '');
  assert.equal(connection.home_namespace_id, '');
  assert.equal(connection.home_path, '');
  assert.equal(stack.container.auth.getPathRootHeader(), null);
});
