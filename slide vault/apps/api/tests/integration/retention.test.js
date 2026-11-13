/**
 * The daily retention sweep, end to end.
 *
 * The scheduling of the sweep is covered in unit/storage.test.js; these check
 * that the sweep the container wires up actually deletes what is past its
 * lifetime — sync logs after 90 days, audit rows after 365, expired OAuth state
 * and sessions, cached previews after 14 days — and leaves everything fresher
 * alone.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

import { createTestStack } from '../helpers/testEnv.js';
import { SyncScheduler } from '../../src/services/scheduler/SyncScheduler.js';

const DAY = 24 * 3600_000;
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const ahead = (ms) => new Date(Date.now() + ms).toISOString();
const id = () => crypto.randomUUID();

/** Seeds one stale and one fresh row of everything the sweep is responsible for. */
async function seed(stack) {
  const { db, container } = stack;

  for (const [rowId, startedAt] of [
    ['sync-stale', ago(91 * DAY)],
    ['sync-fresh', ago(89 * DAY)],
  ]) {
    await db.execute('INSERT INTO sync_log (id, started_at, status, created_at) VALUES (?, ?, ?, ?)', [rowId, startedAt, 'success', startedAt]);
  }

  for (const [rowId, createdAt] of [
    ['audit-stale', ago(366 * DAY)],
    ['audit-fresh', ago(364 * DAY)],
  ]) {
    await db.execute('INSERT INTO audit_log (id, action, created_at) VALUES (?, ?, ?)', [
      rowId,
      'test.retention',
      createdAt,
    ]);
  }

  for (const [rowId, expiresAt] of [
    ['state-stale', ago(60_000)],
    ['state-fresh', ahead(10 * 60_000)],
  ]) {
    await db.execute('INSERT INTO oauth_state (id, state_hash, expires_at, created_at) VALUES (?, ?, ?, ?)', [
      rowId,
      id(),
      expiresAt,
      ago(DAY),
    ]);
  }
  for (const [hash, createdAt] of [
    ['code-stale', ago(2 * DAY)],
    ['code-fresh', ago(3600_000)],
  ]) {
    await db.execute('INSERT INTO oauth_code_exchange (code_hash, created_at) VALUES (?, ?)', [hash, createdAt]);
  }

  for (const [rowId, expiresAt] of [
    ['session-stale', ago(60_000)],
    ['session-fresh', ahead(DAY)],
  ]) {
    await db.execute(
      'INSERT INTO user_session (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)',
      [rowId, 'user-1', id(), expiresAt, ago(DAY)]
    );
  }

  // Cached previews: aged by setting both atime and mtime, since the sweep keeps
  // anything read recently even if it was written long ago.
  const store = container.objectStore;
  await store.putBuffer('preview-stale.pdf', Buffer.from('%PDF stale'));
  await store.putBuffer('preview-fresh.pdf', Buffer.from('%PDF fresh'));
  const old = new Date(Date.now() - 15 * DAY);
  const recent = new Date(Date.now() - 13 * DAY);
  fs.utimesSync(store.pathFor('preview-stale.pdf'), old, old);
  fs.utimesSync(store.pathFor('preview-fresh.pdf'), recent, recent);
}

async function ids(db, table, column = 'id') {
  return (await db.query(`SELECT ${column} AS id FROM ${table} ORDER BY ${column}`)).map((r) => r.id);
}

async function assertSwept(stack) {
  const { db, container } = stack;
  assert.deepEqual(await ids(db, 'sync_log'), ['sync-fresh'], 'sync logs older than 90 days are purged');
  assert.deepEqual(await ids(db, 'audit_log'), ['audit-fresh'], 'audit rows older than 365 days are purged');
  assert.deepEqual(await ids(db, 'oauth_state'), ['state-fresh'], 'expired OAuth state is purged');
  assert.deepEqual(
    await ids(db, 'oauth_code_exchange', 'code_hash'),
    ['code-fresh'],
    'code-exchange records older than a day are purged'
  );
  assert.deepEqual(await ids(db, 'user_session'), ['session-fresh'], 'expired sessions are purged');

  const cached = fs.readdirSync(container.objectStore.dir).filter((name) => name.startsWith('preview-'));
  assert.deepEqual(cached, ['preview-fresh.pdf'], 'previews untouched for 14 days are purged');
}

test('the retention sweep deletes expired rows and stale previews and keeps fresher ones', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  assert.equal(stack.config.retention.syncLogDays, 90);
  assert.equal(stack.config.retention.auditLogDays, 365);
  assert.equal(stack.config.objectStore.ttlHours, 14 * 24);

  await seed(stack);
  const results = await stack.container.retention();

  assert.equal(results.syncLogs, 1);
  assert.equal(results.auditLogs, 1);
  assert.deepEqual(results.oauth, { states: 1, codes: 1 });
  assert.equal(results.sessions, 1);
  assert.equal(results.cachedObjects, 1);
  await assertSwept(stack);

  // A second sweep finds nothing more to do.
  const again = await stack.container.retention();
  assert.equal(again.syncLogs + again.auditLogs + again.sessions + again.cachedObjects, 0);
});

test('the scheduler’s daily timer runs the real sweep', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  await seed(stack);

  let resolveSwept;
  const swept = new Promise((resolve) => {
    resolveSwept = resolve;
  });
  const scheduler = new SyncScheduler({
    config: stack.config, // DROPBOX_SYNC_ENABLED=false: only the retention timer is set
    sync: {},
    connections: {},
    retention: () => stack.container.retention().then(resolveSwept),
  });

  t.mock.timers.enable({ apis: ['setInterval'] });
  scheduler.start();
  t.after(() => scheduler.stop());

  // Nothing happens before a day has passed...
  t.mock.timers.tick(DAY - 1000);
  assert.deepEqual(await ids(stack.db, 'sync_log'), ['sync-fresh', 'sync-stale']);

  // ...and at the day mark the sweep runs against the real database.
  t.mock.timers.tick(1000);
  await swept;
  await assertSwept(stack);
});

test('a cached preview read recently survives even if it was written long ago', async (t) => {
  const stack = await createTestStack({ withApp: false });
  t.after(() => stack.close());
  const store = stack.container.objectStore;
  await store.putBuffer('preview-read.pdf', Buffer.from('%PDF'));
  const written = new Date(Date.now() - 30 * DAY);
  const read = new Date(Date.now() - DAY);
  fs.utimesSync(path.join(store.dir, 'preview-read.pdf'), read, written);

  await stack.container.retention();
  assert.ok(fs.existsSync(store.pathFor('preview-read.pdf')));
});
