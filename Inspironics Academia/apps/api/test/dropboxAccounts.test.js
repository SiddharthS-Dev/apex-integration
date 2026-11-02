import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Two Dropbox apps: playbooks (default) and meetings. Each has its own credentials, redirect URI and
// stored connection; meetings fall back to the playbooks app when no meetings app is set up.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-dbx-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  DROPBOX_APP_KEY: 'pb-key', DROPBOX_APP_SECRET: 'pb-secret', DROPBOX_REDIRECT_URI: 'http://localhost:5173/academia/api/dropbox/oauth/callback',
  DROPBOX_MEETINGS_APP_KEY: 'mt-key', DROPBOX_MEETINGS_APP_SECRET: 'mt-secret',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString('base64'),
});
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { config } = await import('../src/config.js');
const conn = await import('../src/dropbox/connection.js');
const { authorizeUrl } = await import('../src/dropbox/oauth.js');

before(async () => { await migrate(await getDb()); });
after(async () => { await closeDb(); console.log = silence; fs.rmSync(dir, { recursive: true, force: true }); });

test('the meetings app has its own redirect URI, derived from the playbooks one', () => {
  assert.equal(config.dropbox.meetings.redirectUri, 'http://localhost:5173/academia/api/dropbox/meetings/oauth/callback');
  assert.equal(conn.meetingsAccount(), 'meetings');
});

test('authorize URLs carry each app\'s own key and redirect URI', async () => {
  const pb = new URL(authorizeUrl('s1'));
  const mt = new URL(await conn.withDropboxAccount('meetings', () => authorizeUrl('s2')));
  assert.deepEqual([pb.searchParams.get('client_id'), pb.searchParams.get('redirect_uri')], ['pb-key', config.dropbox.redirectUri]);
  assert.deepEqual([mt.searchParams.get('client_id'), mt.searchParams.get('redirect_uri')], ['mt-key', config.dropbox.meetings.redirectUri]);
});

test('connections are stored separately per app', async () => {
  const account = { account_id: 'dbid:1', email: 'meet@x.com', name: { display_name: 'Meetings' } };
  await conn.withDropboxAccount('meetings', () => conn.saveConnection({ refreshToken: 'r-meet', account, rootInfo: null, userId: 'u1' }));
  assert.equal(await conn.loadConnection(), null, 'the playbooks app is still not connected');
  const meet = await conn.withDropboxAccount('meetings', () => conn.loadConnection());
  assert.equal(meet.account_email, 'meet@x.com');
  await conn.withDropboxAccount('meetings', () => conn.deleteConnection());
  assert.equal(await conn.withDropboxAccount('meetings', () => conn.loadConnection()), null);
});

test('without a meetings app, meetings use the playbooks connection', () => {
  const saved = { ...config.dropbox.meetings };
  // config is frozen at the top level only; the nested meetings object can be adjusted for the test.
  config.dropbox.meetings.appKey = '';
  try {
    assert.equal(conn.meetingsAccount(), 'playbooks');
    assert.equal(conn.accountConfig('meetings').appKey, 'pb-key');
  } finally {
    config.dropbox.meetings.appKey = saved.appKey;
  }
});
