/**
 * Retry, backoff and failure handling on the live request path.
 *
 * Every scenario the spec lists under "failure testing" that concerns the
 * transport: expired token, rate limit, server error, network reset, timeout,
 * and the bound on retries.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { createTestStack, connectDropbox } from '../helpers/testEnv.js';
import { M } from '../../src/services/metrics/metrics.js';
import {
  DropboxNotFoundError,
  DropboxRateLimitError,
  DropboxNetworkError,
  DropboxApiError,
} from '../../src/integrations/dropbox/errors.js';

const FILES = [{ path: '/Decks/Quarterly Review.pdf' }];

const counterValue = (metrics, name, match = () => true) =>
  (metrics.snapshot().counters[name] ?? [])
    .filter((entry) => match(entry.labels))
    .reduce((sum, entry) => sum + entry.value, 0);

test('a 401 refreshes the token once and replays the request', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  await stack.container.auth.getValidAccessToken();
  const refreshesBefore = stack.dropbox.state.tokenRefreshCount;

  // The next call finds the access token expired, exactly as Dropbox would
  // report after a revocation or a clock skew.
  stack.dropbox.state.behavior.expireNextAccessToken = true;
  const account = await stack.container.client.getCurrentAccount();

  assert.equal(account.email, 'avery.raman@inspironics.net', 'the request succeeded after recovery');
  assert.equal(stack.dropbox.state.tokenRefreshCount, refreshesBefore + 1, 'exactly one extra refresh');
  assert.equal(counterValue(stack.metrics, M.apiRetries, (l) => l.reason === 'unauthorized'), 1);
});

test('a missing scope fails fast instead of refreshing and retrying', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);
  await stack.container.auth.getValidAccessToken();

  const refreshesBefore = stack.dropbox.state.tokenRefreshCount;

  // Dropbox's shape when a permission was never granted in the App Console.
  const realFetch = stack.container.executor.fetch;
  stack.container.executor.fetch = async (url, options) => {
    if (String(url).includes('files/move_v2')) {
      return new Response(
        JSON.stringify({
          error_summary: 'missing_scope/...',
          error: { '.tag': 'missing_scope', required_scope: 'files.content.write' },
        }),
        { status: 401, headers: { 'Content-Type': 'application/json' } }
      );
    }
    return realFetch(url, options);
  };

  await assert.rejects(stack.container.client.move('/Decks/a.pdf', '/Decks/b.pdf'), (error) => {
    assert.equal(error.name, 'DropboxAuthorizationError');
    assert.equal(error.requiredScope, 'files.content.write');
    return true;
  });

  assert.equal(
    stack.dropbox.state.tokenRefreshCount,
    refreshesBefore,
    'a missing scope must not burn a token refresh'
  );
  assert.equal(counterValue(stack.metrics, M.apiRequests, (l) => l.operation === 'move'), 1);
});

test('a 429 is retried after the Retry-After delay', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.rateLimitTimes = 2;
  stack.dropbox.state.behavior.retryAfterSeconds = 0; // keep the test fast

  const page = await stack.container.client.listFolder('');
  assert.ok(Array.isArray(page.entries));
  assert.equal(counterValue(stack.metrics, M.apiRetries, (l) => l.reason === 'rate_limit'), 2);
});

test('a 5xx is retried', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.serverErrorTimes = 2;
  const page = await stack.container.client.listFolder('');

  assert.ok(page.entries.length >= 1);
  assert.equal(counterValue(stack.metrics, M.apiRetries, (l) => l.reason === 'server_error'), 2);
});

test('a dropped connection is retried', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.networkErrorTimes = 2;
  const page = await stack.container.client.listFolder('');
  assert.ok(page.entries.length >= 1);
});

test('retries are bounded — a permanently failing endpoint gives up', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false, configOverrides: { DROPBOX_MAX_RETRIES: '3' } });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.serverErrorTimes = 99;

  await assert.rejects(stack.container.client.listFolder(''), (error) => {
    assert.ok(error instanceof DropboxApiError);
    assert.equal(error.retryable, true);
    return true;
  });

  // Three attempts, not an unbounded loop.
  assert.equal(counterValue(stack.metrics, M.apiRequests, (l) => l.operation === 'list_folder'), 3);
});

test('a rate limit that never clears gives up rather than looping forever', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false, configOverrides: { DROPBOX_MAX_RETRIES: '2' } });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.rateLimitTimes = 99;
  await assert.rejects(stack.container.client.listFolder(''), DropboxRateLimitError);
  assert.equal(counterValue(stack.metrics, M.apiRequests, (l) => l.operation === 'list_folder'), 2);
});

test('a persistent network failure is classified, not swallowed', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false, configOverrides: { DROPBOX_MAX_RETRIES: '2' } });
  t.after(() => stack.close());
  await connectDropbox(stack);

  stack.dropbox.state.behavior.networkErrorTimes = 99;
  await assert.rejects(stack.container.client.listFolder(''), DropboxNetworkError);
});

test('a non-retryable error fails immediately', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  await assert.rejects(stack.container.client.listFolder('/Does Not Exist'), DropboxNotFoundError);
  // One attempt: retrying a missing folder would only waste quota.
  assert.equal(counterValue(stack.metrics, M.apiRequests, (l) => l.operation === 'list_folder'), 1);
});

test('pagination follows the cursor to the end', async (t) => {
  const files = Array.from({ length: 25 }, (_, index) => ({ path: `/Decks/Deck ${index + 1}.pdf` }));
  const stack = await createTestStack({ files, withApp: false });
  t.after(() => stack.close());
  await connectDropbox(stack);

  // Force Dropbox to answer in small pages.
  stack.dropbox.state.behavior.pageSize = 4;

  const seen = [];
  for await (const entry of stack.container.client.iterateFolder('/Decks', { recursive: true })) {
    if (entry['.tag'] === 'file') seen.push(entry.name);
  }

  assert.equal(seen.length, 25, 'every page must be walked, not just the first');
  assert.ok(stack.dropbox.callsTo('list_folder/continue').length >= 6);
});

test('a non-ASCII filename does not break the content headers', async (t) => {
  const stack = await createTestStack({
    files: [{ path: '/Decks/Übersicht Präsentation.pdf' }],
    withApp: false,
  });
  t.after(() => stack.close());
  await connectDropbox(stack);

  // The Dropbox-API-Arg header must be ASCII, or fetch rejects the request.
  const object = await stack.container.provider.download('/Decks/Übersicht Präsentation.pdf');
  assert.ok((await object.buffer()).length > 0);
});

test('the executor never puts a token in an error message', async (t) => {
  const stack = await createTestStack({ files: FILES, withApp: false, configOverrides: { DROPBOX_MAX_RETRIES: '1' } });
  t.after(() => stack.close());
  await connectDropbox(stack);

  const token = await stack.container.auth.getValidAccessToken();
  stack.dropbox.state.behavior.serverErrorTimes = 99;

  await assert.rejects(stack.container.client.listFolder(''), (error) => {
    assert.ok(!error.message.includes(token));
    assert.ok(!JSON.stringify(error.toPublic()).includes(token));
    return true;
  });
});
