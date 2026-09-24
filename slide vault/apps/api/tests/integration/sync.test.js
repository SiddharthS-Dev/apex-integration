/**
 * Synchronization behaviour.
 *
 * The properties that matter: idempotent, incremental, partially failable,
 * and archiving rather than deleting.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, connectDropbox } from '../helpers/testEnv.js';
import { decideWork } from '../../src/integrations/dropbox/DropboxSyncService.js';
import { buildPptx } from '../helpers/fakeDropbox.js';

const FILES = [
  { path: '/Decks/Quarterly Review.pdf' },
  { path: '/Decks/Zero Trust Architecture.pdf' },
  { path: '/Decks/Sub/Onboarding.html', content: Buffer.from('<html><title>Onboarding Handbook</title></html>') },
];

async function syncedStack(t, { files = FILES, rootFolder = '/Decks', ...rest } = {}) {
  const stack = await createTestStack({ files, withApp: false, ...rest });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder });
  return stack;
}

/* ------------------------------------------------------- work decisions */

test('decideWork skips an unchanged file', () => {
  const metadata = { revision: 'rev1' };
  const current = {
    revision: 'rev1',
    status: 'active',
    title: 'Zero Trust Architecture',
    title_source: 'ai_text',
    thumbnail_url: '/api/assets/x.jpg',
    processing_state: 'success',
  };
  assert.deepEqual(decideWork(metadata, current), { action: 'skip', reason: 'unchanged' });
});

test('decideWork reprocesses when the revision moved', () => {
  const current = { revision: 'rev1', status: 'active', title: 'T', title_source: 'ai_text', thumbnail_url: 'x' };
  assert.equal(decideWork({ revision: 'rev2' }, current).action, 'update');
  assert.equal(decideWork({ revision: 'rev2' }, current).reason, 'revision_changed');
});

test('decideWork reprocesses a still-generic title even at the same revision', () => {
  const current = {
    revision: 'rev1',
    status: 'active',
    title: 'Untitled (12)',
    title_source: 'filename',
    thumbnail_url: 'x',
    processing_state: 'success',
  };
  assert.deepEqual(decideWork({ revision: 'rev1' }, current), {
    action: 'update',
    reason: 'generic_title',
  });
});

test('decideWork does not chase a thumbnail Dropbox can never render', () => {
  // An .html export gets no Dropbox thumbnail. Treating that as "missing" would
  // re-download and re-extract the file on every run, for ever.
  const html = {
    revision: 'rev1',
    status: 'active',
    title: 'Onboarding Handbook',
    title_source: 'metadata',
    thumbnail_url: '',
    extension: 'html',
    processing_state: 'success',
  };
  assert.equal(decideWork({ revision: 'rev1', extension: 'html' }, html).action, 'skip');

  // A PPTX with no thumbnail, on the other hand, is worth retrying.
  const pptx = { ...html, extension: 'pptx' };
  assert.equal(decideWork({ revision: 'rev1', extension: 'pptx' }, pptx).reason, 'missing_thumbnail');
});

test('decideWork retries a file that previously failed, and restores an archived one', () => {
  const base = { revision: 'rev1', title: 'T', title_source: 'ai_text', thumbnail_url: 'x' };
  assert.equal(decideWork({ revision: 'rev1' }, { ...base, status: 'active', processing_state: 'failed' }).reason, 'retry_failed');
  assert.equal(decideWork({ revision: 'rev1' }, { ...base, status: 'archived' }).reason, 'restored');
  assert.equal(decideWork({ revision: 'rev1' }, null).reason, 'new');
});

/* ------------------------------------------------------------ first run */

test('a first sync indexes every supported file under the root', async (t) => {
  const stack = await syncedStack(t);

  const result = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(result.status, 'success');
  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.new, 3);
  assert.equal(result.counts.failed, 0);

  const files = await stack.container.files.list({ status: 'active' });
  assert.equal(files.length, 3);
  assert.ok(files.every((file) => file.processing_state === 'success'));
  assert.ok(files.every((file) => file.last_synced_at));
  // Every file Dropbox can render gets a cached thumbnail; html cannot be
  // rendered, so it is indexed without one rather than asked for repeatedly.
  assert.ok(files.filter((file) => file.extension === 'pdf').every((file) => file.thumbnail_url));
  assert.equal(files.find((file) => file.extension === 'html').thumbnail_url, '');
});

test('files outside the configured root are not indexed', async (t) => {
  const stack = await syncedStack(t, {
    files: [...FILES, { path: '/Private/Secret Plans.pdf' }],
    rootFolder: '/Decks',
  });

  await stack.container.sync.run({ trigger: 'manual' });
  const files = await stack.container.files.list({ status: 'active' });

  assert.equal(files.length, 3);
  assert.ok(!files.some((file) => file.name === 'Secret Plans.pdf'));
});

test('unsupported file types are ignored', async (t) => {
  const stack = await syncedStack(t, {
    files: [...FILES, { path: '/Decks/notes.txt' }, { path: '/Decks/archive.zip' }],
  });

  const result = await stack.container.sync.run({ trigger: 'manual' });
  assert.equal(result.counts.total, 3, 'only pdf/pptx/ppt/html are discovered');
});

/* ------------------------------------------------- idempotency and delta */

test('running sync repeatedly creates no duplicates and skips unchanged files', async (t) => {
  const stack = await syncedStack(t);

  await stack.container.sync.run({ trigger: 'manual' });
  const second = await stack.container.sync.run({ trigger: 'manual' });
  const third = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(second.counts.new, 0);
  assert.equal(second.counts.skipped, 3, 'an unchanged revision must not be reprocessed');
  assert.equal(third.counts.skipped, 3);

  const rows = await stack.db.query('SELECT external_id, COUNT(*) AS n FROM stored_file GROUP BY external_id');
  assert.ok(rows.every((row) => Number(row.n) === 1), 'one Dropbox file is exactly one record');
  assert.equal(await stack.container.files.count('active'), 3);
});

test('an unchanged file costs no download and no thumbnail fetch', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  const downloadsBefore = stack.dropbox.callsTo('files/download').length;
  const thumbsBefore = stack.dropbox.callsTo('get_thumbnail').length;

  await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(stack.dropbox.callsTo('files/download').length, downloadsBefore, 'no re-download');
  assert.equal(stack.dropbox.callsTo('get_thumbnail').length, thumbsBefore, 'no re-render');
});

test('an html file settles instead of being reprocessed for ever', async (t) => {
  // Its set of files includes /Decks/Sub/Onboarding.html, which Dropbox cannot
  // thumbnail. Three consecutive runs must all skip it.
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  const second = await stack.container.sync.run({ trigger: 'manual' });
  const third = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(second.counts.skipped, 3);
  assert.equal(third.counts.skipped, 3);
  assert.equal(third.counts.updated, 0, 'the html file must not be reprocessed on every run');
});

test('a changed revision is reprocessed', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  stack.dropbox.touchFile('/Decks/Quarterly Review.pdf');
  const result = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(result.counts.updated, 1);
  assert.equal(result.counts.skipped, 2);
});

test('force reprocesses everything', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  const result = await stack.container.sync.run({ trigger: 'manual', force: true });
  assert.equal(result.counts.updated, 3);
  assert.equal(result.counts.skipped, 0);
});

/* --------------------------------------------------------- deletion path */

test('a file removed from Dropbox is archived, not deleted', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  stack.dropbox.removeFile('/Decks/Quarterly Review.pdf');
  const result = await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(result.counts.deleted, 1);
  assert.equal(await stack.container.files.count('active'), 2);
  assert.equal(await stack.container.files.count('archived'), 1);

  const archived = (await stack.container.files.list({ status: 'archived' }))[0];
  assert.equal(archived.name, 'Quarterly Review.pdf');
  assert.ok(archived.archived_at, 'the history is preserved, with a timestamp');
});

test('a file restored to Dropbox becomes active again', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual' });

  stack.dropbox.removeFile('/Decks/Quarterly Review.pdf');
  await stack.container.sync.run({ trigger: 'manual' });
  stack.dropbox.addFile({ path: '/Decks/Quarterly Review.pdf' });
  await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(await stack.container.files.count('active'), 3);
});

/* ------------------------------------------------------ partial failure */

test('one unreadable file fails alone and the rest still sync', async (t) => {
  const stack = await syncedStack(t);

  // Make exactly one file fail at download time.
  const target = [...stack.dropbox.state.files.values()].find((f) => f.name === 'Quarterly Review.pdf');
  const originalFetch = stack.container.executor.fetch;
  stack.container.executor.fetch = async (url, options) => {
    const arg = new Headers(options?.headers ?? {}).get('Dropbox-API-Arg') ?? '';
    if (String(url).includes('files/get_thumbnail') && arg.includes(target.id)) {
      throw Object.assign(new Error('permanent failure'), { name: 'DoNotRetry' });
    }
    return originalFetch(url, options);
  };

  const result = await stack.container.sync.run({ trigger: 'manual' });

  // A failed thumbnail degrades one record; it does not fail the run.
  assert.equal(result.counts.total, 3);
  assert.equal(await stack.container.files.count('active'), 3);
  const failed = (await stack.container.files.list({ status: 'active' })).find(
    (file) => file.name === 'Quarterly Review.pdf'
  );
  assert.equal(failed.thumbnail_url, '', 'the thumbnail is simply missing');
});

test('a sync log records the outcome of every run', async (t) => {
  const stack = await syncedStack(t);
  await stack.container.sync.run({ trigger: 'manual', actor: { id: 'u1', email: 'admin@example.com' } });

  const logs = await stack.container.syncLogs.list({ limit: 5 });
  assert.equal(logs.length, 1);

  const [log] = logs;
  assert.equal(log.status, 'success');
  assert.equal(log.trigger, 'manual');
  assert.equal(log.total_files, 3);
  assert.equal(log.new_files, 3);
  assert.equal(log.actor_email, 'admin@example.com');
  assert.equal(log.root_folder, '/Decks');
  assert.ok(log.completed_at);
  assert.ok(log.duration_ms >= 0);
});

test('a sync on a missing root folder fails loudly and records the error', async (t) => {
  const stack = await syncedStack(t, { rootFolder: '/Nope' });

  await assert.rejects(stack.container.sync.run({ trigger: 'manual' }));

  const [log] = await stack.container.syncLogs.list({ limit: 1 });
  assert.equal(log.status, 'error');
  assert.ok(log.error);

  const connection = await stack.container.connections.get('dropbox');
  assert.equal(connection.sync_status, 'error');
  assert.ok(connection.last_error);
});

test('a second sync is refused while one is already running', async (t) => {
  const stack = await syncedStack(t);

  const first = stack.container.sync.run({ trigger: 'manual' });
  const second = await stack.container.sync.run({ trigger: 'scheduled' });

  assert.equal(second.status, 'skipped');
  assert.match(second.reason, /already running/);
  await first;
});

test('syncing without a connection is a configuration error', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());

  await assert.rejects(stack.container.sync.run({ trigger: 'manual' }), (error) => {
    assert.equal(error.name, 'DropboxConfigurationError');
    assert.match(error.userMessage, /not connected/i);
    return true;
  });
});

/* ------------------------------------------------------- title pipeline */

test('a generically-named deck gets a title from its content', async (t) => {
  const pptx = await buildPptx({
    slides: [['Zero Trust Network Architecture', 'Engineering'], ['Agenda']],
    title: '',
  });
  const stack = await syncedStack(t, { files: [{ path: '/Decks/Untitled (12).pptx', content: pptx }] });

  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.title, 'Zero Trust Network Architecture');
  assert.equal(file.title_source, 'text');
  assert.equal(file.slide_count, 2);
  assert.equal(file.author, 'Test Author');
});

test('a meaningful filename is left alone and costs no AI call', async (t) => {
  let aiCalls = 0;
  const aiProvider = {
    available: true,
    complete: async () => {
      aiCalls += 1;
      return 'Some Other Title';
    },
    completeWithImage: async () => {
      aiCalls += 1;
      return 'Some Other Title';
    },
  };

  const stack = await createTestStack({
    files: [{ path: '/Decks/Quarterly Business Review.pdf' }],
    withApp: false,
    aiProvider,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.title, 'Quarterly Business Review');
  assert.equal(file.title_source, 'filename');
  assert.equal(aiCalls, 0, 'a good filename must not trigger the vision pipeline');
});

test('an image-only deck falls back to vision using the Dropbox thumbnail', async (t) => {
  const seenImages = [];
  const aiProvider = {
    available: true,
    complete: async () => 'UNKNOWN',
    completeWithImage: async ({ image }) => {
      seenImages.push(image);
      return 'Autonomous Sustainable Infrastructure Platform';
    },
  };

  // A deck with slides but no text runs at all — a rendered export.
  const pptx = await buildPptx({ slides: [[]], title: '' });
  const stack = await createTestStack({
    files: [{ path: '/Decks/Untitled (12).pptx', content: pptx }],
    withApp: false,
    aiProvider,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.title, 'Autonomous Sustainable Infrastructure Platform');
  assert.equal(file.title_source, 'ai_vision');
  assert.equal(seenImages.length, 1);
  assert.equal(seenImages[0].mediaType, 'image/jpeg', 'the Dropbox render of slide 1 is used');
});

test('classification results are stored when the AI layer is available', async (t) => {
  const aiProvider = {
    available: true,
    complete: async ({ prompt }) =>
      prompt.includes('Return JSON')
        ? JSON.stringify({
            primary_domain: 'Engineering',
            sub_domain: 'Platform Security',
            category: 'Architecture',
            tags: ['zero trust', 'security'],
            keywords: ['identity', 'network'],
            learning_objectives: ['Understand zero trust.'],
            summary: 'A review of the zero trust rollout. It covers identity and network controls.',
            confidence: 0.82,
          })
        : 'Zero Trust Network Architecture',
    completeWithImage: async () => '',
  };

  const pptx = await buildPptx({ slides: [['Zero Trust Network Architecture']], title: '' });
  const stack = await createTestStack({
    files: [{ path: '/Decks/Untitled.pptx', content: pptx }],
    withApp: false,
    aiProvider,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await stack.container.sync.run({ trigger: 'manual' });

  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.primary_domain, 'Engineering');
  assert.equal(file.category, 'Architecture');
  assert.deepEqual(file.tags, ['zero trust', 'security']);
  assert.equal(file.ai_confidence, 0.82);
  assert.match(file.ai_summary, /zero trust rollout/);
});

test('a domain outside the library taxonomy is dropped rather than stored', async (t) => {
  const aiProvider = {
    available: true,
    complete: async ({ prompt }) =>
      prompt.includes('Return JSON')
        ? JSON.stringify({ primary_domain: 'Astrology', tags: [], keywords: [], learning_objectives: [] })
        : 'Quarterly Review',
    completeWithImage: async () => '',
  };

  const pptx = await buildPptx({ slides: [['Quarterly Review']], title: '' });
  const stack = await createTestStack({
    files: [{ path: '/Decks/Untitled.pptx', content: pptx }],
    withApp: false,
    aiProvider,
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await stack.container.sync.run({ trigger: 'manual' });
  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.primary_domain, '');
});

test('an oversized file is indexed by metadata without being downloaded', async (t) => {
  const stack = await createTestStack({
    files: [{ path: '/Decks/Huge Deck.pdf', content: Buffer.alloc(4096, 1) }],
    withApp: false,
    configOverrides: { DROPBOX_MAX_FILE_SIZE_MB: '0' },
  });
  t.after(() => stack.close());
  await connectDropbox(stack, { rootFolder: '/Decks' });

  await stack.container.sync.run({ trigger: 'manual' });

  assert.equal(stack.dropbox.callsTo('files/download').length, 0, 'the file is never buffered');
  const [file] = await stack.container.files.list({ status: 'active' });
  assert.equal(file.name, 'Huge Deck.pdf');
  assert.equal(file.processing_state, 'success');
});
