import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';

// Dropbox as the primary store: what APEX downloads, keeps and cleans up. A fake Dropbox (behind
// fetch) counts every download and upload, so the tests can prove metadata-only sync, no local copies,
// revision reuse, streaming previews, safe clean-up and output uploads without duplicates.

const realFetch = globalThis.fetch;
const files = new Map(); // path_lower → { id, path_display, rev, bytes }
const folders = new Set(['/playbooks', '/docs', '/apex generated videos', '/apex generated videos/projects']);
const counts = { downloads: 0, uploads: 0 };
const fake = { writeScope: true };
const REFRESH = 'refresh-token-never-leaves-the-server';
const ACCESS = 'access-token-never-leaves-the-server';
let nextId = 1;
let dropboxContentHash;

function putFile(display, bytes) {
  const lower = display.toLowerCase();
  const prev = files.get(lower);
  const f = { id: prev?.id || `id:${nextId++}`, path_display: display, rev: `r${nextId++}`, bytes };
  files.set(lower, f);
  return f;
}
const meta = (f) => ({ '.tag': 'file', id: f.id, name: f.path_display.split('/').pop(), path_display: f.path_display, path_lower: f.path_display.toLowerCase(), rev: f.rev, size: f.bytes.length, content_hash: dropboxContentHash(f.bytes), server_modified: '2026-11-01T00:00:00Z' });
const json = (status, data) => new Response(data == null ? '' : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const byIdOrPath = (p) => [...files.values()].find((f) => f.id === p || f.path_display.toLowerCase() === String(p).toLowerCase());

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  if (!/^https:\/\/(api|content)\.dropboxapi\.com\//.test(u)) return realFetch(url, init);
  const endpoint = u.replace(/^https:\/\/(api|content)\.dropboxapi\.com\/(2\/)?/, '');
  const h = init.headers || {};
  if (endpoint === 'oauth2/token') return json(200, { access_token: ACCESS, expires_in: 14400 });
  const arg = h['Dropbox-API-Arg'] ? JSON.parse(h['Dropbox-API-Arg']) : null;
  const body = arg ? null : init.body ? JSON.parse(init.body) : null;
  switch (endpoint) {
    case 'files/list_folder': {
      const dir = body.path.toLowerCase();
      const inside = (p) => (dir ? p.startsWith(`${dir}/`) && (body.recursive || !p.slice(dir.length + 1).includes('/')) : body.recursive || !p.slice(1).includes('/'));
      const entries = [
        ...[...folders].filter(inside).map((p) => ({ '.tag': 'folder', name: p.split('/').pop(), path_display: p, path_lower: p })),
        ...[...files.values()].filter((f) => inside(f.path_display.toLowerCase())).map(meta),
      ];
      return json(200, { entries, has_more: false, cursor: 'c' });
    }
    case 'files/get_metadata': {
      const f = byIdOrPath(body.path);
      if (f) return json(200, meta(f));
      if (folders.has(String(body.path).toLowerCase())) return json(200, { '.tag': 'folder' });
      return json(409, { error_summary: 'path/not_found/' });
    }
    case 'files/download': {
      const f = byIdOrPath(arg.path);
      if (!f) return json(409, { error_summary: 'path/not_found/' });
      counts.downloads++;
      const m = /^bytes=(\d+)-(\d*)$/.exec(h.Range || '');
      if (m) {
        const end = m[2] ? Number(m[2]) : f.bytes.length - 1;
        return new Response(f.bytes.subarray(Number(m[1]), end + 1), { status: 206, headers: { 'content-range': `bytes ${m[1]}-${end}/${f.bytes.length}`, 'content-length': String(end - Number(m[1]) + 1) } });
      }
      return new Response(f.bytes, { status: 200, headers: { 'content-length': String(f.bytes.length), 'dropbox-api-result': JSON.stringify(meta(f)) } });
    }
    case 'files/upload': {
      if (!fake.writeScope) return json(401, { error_summary: 'missing_scope/..', error: { '.tag': 'missing_scope', required_scope: 'files.content.write' } });
      counts.uploads++;
      const f = putFile(arg.path, Buffer.from(await new Response(init.body).arrayBuffer()));
      return json(200, meta(f));
    }
    case 'users/get_space_usage':
      return json(200, { used: 123456789, allocation: { '.tag': 'individual', allocated: 2147483648 } });
    case 'users/get_current_account':
      return json(200, { account_id: 'dbid:1', email: 'owner@example.com', name: { display_name: 'Owner' }, root_info: { '.tag': 'user', root_namespace_id: '1', home_namespace_id: '1' } });
    default:
      return json(400, { error_summary: `unknown ${endpoint}` });
  }
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-dbx-storage-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error', AI_ENABLED: 'false',
  AUTO_EXTRACT_ON_SYNC: 'false', DROPBOX_SOURCE_CACHE: 'temporary', TEMP_PROCESSING_DIR: path.join(dir, 'tmp'), TEMP_MAX_AGE_HOURS: '1',
  DROPBOX_APP_KEY: 'k', DROPBOX_APP_SECRET: 's', DROPBOX_REDIRECT_URI: 'http://localhost/api/dropbox/oauth/callback',
  TOKEN_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
});

({ dropboxContentHash } = await import('../src/dropbox/client.js'));
const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { createApp } = await import('../src/app.js');
const { entities } = await import('../src/repo/entities.js');
const { objectKey, putObject, getObject } = await import('../src/files/objectStore.js');
const { saveConnection, saveSyncSettings, withDropboxAccount } = await import('../src/dropbox/connection.js');
const { createTempDir, releaseTempDir } = await import('../src/files/tempStore.js');
const { runSync } = await import('../src/sync/pipeline.js');
const { handlers } = await import('../src/pipeline/index.js');
const { publishVideo } = await import('../src/dropbox/output.js');
const { config } = await import('../src/config.js');

let server;
let base;
let cookie = '';
async function call(method, url, body, headers = {}) {
  const res = await realFetch(`${base}/api${url}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const buf = Buffer.from(await res.arrayBuffer());
  let data = buf.toString();
  try { data = JSON.parse(data); } catch { /* binary */ }
  return { status: res.status, data, buf, headers: res.headers };
}
const dropboxObjects = () => {
  const root = config.objectDir;
  let n = 0;
  for (const s of fs.existsSync(root) ? fs.readdirSync(root) : []) for (const f of fs.readdirSync(path.join(root, s))) if (f.endsWith('.json') && JSON.parse(fs.readFileSync(path.join(root, s, f), 'utf8')).source === 'dropbox') n++;
  return n;
};

async function docx(lines) {
  const zip = new JSZip();
  zip.file('word/document.xml', `<w:document xmlns:w="w"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${l}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
const playbookDoc = (t) => docx([t, ...Array.from({ length: 8 }, () => `About the ${t} playbook and who reads it.`), ...[1, 2].flatMap((n) => [`Chapter ${n}: ${t} ${n === 1 ? 'basics' : 'in practice'}`, ...Array.from({ length: 10 }, () => `Rules and procedures for ${t} explained in detail for engineers.`)])]);
async function pptx(slides) {
  const zip = new JSZip();
  slides.forEach((s, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld>${s.map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`).join('')}</p:sld>`));
  return zip.generateAsync({ type: 'nodebuffer' });
}

before(async () => {
  await migrate(await getDb());
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await call('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123' });
  await withDropboxAccount('playbooks', () => saveConnection({ refreshToken: REFRESH, account: { account_id: 'dbid:1', email: 'owner@example.com', name: { display_name: 'Owner' } }, rootInfo: { '.tag': 'user', root_namespace_id: '1', home_namespace_id: '1' } }));
  await saveSyncSettings({ root_path: '/Playbooks' });
  putFile('/Playbooks/Incident Response.docx', await playbookDoc('Incident Response'));
  putFile('/Docs/Onboarding deck.pptx', await pptx([['Welcome to Inspironics', 'Who we are'], ['Your first week', 'Meet your mentor', 'Set up your laptop and accounts carefully'], ['Ways of working', 'Code review before merge', 'Daily stand-up at ten']]));
  putFile('/Docs/Team photo.png', Buffer.from('not really a png'));
});
after(async () => {
  globalThis.fetch = realFetch;
  server?.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

let playbook;
test('sync with extraction off is metadata-only: nothing is downloaded or stored', async () => {
  const r = await runSync({ trigger: 'manual' });
  assert.equal(r.started, true, r.reason);
  assert.equal(r.counts.added, 1);
  assert.equal(counts.downloads, 0, 'no file bytes fetched during sync');
  [playbook] = await entities.Playbook.filter({ source: 'dropbox' });
  assert.equal(playbook.status, 'uploaded');
  assert.equal(dropboxObjects(), 0);
});

test('extraction fetches the file into memory only, and records the revision it processed', async () => {
  const out = await handlers.processPlaybookExtract({ playbook_id: playbook.id }, {});
  assert.equal(out.chapter_count, 2);
  assert.equal(counts.downloads, 1);
  assert.equal(dropboxObjects(), 0, 'DROPBOX_SOURCE_CACHE=temporary keeps no local copy');
  playbook = await entities.Playbook.get(playbook.id);
  assert.equal(playbook.extracted_revision, playbook.revision);
  const [version] = await entities.PlaybookVersion.filter({ playbook_id: playbook.id });
  assert.equal(version.source_revision, playbook.revision);
});

test('the same revision is not extracted again unless forced; a new revision is', async () => {
  const again = await handlers.processPlaybookExtract({ playbook_id: playbook.id }, {});
  assert.equal(again.skipped, true);
  assert.equal(counts.downloads, 1, 'no download for an unchanged revision');
  const forced = await handlers.processPlaybookExtract({ playbook_id: playbook.id, force: true }, {});
  assert.equal(forced.chapter_count, 2);
  assert.equal(counts.downloads, 2);
  putFile('/Playbooks/Incident Response.docx', await playbookDoc('Incident Response v2'));
  await runSync({ trigger: 'manual' });
  playbook = await entities.Playbook.get(playbook.id);
  assert.notEqual(playbook.revision, playbook.extracted_revision, 'the change is detected from metadata');
  await handlers.processPlaybookExtract({ playbook_id: playbook.id }, {});
  assert.equal(counts.downloads, 3);
  const { data: overview } = await call('POST', '/auth/login', { email: 'admin@example.com', password: 'Admin-pass-123' }).then(() => call('GET', '/studio/storage/overview'));
  assert.equal(overview.processing.duplicate_processing_prevented, 1);
  assert.equal(overview.processing.documents_processed, 3);
  assert.equal(overview.dropbox.space.playbooks.used, 123456789);
});

test('viewing the source streams it from Dropbox (Range too) without storing a copy', async () => {
  const before = counts.downloads;
  const full = await call('GET', `/playbooks/${playbook.id}/content`);
  assert.equal(full.status, 200);
  assert.equal(full.buf.length, files.get('/playbooks/incident response.docx').bytes.length);
  const part = await call('GET', `/playbooks/${playbook.id}/content`, undefined, { Range: 'bytes=0-9' });
  assert.equal(part.status, 206);
  assert.equal(part.buf.length, 10);
  assert.equal(counts.downloads, before + 2);
  assert.equal(dropboxObjects(), 0);
});

test('browsing Dropbox lists folders and files with metadata, downloading nothing', async () => {
  const before = counts.downloads;
  const top = await call('GET', '/studio/dropbox/browse?account=playbooks&path=');
  assert.deepEqual(top.data.folders.map((f) => f.name).sort(), ['apex generated videos', 'docs', 'playbooks']);
  const docs = await call('GET', '/studio/dropbox/browse?account=playbooks&path=/Docs');
  const deck = docs.data.files.find((f) => f.ext === 'pptx');
  assert.ok(deck.size > 0 && deck.rev && deck.server_modified && deck.processable);
  assert.equal(docs.data.files.find((f) => f.ext === 'png').processable, false);
  const pbs = await call('GET', '/studio/dropbox/browse?account=playbooks&path=/Playbooks');
  assert.equal(pbs.data.files[0].tracked.type, 'playbook');
  assert.equal(counts.downloads, before);
  assert.equal((await call('GET', '/studio/dropbox/browse?account=playbooks&path=/Docs/../x')).status, 400);
  assert.equal((await call('GET', '/studio/dropbox/browse?account=nope')).status, 400);
});

test('a video project from a Dropbox PPTX: extracted once per revision, reused, re-extracted when it changes', async () => {
  const deck = files.get('/docs/onboarding deck.pptx');
  const first = await call('POST', '/studio/projects/from-dropbox', { account: 'playbooks', file_id: deck.id });
  assert.equal(first.status, 201);
  assert.equal(first.data.source_type, 'dropbox');
  assert.equal(first.data.source_revision, deck.rev);
  assert.ok(first.data.scenes.length >= 1);
  assert.ok(first.data.scenes.some((s) => /mentor|stand-up|Inspironics/.test(s.narration)));
  const downloads = counts.downloads;
  const second = await call('POST', '/studio/projects/from-dropbox', { account: 'playbooks', file_id: deck.id });
  assert.equal(second.data.reused, true);
  assert.equal(second.data.id, first.data.id);
  assert.equal(counts.downloads, downloads, 'same revision: no download');
  putFile('/Docs/Onboarding deck.pptx', await pptx([['Welcome', 'Updated agenda for new joiners and their mentors']]));
  const third = await call('POST', '/studio/projects/from-dropbox', { account: 'playbooks', file_id: deck.id });
  assert.equal(third.status, 201);
  assert.notEqual(third.data.id, first.data.id);
  assert.equal(counts.downloads, downloads + 1);
  const png = files.get('/docs/team photo.png');
  const refused = await call('POST', '/studio/projects/from-dropbox', { account: 'playbooks', file_id: png.id });
  assert.equal(refused.status, 415);
  assert.match(refused.data.error, /OCR/);
  files.delete('/docs/onboarding deck.pptx');
  assert.equal((await call('POST', '/studio/projects/from-dropbox', { account: 'playbooks', file_id: deck.id })).status, 404, 'deleted in Dropbox');
});

test('storage report and clean-up: copies and caches go, originals and media in use stay', async () => {
  const orphan = objectKey('dropbox', 'id:gone', 'r1', 'source');
  await putObject(orphan, Buffer.alloc(5000, 1), { source: 'dropbox', file_id: 'id:gone', rev: 'r1', name: 'Deleted.pdf' });
  const upload = objectKey('upload', 'nobody-uses-me');
  await putObject(upload, Buffer.alloc(3000, 2), { source: 'upload', name: 'Old.pdf' });
  const audio = objectKey('media', 'lesson-x', 'audio');
  await putObject(audio, Buffer.alloc(4000, 3), { source: 'media', kind: 'audio', content_type: 'audio/mpeg' });
  const course = await entities.Course.create({ title: 'C', status: 'published' });
  const mod = await entities.Module.create({ course_id: course.id, title: 'M', order: 0 });
  await entities.Lesson.create({ module_id: mod.id, title: 'L', audio_url: `/api/media/${audio}`, status: 'approved' });
  // Left behind by a process that crashed mid-render three hours ago (its job is no longer active).
  const stale = path.join(config.storage.tempDir, 'render-crashed');
  fs.mkdirSync(stale, { recursive: true });
  fs.writeFileSync(path.join(stale, 'frame.png'), Buffer.alloc(100));
  const old = new Date(Date.now() - 3 * 3600_000);
  fs.writeFileSync(path.join(stale, '.owner.json'), JSON.stringify({ purpose: 'render', jobId: 'finished-job', pid: 1, created_at: old.toISOString() }));
  const busy = await createTempDir('render');

  const { data: report } = await call('GET', '/studio/storage?fresh=1');
  const cat = (c) => report.categories.find((x) => x.category === c);
  assert.equal(cat('dropbox-orphan').bytes, 5000);
  assert.equal(cat('upload-unreferenced').bytes, 3000);
  assert.equal(cat('audio').bytes, 4000);
  assert.equal(report.policy.dropbox_source_cache, 'temporary');

  const dry = await call('POST', '/studio/storage/cleanup', {});
  assert.equal(dry.data.dry_run, true);
  assert.deepEqual(dry.data.by_category.map((c) => c.category), ['dropbox-orphan']);
  assert.equal(dry.data.temp.removed, 1);
  assert.ok(await getObject(orphan), 'a dry run deletes nothing');

  const real = await call('POST', '/studio/storage/cleanup', { dry_run: false });
  assert.equal(real.data.objects.removed, 1);
  assert.equal(await getObject(orphan), null);
  assert.ok(await getObject(upload), 'uploaded originals are never removed');
  assert.ok(await getObject(audio), 'narration in use is never removed');
  assert.ok(!fs.existsSync(stale), 'abandoned temp dir removed');
  assert.ok(fs.existsSync(busy), 'a temp dir in use is kept');
  await releaseTempDir(busy);
});

test('rendered videos to Dropbox: one fixed path, identical bytes not re-uploaded, missing permission explained', async () => {
  const video = objectKey('media', 'render', 'project', 'p1', 'video', 'x');
  await putObject(video, Buffer.from('fake mp4 bytes'), { source: 'media', kind: 'video', content_type: 'video/mp4' });
  const project = await entities.VideoProject.create({ title: 'Onboarding', scenes: '[]', video_url: `/api/media/${video}` });
  assert.equal(await publishVideo({ refType: 'project', refId: project.id, title: project.title, videoUrl: project.video_url }), null, 'destination APEX: nothing uploaded');

  assert.equal((await call('PUT', '/studio/storage/output', { destination: 'dropbox', folder: '/APEX Generated Videos', keep_local: true })).status, 200);
  const first = await publishVideo({ refType: 'project', refId: project.id, title: 'Onboarding', videoUrl: project.video_url });
  assert.equal(first.uploaded, true);
  assert.match(first.path, /^\/APEX Generated Videos\/projects\/Onboarding \(.{8}\)\.mp4$/);
  const second = await publishVideo({ refType: 'project', refId: project.id, title: 'Onboarding', videoUrl: project.video_url });
  assert.equal(second.uploaded, false, 'same bytes already in Dropbox');
  assert.equal(counts.uploads, 1);

  fake.writeScope = false;
  await putObject(video, Buffer.from('changed mp4 bytes'), { source: 'media', kind: 'video', content_type: 'video/mp4' });
  await assert.rejects(publishVideo({ refType: 'project', refId: project.id, title: 'Onboarding', videoUrl: project.video_url }), (err) => err.status === 403 && /files\.content\.write/.test(err.message));
  fake.writeScope = true;

  // Retry through the publish job; with "keep local copy" off the APEX copy goes and the video streams from Dropbox.
  await call('PUT', '/studio/storage/output', { keep_local: false });
  const { startJobWorker, stopJobWorker, waitForJob } = await import('../src/jobs/queue.js');
  await startJobWorker({ intervalMs: 100 });
  try {
    const r = await call('POST', '/functions/publishRenderedVideo', { ref_type: 'project', ref_id: project.id });
    const job = await waitForJob(r.data.job.id);
    assert.equal(job.status, 'completed', job.error || '');
  } finally {
    stopJobWorker();
  }
  const saved = await entities.VideoProject.get(project.id);
  assert.equal(saved.video_url, `/api/outputs/project/${project.id}/video`);
  assert.ok(saved.dropbox_id && saved.dropbox_rev);
  assert.equal(await getObject(video), null, 'local copy removed after upload');
  const streamed = await call('GET', `/outputs/project/${project.id}/video`, undefined, { Range: 'bytes=0-6' });
  assert.equal(streamed.status, 206);
  assert.equal(streamed.buf.toString(), 'changed');
  assert.equal((await call('PUT', '/studio/storage/output', { folder: '/' })).status, 400, 'never the whole Dropbox');
});

test('no endpoint returns a Dropbox token, and the stored refresh token is encrypted', async () => {
  for (const url of ['/dropbox/status', '/studio/dropbox/accounts', '/studio/storage/overview', '/studio/storage', '/studio/dropbox/browse?account=playbooks&path=']) {
    const r = await call('GET', url);
    assert.equal(r.status, 200, url);
    assert.ok(!r.buf.toString().includes(REFRESH) && !r.buf.toString().includes(ACCESS), `${url} leaks a token`);
  }
  const rows = await (await getDb()).query("SELECT value FROM settings").catch(() => []);
  assert.ok(rows.length > 0);
  assert.ok(rows.every((r) => !String(r.value).includes(REFRESH)), 'refresh token not stored in clear text');
});
