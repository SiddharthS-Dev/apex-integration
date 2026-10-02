import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

// Base44 AI provider against a local stand-in for the Base44 API. No real network.

const calls = [];
let issued = 0;
let expireNext = false;
const server = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : null;
    calls.push({ url: req.url, auth: req.headers.authorization, appId: req.headers['x-app-id'], body });
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/api/apps/app-123/auth/login') {
      if (body.password !== 'pw') return send(401, { message: 'Invalid credentials' });
      issued += 1;
      return send(200, { access_token: `tok-${issued}`, user: { email: body.email } });
    }
    if (req.url === '/api/apps/app-123/integration-endpoints/Core/InvokeLLM') {
      if (expireNext) { expireNext = false; return send(401, { message: 'expired' }); }
      if (req.headers.authorization !== `Bearer tok-${issued}`) return send(401, { message: 'bad token' });
      return send(200, body.response_json_schema ? { title: 'Lesson', echo: body.prompt } : 'plain text answer');
    }
    return send(404, {});
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
after(() => server.close());

Object.assign(process.env, {
  AI_ENABLED: 'true',
  AI_PROVIDER: 'base44',
  BASE44_SERVER_URL: `http://127.0.0.1:${server.address().port}/`,
  BASE44_APP_ID: 'app-123',
  BASE44_EMAIL: 'admin@example.com',
  BASE44_PASSWORD: 'pw',
});
const { invokeLLM, aiEnabled, aiModel } = await import('../src/ai/claude.js');

test('base44 provider is enabled by its own credentials', () => {
  assert.equal(aiEnabled(), true);
  assert.equal(aiModel(), 'base44');
});

test('signs in once, then returns structured output for a schema', async () => {
  const out = await invokeLLM({ system: 'SYS', prompt: 'Teach X', schema: { type: 'object' } });
  assert.deepEqual(out, { title: 'Lesson', echo: 'SYS\n\nTeach X' });
  const invoke = calls.find((c) => c.url.endsWith('/InvokeLLM'));
  assert.equal(invoke.appId, 'app-123');
  assert.equal(invoke.auth, 'Bearer tok-1');
  await invokeLLM({ prompt: 'again', schema: { type: 'object' } });
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 1);
});

test('returns text when no schema is given', async () => {
  assert.equal(await invokeLLM({ prompt: 'hi' }), 'plain text answer');
});

test('re-signs in once when the session has expired', async () => {
  expireNext = true;
  const out = await invokeLLM({ prompt: 'p', schema: { type: 'object' } });
  assert.equal(out.title, 'Lesson');
  assert.equal(calls.filter((c) => c.url.endsWith('/auth/login')).length, 2);
});
