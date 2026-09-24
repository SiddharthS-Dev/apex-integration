/**
 * Security properties, asserted over HTTP.
 *
 * These are the invariants that are easy to break with an innocent-looking
 * change, so they are pinned here rather than left to review.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, startServer, ADMIN } from '../helpers/testEnv.js';

async function connectedStack(t, files) {
  const stack = await createTestStack({ files });
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
  return { stack, http };
}

test('no endpoint returns a credential, in any shape', async (t) => {
  const { stack, http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);
  const [file] = await stack.container.files.list({ status: 'active' });

  const responses = await Promise.all([
    http.get('/api/dropbox/status'),
    http.get('/api/dropbox/health'),
    http.get('/api/dropbox/sync/logs'),
    http.get('/api/dropbox/audit'),
    http.get('/api/dropbox-config'),
    http.get('/api/presentations'),
    http.get(`/api/presentations/${file.id}`),
    http.get(`/api/dropbox/files/${file.id}/preview`),
    http.get('/api/auth/me'),
  ]);

  const forbidden = ['refresh-token-valid', 'fake-app-secret', 'fake-app-key', 'refresh_token_encrypted'];
  for (const response of responses) {
    const text = JSON.stringify(response.body ?? {});
    for (const secret of forbidden) {
      assert.ok(!text.includes(secret), `a response leaked "${secret}"`);
    }
    assert.ok(!/"access_token"/.test(text));
  }
});

test('a Dropbox temporary link never reaches a preview response', async (t) => {
  const { stack, http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);
  const [file] = await stack.container.files.list({ status: 'active' });

  const preview = await http.get(`/api/dropbox/files/${file.id}/preview`);
  assert.ok(!JSON.stringify(preview.body).includes('dropboxusercontent.com'));

  const presentation = await http.get(`/api/presentations/${file.id}`);
  assert.ok(!JSON.stringify(presentation.body).includes('dropboxusercontent.com'));
});

test('PDF content is embeddable cross-origin but not sandboxed away', async (t) => {
  const { stack, http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);
  const [file] = await stack.container.files.list({ status: 'active' });

  const response = await http.get(`/api/dropbox/files/${file.id}/content`);
  assert.equal(response.status, 200);

  // X-Frame-Options would block the viewer's iframe outright.
  assert.equal(response.headers.get('x-frame-options'), null);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors[^;]*http:\/\/localhost:5173/);
  assert.doesNotMatch(csp, /sandbox/, 'a blanket sandbox breaks the browser PDF viewer');
  assert.equal(response.headers.get('cross-origin-resource-policy'), 'cross-origin');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
});

test('synced HTML is served into an opaque origin', async (t) => {
  // A malicious .html file in the synced folder must not be able to run script
  // on the API origin and make credentialed requests back to it.
  const { stack, http } = await connectedStack(t, [
    {
      path: '/Decks/evil.html',
      content: Buffer.from('<html><script>fetch("/api/dropbox/disconnect",{method:"POST"})</script></html>'),
    },
  ]);
  const [file] = await stack.container.files.list({ status: 'active' });

  const response = await http.get(`/api/dropbox/files/${file.id}/content`);
  assert.equal(response.status, 200);

  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /^sandbox/, 'html content must be sandboxed');
  assert.doesNotMatch(csp, /allow-same-origin/, 'an opaque origin cannot make credentialed same-origin calls');
});

test('cached assets require a session', async (t) => {
  const { stack, http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);
  const [file] = await stack.container.files.list({ status: 'active' });
  const key = file.thumbnail_url.split('/').pop();

  const authorised = await http.get(`/api/assets/${key}`);
  assert.equal(authorised.status, 200);

  // A second client with no cookie jar.
  const anonymous = await startServer(stack.app);
  t.after(() => anonymous.close());
  const refused = await anonymous.get(`/api/assets/${key}`);
  assert.equal(refused.status, 401);
});

test('an asset key cannot be used to traverse out of the cache directory', async (t) => {
  const { http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);

  for (const key of ['..%2F..%2F.env', '....//....//package.json', '.env']) {
    const response = await http.get(`/api/assets/${key}`);
    assert.ok(response.status === 404 || response.status === 400, `"${key}" returned ${response.status}`);
  }
});

test('login attempts are rate limited', async (t) => {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  let limited = false;
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const response = await http.login(ADMIN.email, 'wrong-password');
    if (response.status === 429) {
      limited = true;
      break;
    }
    assert.equal(response.status, 401);
  }
  assert.ok(limited, 'repeated failed sign-ins must eventually be throttled');
});

test('a wrong password and an unknown account are indistinguishable', async (t) => {
  const stack = await createTestStack();
  const http = await startServer(stack.app);
  t.after(async () => {
    await http.close();
    await stack.close();
  });

  const wrongPassword = await http.login(ADMIN.email, 'not-the-password');
  const unknownUser = await http.login('nobody@example.com', 'not-the-password');

  assert.equal(wrongPassword.status, unknownUser.status);
  assert.deepEqual(wrongPassword.body, unknownUser.body);
});

test('a malformed id is rejected before it reaches the database', async (t) => {
  const { http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);

  for (const id of ["' OR 1=1 --", '../../etc/passwd', 'x'.repeat(200)]) {
    const response = await http.get(`/api/presentations/${encodeURIComponent(id)}`);
    assert.equal(response.status, 400, `"${id}" should be rejected as malformed`);
  }
});

test('a folder path with traversal is refused', async (t) => {
  const { http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);

  const response = await http.get(`/api/dropbox/folders?path=${encodeURIComponent('/Decks/../../Private')}`);
  assert.equal(response.status, 400);
  assert.equal(response.body.code, 'DropboxInvalidPathError');
  // The caller is told the path is invalid, not which rule it broke.
  assert.match(response.body.error, /not valid/);
});

test('logging out revokes the session immediately', async (t) => {
  const { http } = await connectedStack(t, [{ path: '/Decks/Report.pdf' }]);

  assert.equal((await http.get('/api/auth/me')).status, 200);
  await http.post('/api/auth/logout');
  assert.equal((await http.get('/api/auth/me')).status, 401);
  assert.equal((await http.get('/api/dropbox/status')).status, 401);
});
