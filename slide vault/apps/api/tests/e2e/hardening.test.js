/**
 * Behaviour pinned after the gateway-integration audit: one view per open,
 * per-user detail for admins only, archived files gone for readers, stable
 * library paging, proxy-aware rate limiting and HTTP byte ranges.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, startServer } from '../helpers/testEnv.js';
import { parseTrustProxy } from '../../src/config/index.js';
import { parseRange } from '../../src/http/range.js';

const READER = { email: 'reader@example.com', password: 'reader-password-123' };
const BYTES = Buffer.from('%PDF-1.4 ' + 'abcdefghijklmnopqrstuvwxyz'.repeat(4)); // 113 bytes

/** A synced library with an admin client and a signed-in ordinary user. */
async function libraryStack(t, { files = [{ path: '/Decks/Report.pdf', content: BYTES }], configOverrides } = {}) {
  const stack = await createTestStack({ files, configOverrides });
  const admin = await startServer(stack.app);
  const reader = await startServer(stack.app);
  t.after(async () => {
    await admin.close();
    await reader.close();
    await stack.close();
  });

  await admin.login();
  await stack.container.users.create({ ...READER, fullName: 'Reader', role: 'user' });
  assert.equal((await reader.login(READER.email, READER.password)).status, 200);

  await stack.container.connections.update('dropbox', {
    refreshToken: 'refresh-token-valid',
    connection_status: 'connected',
    root_folder: '/Decks',
  });
  await stack.container.sync.run({ trigger: 'manual' });
  const rows = await stack.container.files.list({ status: 'active', sort: 'title' });
  return { stack, admin, reader, rows };
}

/* ------------------------------------------------------------- 4. views */

test('streaming content counts no view; the view endpoint counts one per open', async (t) => {
  const { stack, reader, admin, rows } = await libraryStack(t);
  const [file] = rows;

  // A viewer's several byte requests are not several views.
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await reader.get(`/api/dropbox/files/${file.id}/content`)).status, 200);
  }
  assert.equal((await stack.container.files.findById(file.id)).view_count, 0);
  assert.equal(await stack.container.analytics.findByPresentation(file.id), null);

  const first = await reader.post('/api/analytics/view', {
    presentation_id: file.id,
    reading_seconds: 40,
    completion_pct: 50,
    offline: true,
  });
  assert.equal(first.status, 200);
  assert.equal(first.body.counted, true);
  assert.equal(first.body.total_views, 1);
  assert.equal(first.body.offline_views, 1);
  assert.equal(first.body.completion_pct, 50);

  // The same reader reopening straight away is the same open.
  const again = await reader.post('/api/analytics/view', { presentation_id: file.id, reading_seconds: 5 });
  assert.equal(again.body.counted, false);
  assert.equal((await stack.container.files.findById(file.id)).view_count, 1);

  // A different viewer is a different view.
  const other = await admin.post('/api/analytics/view', { presentation_id: file.id, reading_seconds: 10 });
  assert.equal(other.body.counted, true);
  assert.equal(other.body.total_views, 2);
  assert.equal((await stack.container.files.findById(file.id)).view_count, 2);
});

test('a view is counted again once the de-duplication window has passed', async (t) => {
  const { reader, rows } = await libraryStack(t, { configOverrides: { VIEW_DEDUPE_MINUTES: '0' } });
  const [file] = rows;
  assert.equal((await reader.post('/api/analytics/view', { presentation_id: file.id })).body.counted, true);
  assert.equal((await reader.post('/api/analytics/view', { presentation_id: file.id })).body.counted, true);
});

/* -------------------------------------------------------- 6. exposure */

test('per-viewer analytics and Dropbox locations are for administrators only', async (t) => {
  const { reader, admin, rows } = await libraryStack(t);
  const [file] = rows;
  await reader.post('/api/analytics/view', { presentation_id: file.id });

  const asReader = await reader.get('/api/analytics');
  assert.equal(asReader.status, 200);
  const readerRow = asReader.body.items[0];
  assert.equal(readerRow.total_views, 1, 'the aggregate counts are still there');
  for (const field of ['viewer_ids', 'viewer_ids_json', 'last_viewed_by', 'last_viewed_by_name']) {
    assert.ok(!(field in readerRow), `a reader must not receive ${field}`);
  }

  const asAdmin = await admin.get('/api/analytics');
  assert.equal(asAdmin.body.items[0].viewer_ids.length, 1);
  assert.equal(asAdmin.body.items[0].last_viewed_by_name, 'Reader');

  for (const url of ['/api/presentations', `/api/presentations/${file.id}`, `/api/dropbox/files/${file.id}`]) {
    const body = JSON.stringify((await reader.get(url)).body);
    assert.ok(!body.includes('dropbox_path') && !body.includes('dropbox_id'), `${url} leaked a Dropbox location`);
    assert.ok(!body.includes('/Decks/'), `${url} leaked the folder path`);
  }
  const adminView = await admin.get(`/api/presentations/${file.id}`);
  assert.equal(adminView.body.dropbox_path, '/Decks/Report.pdf');
  assert.ok(adminView.body.dropbox_rev, 'the revision stays available for offline staleness checks');
});

test('/api/analytics pages with offset', async (t) => {
  const { stack, reader } = await libraryStack(t, {
    files: [{ path: '/Decks/A.pdf' }, { path: '/Decks/B.pdf' }, { path: '/Decks/C.pdf' }],
  });
  for (const file of await stack.container.files.list({ status: 'active' })) {
    await reader.post('/api/analytics/view', { presentation_id: file.id });
  }
  const first = await reader.get('/api/analytics?limit=2');
  const second = await reader.get('/api/analytics?limit=2&offset=2');
  assert.equal(first.body.items.length, 2);
  assert.equal(second.body.items.length, 1);
  const ids = [...first.body.items, ...second.body.items].map((row) => row.presentation_id);
  assert.equal(new Set(ids).size, 3, 'no row repeated or skipped across pages');
});

/* -------------------------------------------------------- 7. archived */

test('an archived file is unreadable to users — content, preview and cached assets', async (t) => {
  const { stack, reader, admin, rows } = await libraryStack(t);
  const [file] = rows;
  assert.ok(file.thumbnail_url, 'the sync cached a thumbnail');
  const asset = file.thumbnail_url;

  assert.equal((await reader.get(asset)).status, 200);
  await stack.container.files.updateById(file.id, { status: 'archived' });

  assert.equal((await reader.get(`/api/dropbox/files/${file.id}/content`)).status, 404);
  assert.equal((await reader.get(`/api/dropbox/files/${file.id}/preview`)).status, 404);
  assert.equal((await reader.get(asset)).status, 404);
  assert.equal(
    (await reader.post('/api/analytics/view', { presentation_id: file.id })).status,
    404,
    'nor can a view be recorded against it'
  );

  // An administrator can still inspect it.
  assert.equal((await admin.get(`/api/dropbox/files/${file.id}/content`)).status, 200);
  assert.equal((await admin.get(asset)).status, 200);
});

test('an asset no record points at any more is not served to users', async (t) => {
  const { stack, reader, rows } = await libraryStack(t);
  const [file] = rows;
  const asset = file.thumbnail_url;
  await stack.container.files.updateById(file.id, { thumbnail_url: '' });
  assert.equal((await reader.get(asset)).status, 404);
});

/* ----------------------------------------------------------- 9. paging */

test('the library sorts by created_date and pages without drift when views land', async (t) => {
  const { stack, reader } = await libraryStack(t, {
    files: ['A', 'B', 'C', 'D', 'E'].map((n) => ({ path: `/Decks/${n}.pdf` })),
  });

  const all = (await reader.get('/api/presentations?sort=-created_date&limit=100')).body.items;
  assert.equal(all.length, 5);
  for (let i = 1; i < all.length; i += 1) {
    assert.ok(all[i - 1].created_date >= all[i].created_date, 'newest first');
  }

  const before = await stack.container.files.findById(all[0].id);
  const page1 = (await reader.get('/api/presentations?sort=-updated_at&limit=2')).body.items;
  // Views land between page requests — they must not reorder the listing.
  for (const row of all) await reader.post('/api/analytics/view', { presentation_id: row.id });
  const page2 = (await reader.get('/api/presentations?sort=-updated_at&limit=2&offset=2')).body.items;
  const page3 = (await reader.get('/api/presentations?sort=-updated_at&limit=2&offset=4')).body.items;

  const seen = [...page1, ...page2, ...page3].map((row) => row.id);
  assert.equal(new Set(seen).size, 5, 'every deck exactly once');
  assert.equal(
    (await stack.container.files.findById(all[0].id)).updated_at,
    before.updated_at,
    'a view does not touch updated_at'
  );
});

/* ------------------------------------------------------ 10. rate limits */

test('TRUST_PROXY strings become what Express expects', () => {
  assert.equal(parseTrustProxy(undefined), false);
  assert.equal(parseTrustProxy(''), false);
  assert.equal(parseTrustProxy('true'), true);
  assert.equal(parseTrustProxy('false'), false);
  assert.equal(parseTrustProxy('1'), 1);
  assert.equal(parseTrustProxy('loopback'), 'loopback');
  assert.equal(parseTrustProxy('loopback, 10.0.0.0/8'), 'loopback, 10.0.0.0/8');
});

test('behind a trusted proxy, sign-in throttling is per client IP, not per account', async (t) => {
  const stack = await createTestStack({ configOverrides: { TRUST_PROXY: 'loopback' } });
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  const attempt = (ip) =>
    http.post('/api/auth/login', { email: 'admin@example.com', password: 'wrong-password' }, {
      headers: { 'X-Forwarded-For': ip },
    });

  let limited = false;
  for (let i = 0; i < 15 && !limited; i += 1) limited = (await attempt('203.0.113.7')).status === 429;
  assert.ok(limited, 'the attacking address is throttled');

  // The owner, from their own address, is not locked out by someone else.
  assert.equal((await attempt('198.51.100.20')).status, 401);
  const owner = await http.post(
    '/api/auth/login',
    { email: 'admin@example.com', password: 'test-admin-password' },
    { headers: { 'X-Forwarded-For': '198.51.100.20' } }
  );
  assert.equal(owner.status, 200);
});

test('without TRUST_PROXY a forged X-Forwarded-For does not dodge the limiter', async (t) => {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  let limited = false;
  for (let i = 0; i < 15 && !limited; i += 1) {
    const response = await http.post(
      '/api/auth/login',
      { email: 'admin@example.com', password: 'wrong-password' },
      { headers: { 'X-Forwarded-For': `192.0.2.${i + 1}` } }
    );
    limited = response.status === 429;
  }
  assert.ok(limited, 'a fresh forged address per request must not reset the count');
});

test('the admin limiter does not throttle readers opening files', async (t) => {
  const { reader, admin, rows } = await libraryStack(t, {
    configOverrides: { RATE_LIMIT_ADMIN_MAX_REQUESTS: '3' },
  });
  const [file] = rows;

  for (let i = 0; i < 6; i += 1) {
    assert.equal((await reader.get(`/api/dropbox/files/${file.id}/preview`)).status, 200);
    assert.equal((await reader.get(`/api/dropbox/files/${file.id}/content`)).status, 200);
  }

  let limited = false;
  for (let i = 0; i < 6 && !limited; i += 1) limited = (await admin.get('/api/dropbox/status')).status === 429;
  assert.ok(limited, 'administrative routes keep their tighter budget');
});

/* ------------------------------------------------------------ ranges */

test('parseRange covers the forms a browser sends', () => {
  assert.equal(parseRange(undefined, 100), null);
  assert.deepEqual(parseRange('bytes=0-9', 100), { start: 0, end: 9 });
  assert.deepEqual(parseRange('bytes=90-', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=95-500', 100), { start: 95, end: 99 });
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=0-1,5-6', 100), null, 'multi-range falls back to the whole file');
  assert.equal(parseRange('items=0-1', 100), null);
});

test('content streaming honours byte ranges, from Dropbox or sliced locally', async (t) => {
  const { stack, reader, rows } = await libraryStack(t);
  const [file] = rows;
  const url = `/api/dropbox/files/${file.id}/content`;

  const whole = await reader.get(url);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal(Buffer.from(await whole.response.arrayBuffer()).length, BYTES.length);

  const part = await reader.get(url, { headers: { Range: 'bytes=9-18' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 9-18/${BYTES.length}`);
  assert.equal(part.headers.get('content-length'), '10');
  assert.deepEqual(Buffer.from(await part.response.arrayBuffer()), BYTES.subarray(9, 19));
  assert.equal(stack.dropbox.state.calls.at(-1).range, 'bytes=9-18', 'the range was asked of Dropbox');

  // A server that ignores Range: the API cuts the range out itself.
  stack.dropbox.state.behavior.ignoreRange = true;
  const tail = await reader.get(url, { headers: { Range: 'bytes=-5' } });
  assert.equal(tail.status, 206);
  assert.equal(tail.headers.get('content-range'), `bytes ${BYTES.length - 5}-${BYTES.length - 1}/${BYTES.length}`);
  assert.deepEqual(Buffer.from(await tail.response.arrayBuffer()), BYTES.subarray(-5));

  const past = await reader.get(url, { headers: { Range: `bytes=${BYTES.length + 10}-` } });
  assert.equal(past.status, 416);
  assert.equal(past.headers.get('content-range'), `bytes */${BYTES.length}`);
});

test('cached assets honour byte ranges', async (t) => {
  const { reader, rows } = await libraryStack(t);
  const [file] = rows;
  const whole = await reader.get(file.thumbnail_url);
  const bytes = Buffer.from(await whole.response.arrayBuffer());
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');

  const part = await reader.get(file.thumbnail_url, { headers: { Range: 'bytes=2-5' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), `bytes 2-5/${bytes.length}`);
  assert.deepEqual(Buffer.from(await part.response.arrayBuffer()), bytes.subarray(2, 6));

  const past = await reader.get(file.thumbnail_url, { headers: { Range: `bytes=${bytes.length}-` } });
  assert.equal(past.status, 416);
});

/* ------------------------------------------------------------- copilot */

test('the Copilot is advertised and answers only when AI is configured', async (t) => {
  const { reader } = await libraryStack(t);
  assert.equal((await reader.get('/api/auth/config')).body.ai, false);
  const response = await reader.post('/api/ai/copilot', { question: 'Anything on reports?' });
  assert.equal(response.status, 503);
});

test('the Copilot builds its own prompt and returns catalog picks', async (t) => {
  let seen = null;
  const aiProvider = {
    available: true,
    async complete(request) {
      seen = request;
      return '{"reply": "Try **Report**.", "picks": [1, 99]}';
    },
    async completeWithImage() {
      return '';
    },
  };
  const stack = await createTestStack({
    files: [{ path: '/Decks/Report.pdf' }],
    aiProvider,
    configOverrides: { AI_ENABLED: 'true' },
  });
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
  await stack.container.sync.run({ trigger: 'manual' });

  assert.equal((await http.get('/api/auth/config')).body.ai, true);
  const response = await http.post('/api/ai/copilot', { question: 'Reports?', history: [{ role: 'user', content: 'hi' }] });
  assert.equal(response.status, 200);
  assert.equal(response.body.reply, 'Try **Report**.');
  assert.equal(response.body.picks.length, 1, 'an out-of-range pick is dropped');
  assert.match(seen.prompt, /\[1\] "Report"/);
  assert.match(seen.prompt, /Reports\?/);
});
