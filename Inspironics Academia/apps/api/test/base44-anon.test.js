import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Base44 AI provider with no BASE44_EMAIL/PASSWORD: calls InvokeLLM without signing in.

const seen = [];
let requireAuth = false;
const server = http.createServer((req, res) => {
  seen.push({ url: req.url, auth: req.headers.authorization });
  req.resume();
  req.on('end', () => {
    res.writeHead(requireAuth ? 401 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(requireAuth ? { message: 'login required' } : 'ok'));
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());

Object.assign(process.env, {
  AI_ENABLED: 'true',
  AI_PROVIDER: 'base44',
  BASE44_SERVER_URL: `http://127.0.0.1:${server.address().port}`,
  BASE44_APP_ID: 'app-anon',
  BASE44_EMAIL: '',
  BASE44_PASSWORD: '',
});
const { invokeLLM, aiEnabled } = await import('../src/ai/claude.js');

test('app ID alone enables the provider and calls without signing in', async () => {
  assert.equal(aiEnabled(), true);
  assert.equal(await invokeLLM({ prompt: 'hi' }), 'ok');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/api/apps/app-anon/integration-endpoints/Core/InvokeLLM');
  assert.equal(seen[0].auth, undefined);
});

test('explains that sign-in is needed when the app rejects anonymous calls', async () => {
  requireAuth = true;
  await assert.rejects(invokeLLM({ prompt: 'hi' }), (err) => err.status === 503 && /BASE44_EMAIL/.test(err.message));
});
