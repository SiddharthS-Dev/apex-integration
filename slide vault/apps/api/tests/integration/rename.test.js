/**
 * Rename, folder selection, content delivery and health.
 *
 * Rename is the only path that writes to someone's Dropbox, so the dry run and
 * the collision handling are the tests that matter most here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, connectDropbox } from '../helpers/testEnv.js';
import { buildPptx } from '../helpers/fakeDropbox.js';
import { deriveStatus } from '../../src/integrations/dropbox/DropboxHealthService.js';
import { buildBreadcrumbs } from '../../src/integrations/dropbox/DropboxFolderService.js';

const titleAi = (title) => ({
  available: true,
  complete: async () => title,
  completeWithImage: async () => title,
});

async function stackWithUntitled(t, { files, aiProvider } = {}) {
  const pptx = await buildPptx({ slides: [['Autonomous Infrastructure Platform']], title: '' });
  const stack = await createTestStack({
    files: files ?? [{ path: '/Decks/Untitled (12).pptx', content: pptx }],
    withApp: false,
    aiProvider,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });
  await stack.container.sync.run({ trigger: 'manual' });
  return stack;
}

/* ----------------------------------------------------------- dry run --- */

test('rename defaults to a dry run and changes nothing in Dropbox', async (t) => {
  const stack = await stackWithUntitled(t);

  const result = await stack.container.rename.renameUntitled({ actor: { id: 'u', email: 'a@b.c' } });

  assert.equal(result.dryRun, true);
  assert.equal(result.examined, 1);

  const [proposal] = result.proposals;
  assert.equal(proposal.currentName, 'Untitled (12).pptx');
  assert.equal(proposal.proposedName, 'Autonomous Infrastructure Platform.pptx');

  // Dropbox itself is untouched.
  assert.ok(stack.dropbox.hasFile('/Decks/Untitled (12).pptx'));
  assert.equal(stack.dropbox.callsTo('move_v2').length, 0);
});

test('an omitted dryRun flag still means dry run', async (t) => {
  const stack = await stackWithUntitled(t);
  const result = await stack.container.rename.renameUntitled({});
  assert.equal(result.dryRun, true);
  assert.equal(stack.dropbox.callsTo('move_v2').length, 0);
});

test('applying the rename moves the file and updates the record', async (t) => {
  const stack = await stackWithUntitled(t);

  const result = await stack.container.rename.renameUntitled({
    dryRun: false,
    actor: { id: 'u', email: 'admin@example.com' },
  });

  assert.equal(result.renamed, 1);
  assert.equal(result.failed, 0);

  assert.ok(stack.dropbox.hasFile('/Decks/Autonomous Infrastructure Platform.pptx'));
  assert.ok(!stack.dropbox.hasFile('/Decks/Untitled (12).pptx'));

  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.name, 'Autonomous Infrastructure Platform.pptx');
  assert.equal(file.title, 'Autonomous Infrastructure Platform');

  const events = await stack.container.audit.list({ limit: 10 });
  const renameEvent = events.find((event) => event.action === 'file.renamed');
  assert.ok(renameEvent, 'the rename is audited');
  assert.equal(renameEvent.details.to, 'Autonomous Infrastructure Platform.pptx');
});

test('a name collision gets a deterministic suffix, never an overwrite', async (t) => {
  const pptx = await buildPptx({ slides: [['Autonomous Infrastructure Platform']], title: '' });
  const stack = await stackWithUntitled(t, {
    files: [
      { path: '/Decks/Untitled (12).pptx', content: pptx },
      // The target name is already taken by a different file.
      { path: '/Decks/Autonomous Infrastructure Platform.pptx', content: Buffer.from('other deck') },
    ],
  });

  const result = await stack.container.rename.renameUntitled({ dryRun: false });

  assert.equal(result.renamed, 1);
  const renamed = result.proposals.find((proposal) => proposal.renamed);
  assert.equal(renamed.finalName, 'Autonomous Infrastructure Platform (1).pptx');

  // The pre-existing file still has its original content.
  const original = stack.dropbox.fileAt('/Decks/Autonomous Infrastructure Platform.pptx');
  assert.equal(original.content.toString(), 'other deck');
});

test('a file whose title cannot be derived keeps its name', async (t) => {
  const stack = await stackWithUntitled(t, {
    files: [{ path: '/Decks/Untitled (99).pdf', content: Buffer.from('%PDF-1.4 no metadata') }],
    aiProvider: titleAi('Untitled'),
  });

  const result = await stack.container.rename.renameUntitled({ dryRun: false });

  const [proposal] = result.proposals;
  assert.equal(proposal.proposedName, null);
  assert.match(proposal.reason, /original filename is kept/);
  assert.ok(stack.dropbox.hasFile('/Decks/Untitled (99).pdf'));
});

test('renaming a single file rejects a title that fails validation', async (t) => {
  const stack = await stackWithUntitled(t);
  const [file] = await stack.container.files.list({ status: 'active' });

  await assert.rejects(stack.container.rename.renameOne(file.id, 'Untitled'), /rejected \(generic\)/);
  await assert.rejects(stack.container.rename.renameOne(file.id, 'ab'), /rejected \(too_short\)/);
});

test('rename can be disabled for a deployment', async (t) => {
  const pptx = await buildPptx({ slides: [['Anything']], title: '' });
  const stack = await createTestStack({
    files: [{ path: '/Decks/Untitled.pptx', content: pptx }],
    withApp: false,
    configOverrides: { DROPBOX_ALLOW_RENAME: 'false' },
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await assert.rejects(stack.container.rename.renameUntitled({ dryRun: false }), /disabled/);
});

/* ----------------------------------------------------------- folders --- */

test('the folder browser lists only folders, with breadcrumbs', async (t) => {
  const stack = await createTestStack({
    files: [
      { path: '/Engineering/Decks/a.pdf' },
      { path: '/Engineering/Notes/b.pdf' },
      { path: '/Finance/c.pdf' },
    ],
    withApp: false,
  });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const root = await stack.container.folders.browse('');
  assert.deepEqual(
    root.entries.map((entry) => entry.name).sort(),
    ['engineering', 'finance']
  );

  const nested = await stack.container.folders.browse('/Engineering');
  assert.deepEqual(nested.entries.map((entry) => entry.name).sort(), ['decks', 'notes']);
  assert.deepEqual(nested.breadcrumbs, [{ name: 'Engineering', path: '/Engineering' }]);
  assert.equal(nested.parent, '');
});

test('buildBreadcrumbs walks each level of a path', () => {
  assert.deepEqual(buildBreadcrumbs('/A/B/C'), [
    { name: 'A', path: '/A' },
    { name: 'B', path: '/A/B' },
    { name: 'C', path: '/A/B/C' },
  ]);
  assert.deepEqual(buildBreadcrumbs(''), []);
});

test('selecting a folder verifies it exists first', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Engineering/Decks/a.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const connection = await stack.container.folders.setRootFolder('/Engineering/Decks', {
    actor: { id: 'u', email: 'a@b.c' },
  });
  assert.equal(connection.root_folder, '/Engineering/Decks');

  await assert.rejects(stack.container.folders.setRootFolder('/Nope'), /does not exist/);

  // The bad value must not have been stored.
  assert.equal((await stack.container.connections.get('dropbox')).root_folder, '/Engineering/Decks');
});

test('a folder path is normalized before it is stored', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Engineering/Decks/a.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const connection = await stack.container.folders.setRootFolder(' Engineering / Decks / ');
  assert.equal(connection.root_folder, '/Engineering/Decks');
});

/* ----------------------------------------------------------- content --- */

test('a PPTX preview is rendered once and then served from cache', async (t) => {
  const pptx = await buildPptx({ slides: [['Quarterly Review']], title: 'Quarterly Review' });
  const stack = await createTestStack({
    files: [{ path: '/Decks/Quarterly Review.pptx', content: pptx }],
    withApp: false,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });
  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });

  const first = await stack.container.content.resolvePreview(file.id);
  assert.equal(first.kind, 'cached');
  assert.equal(first.contentType, 'application/pdf');
  assert.equal(stack.dropbox.callsTo('get_preview').length, 1);

  const second = await stack.container.content.resolvePreview(file.id);
  assert.equal(second.url, first.url);
  assert.equal(stack.dropbox.callsTo('get_preview').length, 1, 'the second view is free');
});

test('a PDF is proxied rather than converted', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });
  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });
  const preview = await stack.container.content.resolvePreview(file.id);

  assert.equal(preview.kind, 'stream');
  assert.equal(preview.streamUrl, `/api/dropbox/files/${file.id}/content`);
  assert.ok(!JSON.stringify(preview).includes('dropboxusercontent'), 'no Dropbox URL reaches the client');
});

test('an admin download link is minted only for an admin, and is audited', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });
  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });

  await assert.rejects(
    stack.container.adminDownload.createLink(file.id, { id: 'u', email: 'user@x.com', role: 'user' }),
    /Administrator role required/
  );

  const link = await stack.container.adminDownload.createLink(file.id, {
    id: 'a',
    email: 'admin@example.com',
    role: 'admin',
  });
  assert.match(link.url, /^https:\/\//);

  const events = await stack.container.audit.list({ limit: 10 });
  const event = events.find((e) => e.action === 'file.download_link_generated');
  assert.ok(event);
  assert.ok(!JSON.stringify(event.details).includes('dropboxusercontent'), 'the link itself is not logged');
});

/* ------------------------------------------------------------ health --- */

test('health reports local state without calling Dropbox', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  const callsBefore = stack.dropbox.state.calls.length;
  const health = await stack.container.health.health();

  assert.equal(stack.dropbox.state.calls.length, callsBefore, 'health must not generate Dropbox traffic');
  assert.equal(health.connected, true);
  assert.equal(health.rootFolder, '/Decks');
  assert.ok(!JSON.stringify(health).includes('refresh-token-valid'));
});

test('testConnection separates authentication from folder access', async (t) => {
  const stack = await createTestStack({ files: [{ path: '/Decks/Report.pdf' }], withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  const good = await stack.container.health.testConnection({ actor: { id: 'u', email: 'a@b.c' } });
  assert.equal(good.ok, true);
  assert.equal(good.authenticated, true);
  assert.equal(good.folderAccessible, true);
  assert.equal(good.accountEmail, 'avery.raman@inspironics.net');

  await stack.container.connections.update('dropbox', { root_folder: '/Deleted Folder' });
  const bad = await stack.container.health.testConnection({});
  assert.equal(bad.ok, false);
  assert.equal(bad.authenticated, true, 'the credential is still fine');
  assert.equal(bad.folderAccessible, false);
  assert.match(bad.error.message, /does not exist/);
});

test('deriveStatus reflects the operational state', () => {
  const sync = { enabled: true, intervalMinutes: 30 };
  const connected = { connection_status: 'connected', last_error: '', last_sync_at: new Date().toISOString() };

  assert.equal(deriveStatus({ configured: false, connection: connected, lastSync: null, sync }), 'unconfigured');
  assert.equal(deriveStatus({ configured: true, connection: connected, lastSync: null, sync }), 'healthy');
  assert.equal(
    deriveStatus({
      configured: true,
      connection: { ...connected, connection_status: 'disconnected' },
      lastSync: null,
      sync,
    }),
    'disconnected'
  );
  assert.equal(
    deriveStatus({ configured: true, connection: { ...connected, last_error: 'boom' }, lastSync: null, sync }),
    'warning'
  );
  // Three missed intervals is a warning, not an error: the connection works,
  // but something is stopping the scheduler.
  assert.equal(
    deriveStatus({
      configured: true,
      connection: { ...connected, last_sync_at: new Date(Date.now() - 4 * 3600_000).toISOString() },
      lastSync: null,
      sync,
    }),
    'warning'
  );
});
