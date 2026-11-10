import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ObjectStore } from '../../src/services/storage/ObjectStore.js';
import { SyncScheduler } from '../../src/services/scheduler/SyncScheduler.js';

test('ObjectStore.putBuffer leaves no partial .tmp file when the write fails', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-objects-'));
  try {
    const store = new ObjectStore({ dir });
    // The target exists as a directory, so the final rename cannot replace it.
    fs.mkdirSync(path.join(dir, 'thumb-x.jpg'));
    await assert.rejects(store.putBuffer('thumb-x.jpg', Buffer.from('bytes')));
    assert.deepEqual(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp')), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the daily retention sweep is scheduled even when scheduled sync is disabled', () => {
  const realSetInterval = globalThis.setInterval;
  const intervals = [];
  globalThis.setInterval = (fn, ms) => {
    intervals.push(ms);
    return { unref() {} };
  };
  try {
    const scheduler = new SyncScheduler({
      config: { sync: { enabled: false, intervalMinutes: 30 } },
      sync: {},
      connections: {},
      retention: async () => ({}),
    });
    scheduler.start();
    assert.deepEqual(intervals, [24 * 3600_000]);
    scheduler.start(); // idempotent: no second retention timer
    assert.equal(intervals.length, 1);
  } finally {
    globalThis.setInterval = realSetInterval;
  }
});
