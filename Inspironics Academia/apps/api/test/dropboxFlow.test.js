import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';

// Dropbox end to end through the admin API: connect (OAuth), choose folders, sync, change and delete
// files, lose access, disconnect — for the main playbooks app and a category's own app. Dropbox is a
// fake behind `fetch` that also throws rate limits, expired tokens and paged listings at the client.

// ---- fake Dropbox ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;
const APPS = { 'main-key': 'main', 'learn-key': 'learn' };
const files = { main: new Map(), learn: new Map() }; // path_lower → { id, path_display, rev, bytes }
// Folders by lower-case path → display path.
const folderMap = (...paths) => new Map(paths.map((p) => [p.toLowerCase(), p]));
const folders = { main: folderMap('/Playbooks', '/Playbooks/Guides', '/Other', '/Meetings'), learn: folderMap('/Learning & Development') };
const fake = { revoked: new Set(), rateLimitOnce: false, unauthorizedOnce: false, pageSize: 2, badCode: 'bad-code', calls: [] };

async function docx(lines) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const playbookDoc = (title) => docx([title, ...Array.from({ length: 6 }, () => `About this ${title} playbook and who should read it.`), ...[1, 2].flatMap((n) => [`Chapter ${n}: ${title} ${n === 1 ? "basics" : "in practice"}`, ...Array.from({ length: 8 }, () => `Rules and procedures for ${title}, part ${n}, explained in detail for engineers.`)])]);

let nextId = 1;
async function putFile(app, display, bytes) {
  const lowerPath = display.toLowerCase();
  const prev = files[app].get(lowerPath);
  files[app].set(lowerPath, { id: prev?.id || `id:${nextId++}`, path_display: display, rev: `r${nextId++}`, bytes });
}

const json = (status, data, headers = {}) => new Response(data === null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });
const appOfToken = (auth) => (auth || '').replace(/^Bearer at-/, '');

function entriesUnder(app, dir, recursive) {
  const d = dir.toLowerCase();
  const inside = (p) => (d === '' ? true : p.startsWith(`${d}/`));
  const direct = (p) => !p.slice(d.length + 1).includes('/');
  const out = [];
  for (const [f, shown] of folders[app]) if (inside(f) && (recursive || direct(f))) out.push({ '.tag': 'folder', name: shown.split('/').pop(), path_display: shown, path_lower: f });
  for (const [p, f] of files[app]) if (inside(p) && (recursive || direct(p))) out.push({ '.tag': 'file', id: f.id, name: f.path_display.split('/').pop(), path_display: f.path_display, path_lower: p, rev: f.rev, size: f.bytes.length, content_hash: `h-${f.rev}`, server_modified: '2026-11-01T00:00:00Z' });
  return out;
}

const pages = new Map();
function dropbox(url, init) {
  const endpoint = url.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/(2\/)?/, '');
  const h = init.headers || {};
  fake.calls.push(endpoint);
  if (endpoint === 'oauth2/token') {
    const app = APPS[Buffer.from(String(h.Authorization).slice(6), 'base64').toString().split(':')[0]];
    const form = new URLSearchParams(init.body);
    if (form.get('grant_type') === 'authorization_code') {
      if (form.get('code') === fake.badCode) return json(400, { error: 'invalid_grant' });
      return json(200, { access_token: `at-${app}`, refresh_token: `rt-${app}`, expires_in: 14400 });
    }
    if (fake.revoked.has(app)) return json(400, { error: 'invalid_grant' });
    return json(200, { access_token: `at-${app}`, expires_in: 14400 });
  }
  const app = appOfToken(h.Authorization);
  if (!files[app]) return json(401, { error_summary: 'invalid_access_token/' });
  if (fake.unauthorizedOnce) { fake.unauthorizedOnce = false; return json(401, { error_summary: 'expired_access_token/' }); }
  const body = init.body ? JSON.parse(init.body) : null;
  switch (endpoint) {
    case 'users/get_current_account':
      return json(200, { account_id: `dbid:${app}`, email: `${app}@example.com`, name: { display_name: `${app} owner` }, root_info: { '.tag': 'user', root_namespace_id: '1', home_namespace_id: '1' } });
    case 'auth/token/revoke':
      return json(200, null);
    case 'files/get_metadata': {
      const p = body.path.toLowerCase();
      if (folders[app].has(p)) return json(200, { '.tag': 'folder', path_lower: p });
      if (files[app].has(p)) return json(200, { '.tag': 'file', path_lower: p });
      return json(409, { error_summary: 'path/not_found/..', error: { '.tag': 'path' } });
    }
    case 'files/list_folder': {
      if (fake.rateLimitOnce) { fake.rateLimitOnce = false; return json(429, { error_summary: 'too_many_requests/' }, { 'retry-after': '1' }); }
      const dir = body.path.toLowerCase();
      if (dir && !folders[app].has(dir)) return json(409, { error_summary: 'path/not_found/...' });
      const all = entriesUnder(app, dir, body.recursive);
      const cursor = `c${pages.size}`;
      pages.set(cursor, all.slice(fake.pageSize));
      return json(200, { entries: all.slice(0, fake.pageSize), has_more: all.length > fake.pageSize, cursor });
    }
    case 'files/list_folder/continue': {
      const rest = pages.get(body.cursor) || [];
      const cursor = `${body.cursor}+`;
      pages.set(cursor, rest.slice(fake.pageSize));
      return json(200, { entries: rest.slice(0, fake.pageSize), has_more: rest.length > fake.pageSize, cursor });
    }
    case 'files/download': {
      const arg = JSON.parse(h['Dropbox-API-Arg']);
      const f = [...files[app].values()].find((x) => x.id === arg.path);
      if (!f) return json(409, { error_summary: 'path/not_found/' });
      return new Response(f.bytes, { status: 200, headers: { 'dropbox-api-result': JSON.stringify({ id: f.id, rev: f.rev }) } });
    }
    default:
      return json(400, { error_summary: `unknown endpoint ${endpoint}` });
  }
}
globalThis.fetch = async (url, init = {}) => (/^https:\/\/(api|content)\.dropboxapi\.com\//.test(String(url)) ? dropbox(String(url), init) : realFetch(url, init));

// ---- the API -------------------------------------------------------------------------------

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-dropbox-flow-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', AI_ENABLED: 'false', LOG_LEVEL: 'error',
  AUTO_EXTRACT_ON_SYNC: 'true', SYNC_CONCURRENCY: '2',
  DROPBOX_APP_KEY: 'main-key', DROPBOX_APP_SECRET: 'main-secret', DROPBOX_REDIRECT_URI: 'http://localhost:5173/academia/api/dropbox/oauth/callback',
  DROPBOX_MEETINGS_APP_KEY: '', DROPBOX_MEETINGS_APP_SECRET: '',
  DROPBOX_LEARNING_APP_KEY: 'learn-key', DROPBOX_LEARNING_APP_SECRET: 'learn-secret', DROPBOX_LEARNING_ACCESS: 'full',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
});

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { entities } = await import('../src/repo/entities.js');
const { createApp } = await import('../src/app.js');
const { startScheduler, stopScheduler, nextRunAt } = await import('../src/sync/scheduler.js');
const { runSync } = await import('../src/sync/pipeline.js');
const { clearAccessToken, withDropboxAccount } = await import('../src/dropbox/connection.js');

let server;
let base;
const jar = { admin: '', learner: '' };
async function call(who, method, url, body) {
  const res = await realFetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(jar[who] ? { Cookie: jar[who] } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie');
  if (set && who) jar[who] = set.split(';')[0];
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, location: res.headers.get('location') };
}
const admin = (...a) => call('admin', ...a);

/** Runs the OAuth dance for an app: start → (user approves at Dropbox) → callback. */
async function connect(prefix, { code = 'good-code', error } = {}) {
  const start = await admin('GET', `${prefix}/oauth/start`);
  assert.equal(start.status, 302);
  const state = new URL(start.location).searchParams.get('state');
  const q = new URLSearchParams({ state, ...(error ? { error } : { code }) });
  const cb = await admin('GET', `${prefix}/oauth/callback?${q}`);
  assert.equal(cb.status, 302);
  return new URL(cb.location).searchParams;
}

async function syncNow() {
  const r = await runSync({ trigger: 'manual' });
  assert.equal(r.started, true, r.reason);
  return r;
}

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await admin('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
  await call('learner', 'POST', '/auth/register', { email: 'learner@example.com', password: 'Learner-pass-123', full_name: 'Lee Learner' });

  await putFile('main', '/Playbooks/Incident Response.docx', await playbookDoc('Incident Response'));
  await putFile('main', '/Playbooks/Guides/Code Review.docx', await playbookDoc('Code Review'));
  await putFile('main', '/Playbooks/notes.png', Buffer.from('not a playbook'));
  await putFile('main', '/Other/Private.docx', await playbookDoc('Private'));
  await putFile('learn', '/Learning & Development/Python Basics.docx', await playbookDoc('Python Basics'));
});

after(async () => {
  stopScheduler();
  globalThis.fetch = realFetch;
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('only admins reach the Dropbox and sync endpoints', async () => {
  for (const [method, url] of [['GET', '/dropbox/status'], ['GET', '/dropbox/sources'], ['GET', '/sync/status'], ['POST', '/sync/run'], ['PATCH', '/dropbox/settings']]) {
    assert.equal((await call('learner', method, url, method === 'GET' ? undefined : {})).status, 403, `${method} ${url} for a learner`);
    assert.equal((await call('', method, url, method === 'GET' ? undefined : {})).status, 401, `${method} ${url} signed out`);
  }
});

test('before connecting: status says so and a sync is refused', async () => {
  const { data: status } = await admin('GET', '/dropbox/status');
  assert.equal(status.configured, true);
  assert.equal(status.connected, false);
  assert.equal(status.redirect_uri, 'http://localhost:5173/academia/api/dropbox/oauth/callback');
  assert.equal((await admin('POST', '/sync/run')).status, 409);
  assert.equal((await admin('GET', '/dropbox/folders')).status, 409);
  assert.equal((await runSync()).started, false);
});

test('OAuth callback refuses bad states, denials, missing codes and failed exchanges', async () => {
  assert.equal((await connect('/dropbox', { error: 'access_denied' })).get('reason'), 'access_denied');
  assert.equal((await connect('/dropbox', { error: 'server_error' })).get('reason'), 'authorization_failed');
  assert.equal((await connect('/dropbox', { code: fake.badCode })).get('reason'), 'exchange_failed');
  const forged = await admin('GET', '/dropbox/oauth/callback?state=forged&code=x');
  assert.equal(new URL(forged.location).searchParams.get('reason'), 'invalid_state');
  const anonymous = await call('', 'GET', '/dropbox/oauth/callback?state=x&code=x');
  assert.equal(new URL(anonymous.location).searchParams.get('reason'), 'not_admin');
  assert.equal((await admin('GET', '/dropbox/status')).data.connected, false);
});

test('connecting the main app, browsing folders and choosing the playbooks folder', async () => {
  assert.equal((await connect('/dropbox')).get('dropbox'), 'connected');
  const { data: status } = await admin('GET', '/dropbox/status');
  assert.equal(status.connected, true);
  assert.equal(status.account_email, 'main@example.com');
  assert.equal(status.account_name, 'main owner');

  fake.rateLimitOnce = true; // listing pages through has_more, and a 429 is retried
  const { data: top } = await admin('GET', '/dropbox/folders');
  assert.deepEqual(top.map((f) => f.name), ['Meetings', 'Other', 'Playbooks']);
  assert.deepEqual((await admin('GET', '/dropbox/folders?path=/Playbooks')).data.map((f) => f.name), ['Guides']);
  assert.equal((await admin('GET', '/dropbox/folders?path=/Playbooks/../Other')).status, 400);
  assert.equal((await admin('GET', '/dropbox/folders?path=/Nope')).status, 404);

  assert.equal((await admin('PATCH', '/dropbox/settings', {})).status, 400);
  assert.equal((await admin('PATCH', '/dropbox/settings', { root_path: '' })).status, 400, 'never the whole Dropbox');
  assert.equal((await admin('PATCH', '/dropbox/settings', { root_path: '/Missing' })).status, 404);
  assert.equal((await admin('PATCH', '/dropbox/settings', { root_path: '/Playbooks/notes.png' })).status, 400, 'a file is not a folder');
  assert.equal((await admin('PATCH', '/dropbox/settings', { root_path: '/Playbooks/../Other' })).status, 400);
  assert.equal((await admin('PATCH', '/dropbox/settings', { root_path: 'id:abc' })).status, 400);
  const saved = await admin('PATCH', '/dropbox/settings', { root_path: 'Playbooks/', meetings_path: '/Meetings' });
  assert.equal(saved.status, 200);
  assert.equal(saved.data.root_path, '/Playbooks');
  assert.equal(saved.data.meetings_path, '/Meetings');
});

test('the Learning & Development app connects separately and must use a chosen folder', async () => {
  assert.equal((await connect('/dropbox/sources/learning')).get('app'), 'learning');
  const { data: list } = await admin('GET', '/dropbox/sources');
  const learning = list.find((s) => s.key === 'learning');
  assert.equal(learning.connected, true);
  assert.equal(learning.account_email, 'learn@example.com');
  assert.equal(learning.app_folder, false);

  assert.deepEqual((await admin('GET', '/dropbox/sources/learning/folders')).data.map((f) => f.name), ['Learning & Development']);
  assert.equal((await admin('PATCH', '/dropbox/sources/learning', { path: '/' })).status, 400, 'a Full Dropbox app never syncs the whole Dropbox');
  assert.equal((await admin('PATCH', '/dropbox/sources/learning', {})).status, 400);
  assert.equal((await admin('PATCH', '/dropbox/sources/learning', { path: '/Learning & Development' })).data.path, '/Learning & Development');
  assert.equal((await admin('GET', '/dropbox/sources/strategic/folders')).status, 200, 'without its own app a source browses the main app');
});

test('a sync brings in each folder\'s documents with the right category, and nothing else', async () => {
  const r = await syncNow();
  assert.equal(r.status, 'success', JSON.stringify(r));
  const playbooks = await entities.Playbook.filter({ source: 'dropbox' });
  const byName = Object.fromEntries(playbooks.map((p) => [p.file_name, p]));
  assert.deepEqual(Object.keys(byName).sort(), ['Code Review.docx', 'Incident Response.docx', 'Python Basics.docx']);
  assert.equal(byName['Incident Response.docx'].category, 'corporate');
  assert.equal(byName['Code Review.docx'].dropbox_path, '/Playbooks/Guides/Code Review.docx');
  assert.equal(byName['Python Basics.docx'].category, 'learning');
  assert.equal(byName['Python Basics.docx'].dropbox_source, 'learning');
  for (const p of playbooks) {
    assert.equal(p.status, 'processed', `${p.file_name} was extracted`);
    assert.equal(p.chapter_count, 2);
  }

  const { data: logs } = await admin('GET', '/sync/logs');
  assert.equal(logs[0].status, 'success');
  assert.equal(logs[0].added, 3);
  const { data: syncStatus } = await admin('GET', '/sync/status');
  assert.equal(syncStatus.running, false);
  assert.equal(syncStatus.connected, true);
  assert.equal(syncStatus.last.id, logs[0].id);
});

test('a second sync changes nothing; edits, moves and deletions are picked up', async () => {
  const again = await syncNow();
  assert.deepEqual([again.counts.added, again.counts.updated, again.counts.unchanged], [0, 0, 3]);

  await putFile('main', '/Playbooks/Incident Response.docx', await playbookDoc('Incident Response v2'));
  files.learn.delete('/learning & development/python basics.docx');
  const python = (await entities.Playbook.filter({ dropbox_source: 'learning' }))[0];
  fake.unauthorizedOnce = true; // an expired access token is refreshed and the call retried
  const r = await syncNow();
  assert.equal(r.counts.updated, 1);
  assert.equal(r.counts.archived, 1);
  assert.equal((await entities.Playbook.get(python.id)).status, 'archived');
  const incident = (await entities.Playbook.filter({ file_name: 'Incident Response.docx' }))[0];
  assert.equal(incident.status, 'processed');
  assert.equal((await entities.PlaybookVersion.filter({ playbook_id: incident.id })).length, 2, 'the new revision is a new version');
});

test('a missing source folder is reported without archiving that source\'s playbooks', async () => {
  await putFile('learn', '/Learning & Development/Git Basics.docx', await playbookDoc('Git Basics'));
  await syncNow();
  const git = (await entities.Playbook.filter({ file_name: 'Git Basics.docx' }))[0];
  folders.learn.delete('/learning & development');
  const saved = new Map(files.learn);
  files.learn.clear();
  const r = await syncNow();
  assert.equal(r.status, 'partial');
  assert.notEqual((await entities.Playbook.get(git.id)).status, 'archived');
  folders.learn.set('/learning & development', '/Learning & Development');
  for (const [k, v] of saved) files.learn.set(k, v);
});

test('a revoked connection asks for a reconnect, and disconnecting stops the sync', async () => {
  fake.revoked.add('main');
  await withDropboxAccount('playbooks', async () => clearAccessToken());
  const folders = await admin('GET', '/dropbox/folders');
  assert.equal(folders.status, 409);
  assert.match(folders.data.error, /reconnect/i);
  assert.equal((await admin('GET', '/dropbox/status')).data.needs_reconnect, true);

  fake.revoked.delete('main');
  assert.equal((await connect('/dropbox')).get('dropbox'), 'connected');
  assert.equal((await admin('GET', '/dropbox/status')).data.needs_reconnect, false);

  const off = await admin('POST', '/dropbox/sources/learning/disconnect');
  assert.equal(off.data.connected, false);
  assert.ok(fake.calls.includes('auth/token/revoke'), 'the token is revoked at Dropbox');
  assert.equal((await admin('POST', '/dropbox/disconnect')).data.connected, false);
  assert.equal((await admin('GET', '/dropbox/status')).data.connected, false);
  assert.equal((await admin('POST', '/sync/run')).status, 409);
  assert.equal((await admin('POST', '/dropbox/ignored/clear')).data.cleared, 0);
});

test('the scheduler reports its next run and stops cleanly', () => {
  startScheduler();
  const next = nextRunAt();
  assert.ok(next && Date.parse(next) > Date.now(), 'a next run is scheduled');
  startScheduler(); // idempotent
  assert.equal(nextRunAt(), next);
  stopScheduler();
  assert.equal(nextRunAt(), null);
});
