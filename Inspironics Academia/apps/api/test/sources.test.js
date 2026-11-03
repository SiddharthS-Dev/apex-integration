import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Category sources: a playbook category with a Dropbox folder (and app) of its own — e.g. Learning &
// Development synced from the interns' folder through its own Dropbox app.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-sources-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  AUTO_EXTRACT_ON_SYNC: 'false',
  DROPBOX_APP_KEY: 'main-key', DROPBOX_APP_SECRET: 'main-secret', DROPBOX_REDIRECT_URI: 'http://localhost:5173/academia/api/dropbox/oauth/callback',
  DROPBOX_LEARNING_APP_KEY: 'learn-key', DROPBOX_LEARNING_APP_SECRET: 'learn-secret',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
});
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { config } = await import('../src/config.js');
const conn = await import('../src/dropbox/connection.js');
const { authorizeUrl } = await import('../src/dropbox/oauth.js');
const { syncPlaybookFolder } = await import('../src/sync/pipeline.js');
const { putObject } = await import('../src/files/objectStore.js');
const { dropboxSourceKey } = await import('../src/files/playbookSource.js');
const { entities } = await import('../src/repo/entities.js');
const { createApp } = await import('../src/app.js');

let server;
let base;
let cookie = '';
const call = async (method, url, body) => {
  const res = await fetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, location: res.headers.get('location') };
};

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
});

after(async () => {
  server?.close();
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('each category source has its own redirect URI; one with keys gets its own app and connection', async () => {
  assert.equal(config.dropbox.sources.learning.redirectUri, 'http://localhost:5173/academia/api/dropbox/sources/learning/oauth/callback');
  assert.equal(conn.sourceAccount('learning'), 'source:learning');
  assert.equal(conn.sourceAccount('strategic'), 'playbooks', 'no keys: read through the main app');

  const url = new URL(await conn.withDropboxAccount('source:learning', () => authorizeUrl('s')));
  assert.equal(url.searchParams.get('client_id'), 'learn-key');
  assert.equal(url.searchParams.get('redirect_uri'), config.dropbox.sources.learning.redirectUri);

  const account = { account_id: 'dbid:9', email: 'interns@x.com', name: { display_name: 'Interns' } };
  await conn.withDropboxAccount('source:learning', () => conn.saveConnection({ refreshToken: 'r', account, rootInfo: null, userId: 'u' }));
  assert.equal(await conn.loadConnection(), null, 'the main playbooks app is separate');
  assert.equal((await conn.withDropboxAccount('source:learning', () => conn.loadConnection())).account_email, 'interns@x.com');
});

test('a source folder creates playbooks in its category, keeps manual choices, archives only its own', async () => {
  const file = (id, name, rev = '1') => ({ id, name, path_display: `/Interns/${name}`, path_lower: `/interns/${name.toLowerCase()}`, rev, size: 10 });
  const files = [file('id:a', 'Python Basics.pdf'), file('id:b', 'Git 101.docx')];
  for (const f of files) await putObject(dropboxSourceKey(f.id, f.rev), Buffer.from('%PDF-1.4'), { source: 'dropbox' });
  const run = (list, stored) => {
    const counts = { discovered: 0, added: 0, updated: 0, unchanged: 0, archived: 0, failed: 0 };
    return syncPlaybookFolder({ files: list, stored, category: 'learning', source: 'learning', seenAt: new Date().toISOString(), counts, errors: [], fail: () => { counts.failed++; } })
      .then(() => counts);
  };
  const mainPlaybook = await entities.Playbook.create({ title: 'Engineering Standards', file_url: 'dropbox:id:main', source: 'dropbox', external_id: 'id:main', revision: '1', category: 'corporate' });

  const first = await run(files, []);
  assert.equal(first.added, 2);
  const mine = await entities.Playbook.filter({ dropbox_source: 'learning' });
  assert.deepEqual(mine.map((p) => [p.category, p.category_source]), [['learning', 'default'], ['learning', 'default']]);

  // An admin moves one; a new revision of it must not move it back.
  const git = mine.find((p) => p.external_id === 'id:b');
  await entities.Playbook.update(git.id, { category: 'strategic', category_source: 'manual' });
  const changed = [files[0], file('id:b', 'Git 101.docx', '2')];
  await putObject(dropboxSourceKey('id:b', '2'), Buffer.from('%PDF-1.4'), { source: 'dropbox' });
  const second = await run(changed, await entities.Playbook.filter({ dropbox_source: 'learning' }));
  assert.equal(second.updated, 1);
  assert.equal((await entities.Playbook.get(git.id)).category, 'strategic');

  // A file removed from the interns' folder is archived; the main folder's playbooks are not touched.
  const third = await run([files[0]], await entities.Playbook.filter({ dropbox_source: 'learning' }));
  assert.equal(third.archived, 1);
  assert.equal((await entities.Playbook.get(git.id)).status, 'archived');
  assert.notEqual((await entities.Playbook.get(mainPlaybook.id)).status, 'archived');
});

test('source routes: status, folder rules and the connect redirect', async () => {
  const { data: list } = await call('GET', '/dropbox/sources');
  const byKey = Object.fromEntries(list.map((s) => [s.key, s]));
  assert.deepEqual([byKey.learning.own_app, byKey.learning.connected, byKey.strategic.own_app], [true, true, false]);
  assert.equal(byKey.learning.redirect_uri, config.dropbox.sources.learning.redirectUri);

  assert.equal((await call('PATCH', '/dropbox/sources/learning', { path: '/' })).data.path, '/', 'its own (App folder) app: the whole app folder');
  assert.equal((await call('PATCH', '/dropbox/sources/strategic', { path: '/' })).status, 400, 'through the main app: never the whole Dropbox');
  config.dropbox.sources.learning.fullAccess = true;
  assert.equal((await call('PATCH', '/dropbox/sources/learning', { path: '/' })).status, 400, 'a Full Dropbox app: never the whole Dropbox');
  config.dropbox.sources.learning.fullAccess = false;
  assert.equal((await call('PATCH', '/dropbox/sources/nope', { path: '/x' })).status, 404);

  const start = await call('GET', '/dropbox/sources/learning/oauth/start');
  assert.equal(start.status, 302);
  assert.equal(new URL(start.location).searchParams.get('client_id'), 'learn-key');
  assert.equal((await call('GET', '/dropbox/sources/strategic/oauth/start')).status, 503, 'no app of its own to connect');
});
