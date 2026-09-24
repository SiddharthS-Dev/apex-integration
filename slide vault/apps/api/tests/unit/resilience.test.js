import test from 'node:test';
import assert from 'node:assert/strict';

import { backoffDelay, Mutex, SingleFlight, mapPool, withTimeout } from '../../src/util/async.js';
import { TokenCipher, generateKey } from '../../src/crypto/tokenCipher.js';
import { redact, redactText } from '../../src/util/redact.js';
import {
  classifyResponse,
  classifyNetworkError,
  extractTag,
  DropboxAuthenticationError,
  DropboxNotFoundError,
  DropboxConflictError,
  DropboxRateLimitError,
  DropboxNetworkError,
  DropboxTimeoutError,
  DropboxApiError,
} from '../../src/integrations/dropbox/errors.js';
import { Metrics } from '../../src/services/metrics/metrics.js';

/* --------------------------------------------------------------- backoff */

test('backoffDelay grows exponentially and stops at the cap', () => {
  const options = { base: 1000, cap: 8000, jitter: false };
  assert.equal(backoffDelay(0, options), 1000);
  assert.equal(backoffDelay(1, options), 2000);
  assert.equal(backoffDelay(2, options), 4000);
  assert.equal(backoffDelay(3, options), 8000);
  assert.equal(backoffDelay(9, options), 8000, 'never exceeds the cap');
});

test('backoffDelay jitter stays between the base and the exponential value', () => {
  for (const random of [() => 0, () => 0.5, () => 0.999]) {
    const delay = backoffDelay(3, { base: 1000, cap: 16000, random });
    assert.ok(delay >= 1000 && delay <= 8000, `jittered delay ${delay} out of range`);
  }
});

/* ------------------------------------------------- concurrency primitives */

test('SingleFlight coalesces concurrent callers onto one execution', async () => {
  const flight = new SingleFlight();
  let executions = 0;

  const work = async () => {
    executions += 1;
    await new Promise((resolve) => setTimeout(resolve, 10));
    return `token-${executions}`;
  };

  // The token-refresh race: three requests find an expired token at once.
  const [a, b, c] = await Promise.all([flight.run(work), flight.run(work), flight.run(work)]);

  assert.equal(executions, 1, 'only one refresh should have been performed');
  assert.equal(a, 'token-1');
  assert.equal(b, 'token-1', 'B must reuse A’s token');
  assert.equal(c, 'token-1', 'C must reuse A’s token');
});

test('SingleFlight allows a new execution once the previous one settles', async () => {
  const flight = new SingleFlight();
  let executions = 0;
  const work = async () => (executions += 1);

  await flight.run(work);
  await flight.run(work);
  assert.equal(executions, 2);
});

test('SingleFlight propagates a failure to every waiter and then recovers', async () => {
  const flight = new SingleFlight();
  let attempt = 0;
  const work = async () => {
    attempt += 1;
    if (attempt === 1) throw new Error('refresh failed');
    return 'ok';
  };

  const results = await Promise.allSettled([flight.run(work), flight.run(work)]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[1].status, 'rejected');
  assert.equal(await flight.run(work), 'ok', 'a failed flight must not poison the next one');
});

test('Mutex serialises its callers', async () => {
  const mutex = new Mutex();
  const order = [];

  await Promise.all(
    [30, 10, 1].map((delay, index) =>
      mutex.run(async () => {
        order.push(`start-${index}`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        order.push(`end-${index}`);
      })
    )
  );

  assert.deepEqual(order, ['start-0', 'end-0', 'start-1', 'end-1', 'start-2', 'end-2']);
});

test('mapPool bounds concurrency and never rejects', async () => {
  let inFlight = 0;
  let peak = 0;

  const results = await mapPool([1, 2, 3, 4, 5, 6, 7, 8], 3, async (item) => {
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 5));
    inFlight -= 1;
    if (item === 4) throw new Error('bad file');
    return item * 2;
  });

  assert.ok(peak <= 3, `concurrency reached ${peak}, limit was 3`);
  assert.equal(results.length, 8);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 7);

  const failure = results.find((r) => r.status === 'rejected');
  assert.equal(failure.item, 4, 'the failure is attributable to its item');
  assert.equal(failure.reason.message, 'bad file');
});

test('withTimeout rejects and invokes the abort hook', async () => {
  let aborted = false;
  await assert.rejects(
    withTimeout(new Promise(() => {}), 10, { onTimeout: () => (aborted = true) }),
    (error) => error.name === 'TimeoutError'
  );
  assert.equal(aborted, true);
});

/* ------------------------------------------------------------ encryption */

test('TokenCipher round-trips a refresh token', () => {
  const cipher = new TokenCipher(generateKey());
  const token = 'sl.refresh.aVeryLongDropboxRefreshTokenValue';
  const encrypted = cipher.encrypt(token);

  assert.notEqual(encrypted, token);
  assert.ok(!encrypted.includes(token), 'the plaintext must not appear in the ciphertext');
  assert.equal(cipher.decrypt(encrypted), token);
});

test('TokenCipher produces a different ciphertext every time', () => {
  const cipher = new TokenCipher(generateKey());
  assert.notEqual(cipher.encrypt('same'), cipher.encrypt('same'), 'the IV must be fresh per encryption');
});

test('TokenCipher refuses a tampered ciphertext', () => {
  const cipher = new TokenCipher(generateKey());
  const encrypted = cipher.encrypt('secret-token');
  const parts = encrypted.split('.');
  // Flip a byte of the ciphertext; GCM must notice.
  const data = Buffer.from(parts[2], 'base64');
  data[0] ^= 0xff;
  parts[2] = data.toString('base64');

  assert.throws(() => cipher.decrypt(parts.join('.')), /could not decrypt|malformed/i);
});

test('TokenCipher refuses a value written with a different key', () => {
  const encrypted = new TokenCipher(generateKey()).encrypt('secret-token');
  assert.throws(() => new TokenCipher(generateKey()).decrypt(encrypted), /Reconnect Dropbox/);
});

test('TokenCipher rejects an undersized key', () => {
  assert.throws(() => new TokenCipher('too-short'), /32-byte key/);
});

/* -------------------------------------------------------------- redaction */

test('redact removes secrets by key, at any depth', () => {
  const redacted = redact({
    ok: true,
    nested: { refresh_token: 'sl.secret', access_token: 'sl.also-secret', root_folder: '/Decks' },
    list: [{ password: 'hunter2' }],
  });

  assert.equal(redacted.nested.refresh_token, '[redacted]');
  assert.equal(redacted.nested.access_token, '[redacted]');
  assert.equal(redacted.nested.root_folder, '/Decks', 'non-secrets survive');
  assert.equal(redacted.list[0].password, '[redacted]');
});

test('redactText removes secrets embedded in free text', () => {
  assert.match(redactText('Authorization: Bearer sl.ABCDEFGHIJKLMNOP'), /Bearer \[redacted\]/);
  assert.match(redactText('failed with token sl.AbCdEfGhIjKlMnOpQrSt'), /\[redacted\]/);
  assert.match(redactText('{"refresh_token": "sl.secretvalue"}'), /\[redacted\]/);
  assert.match(redactText('key sk-ant-api03-abcdefgh'), /\[redacted\]/);
});

test('redact handles circular structures without hanging', () => {
  const node = { name: 'a' };
  node.self = node;
  assert.equal(redact(node).self, '[circular]');
});

/* --------------------------------------------------- error classification */

test('extractTag reads Dropbox’s nested tag form', () => {
  assert.equal(extractTag({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }), 'path/not_found');
  assert.equal(extractTag({ error: { '.tag': 'expired_access_token' } }), 'expired_access_token');
  assert.equal(extractTag(null), '');
});

test('a missing scope is not mistaken for an expired token', () => {
  // Dropbox returns 401 for both. Classifying a missing scope as an expired
  // token sends the admin into a reconnect loop that can never succeed.
  const body = JSON.stringify({
    error_summary: 'missing_scope/...',
    error: { '.tag': 'missing_scope', required_scope: 'files.content.write' },
  });
  const error = classifyResponse(401, body);

  assert.ok(!(error instanceof DropboxAuthenticationError), 'must not trigger a token refresh');
  assert.equal(error.name, 'DropboxAuthorizationError');
  assert.equal(error.requiredScope, 'files.content.write');
  assert.equal(error.retryable, false);
  assert.match(error.userMessage, /files\.content\.write/);
  assert.match(error.userMessage, /App Console/);
  assert.deepEqual(error.details, { requiredScope: 'files.content.write' });
});

test('classifyResponse maps HTTP statuses onto the taxonomy', () => {
  assert.ok(classifyResponse(401, '{}') instanceof DropboxAuthenticationError);
  assert.ok(classifyResponse(500, 'boom') instanceof DropboxApiError);
  assert.equal(classifyResponse(500, 'boom').retryable, true);
  assert.equal(classifyResponse(400, '{}').retryable, false);
});

test('classifyResponse reads a 409 by its tag, not its status', () => {
  const notFound = classifyResponse(409, JSON.stringify({ error: { '.tag': 'path', path: { '.tag': 'not_found' } } }));
  assert.ok(notFound instanceof DropboxNotFoundError);

  const conflict = classifyResponse(409, JSON.stringify({ error: { '.tag': 'to', to: { '.tag': 'conflict' } } }));
  assert.ok(conflict instanceof DropboxConflictError);
});

test('classifyResponse honours Retry-After on a 429', () => {
  const error = classifyResponse(429, '{}', new Headers({ 'Retry-After': '7' }));
  assert.ok(error instanceof DropboxRateLimitError);
  assert.equal(error.retryAfterMs, 7000);
  assert.equal(error.retryable, true);
});

test('classifyNetworkError distinguishes timeouts from connection failures', () => {
  const timeout = Object.assign(new Error('aborted'), { name: 'AbortError' });
  assert.ok(classifyNetworkError(timeout) instanceof DropboxTimeoutError);

  const reset = Object.assign(new TypeError('fetch failed'), { code: 'ECONNRESET' });
  assert.ok(classifyNetworkError(reset) instanceof DropboxNetworkError);
  assert.equal(classifyNetworkError(reset).retryable, true);
});

test('a Dropbox error never leaks its raw detail to the user message', () => {
  const error = classifyResponse(401, JSON.stringify({ error_summary: 'expired_access_token/...' }));
  assert.match(error.message, /expired_access_token/, 'operators still see the detail');
  assert.doesNotMatch(error.userMessage, /expired_access_token/);
  assert.match(error.userMessage, /renewed automatically/);
});

/* ---------------------------------------------------------------- metrics */

test('Metrics renders Prometheus text with labels', () => {
  const metrics = new Metrics();
  metrics.increment('dropbox_api_requests_total', { operation: 'list_folder' });
  metrics.increment('dropbox_api_requests_total', { operation: 'list_folder' });
  metrics.increment('dropbox_api_requests_total', { operation: 'download' });
  metrics.observe('dropbox_sync_duration_seconds', 1.5, { trigger: 'manual' });

  const rendered = metrics.render();
  assert.match(rendered, /dropbox_api_requests_total\{operation="list_folder"\} 2/);
  assert.match(rendered, /dropbox_api_requests_total\{operation="download"\} 1/);
  assert.match(rendered, /dropbox_sync_duration_seconds_count\{trigger="manual"\} 1/);

  const snapshot = metrics.snapshot();
  assert.equal(snapshot.histograms.dropbox_sync_duration_seconds[0].averageSeconds, 1.5);
});
