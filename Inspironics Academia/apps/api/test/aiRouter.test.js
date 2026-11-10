import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { after, before, test } from 'node:test';

// The AI provider router with mocked provider APIs (no paid calls): Gemini (primary) and Ollama
// (an explicitly configured fallback), the content cache, usage logging with cost estimates,
// output-shape checks and usage limits.

const calls = [];
const behaviour = { gemini: 'ok', geminiSchemaRejected: false };
const realFetch = globalThis.fetch;

globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  if (u.startsWith('https://generativelanguage.googleapis.com/')) {
    const headers = init.headers || {};
    calls.push({ provider: 'gemini', url: u, body, key: headers['x-goog-api-key'] });
    if (behaviour.gemini === 'down') return new Response(JSON.stringify({ error: { message: 'This model is currently experiencing high demand.' } }), { status: 503 });
    if (behaviour.geminiSchemaRejected && body.generationConfig.responseFormat?.text?.schema) return new Response(JSON.stringify({ error: { message: 'Invalid schema' } }), { status: 400 });
    const wantsJson = body.generationConfig.responseFormat?.text?.mimeType === 'APPLICATION_JSON' || /JSON schema/.test(body.contents[0].parts.at(-1).text);
    const json = behaviour.gemini === 'badshape' ? { title: 42 } : { title: 'From Gemini', items: ['x'] };
    const text = wantsJson ? JSON.stringify(json) : 'Plain answer from Gemini';
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 400, thoughtsTokenCount: 100 }, modelVersion: 'gemini-3.8-flash' }), { status: 200 });
  }
  if (u.startsWith('http://ollama.local')) {
    calls.push({ provider: 'ollama', body });
    return new Response(JSON.stringify({ model: 'llama-test', message: { content: JSON.stringify({ title: 'From Ollama', items: [] }) }, prompt_eval_count: 30, eval_count: 10 }), { status: 200 });
  }
  return realFetch(url, init);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-ai-router-'));
delete process.env.GEMINI_MODEL;
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  AI_ENABLED: 'true', AI_PROVIDER: 'gemini', AI_FALLBACK_PROVIDER: 'ollama', GEMINI_API_KEY: 'gm-test', GEMINI_MAX_ATTEMPTS: '1',
  OLLAMA_BASE_URL: 'http://ollama.local', OLLAMA_MODEL: 'llama-test',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const ai = await import('../src/ai/index.js');
const { runWithGeneration } = await import('../src/usage/context.js');
const { setLimits } = await import('../src/usage/limits.js');
const SCHEMA = { type: 'object', properties: { title: { type: 'string' }, items: { type: 'array', items: { type: 'string' } } } };

before(async () => { await migrate(await getDb()); });
after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

const logRows = () => db().query('SELECT * FROM generation_log ORDER BY created_at');

test('configuration: Gemini primary, Ollama fallback, Anthropic not offered, keys never exposed', () => {
  assert.deepEqual(ai.describeAiConfig(), { provider: 'gemini', enabled: true, ready: true, model: 'gemini-3.8-flash', fallback: 'ollama', fallbackReady: true });
  assert.equal(ai.aiModel(), 'gemini:gemini-3.8-flash');
  assert.deepEqual(Object.keys(ai.PROVIDERS), ['gemini', 'ollama']);
  assert.deepEqual(ai.availableProviders().map((p) => p.name), ['gemini', 'ollama']);
  assert.ok(!JSON.stringify(ai.describeAiConfig()).includes('gm-test'));
});

test('Gemini: structured output, usage logged with an estimated cost', async () => {
  const out = await runWithGeneration({ operation: 'generateLessonContent', userId: 'u1' }, () => ai.invokeLLM({ system: 'S', prompt: 'Teach caching', schema: SCHEMA }));
  assert.deepEqual(out, { title: 'From Gemini', items: ['x'] });
  const req = calls.at(-1);
  assert.equal(req.key, 'gm-test', 'the key goes in a header');
  assert.ok(!req.url.includes('gm-test'), 'never in the URL');
  assert.equal(req.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON', 'documented REST structured-output form');
  assert.deepEqual(req.body.generationConfig.responseFormat.text.schema, { ...SCHEMA, required: ['title', 'items'] });
  const [row] = await logRows();
  assert.equal(row.kind, 'ai');
  assert.equal(row.provider, 'gemini');
  assert.equal(row.operation, 'generateLessonContent');
  assert.equal(row.user_id, 'u1');
  assert.equal(row.input_tokens, 1000);
  assert.equal(row.output_tokens, 500, 'thinking tokens count as output');
  assert.ok(row.cost_usd > 0);
});

test('the content cache answers an identical request for free; a regenerate (fresh) asks again', async () => {
  const before = calls.length;
  assert.deepEqual(await ai.invokeLLM({ system: 'S', prompt: 'Teach caching', schema: SCHEMA }), { title: 'From Gemini', items: ['x'] });
  assert.equal(calls.length, before, 'no provider call');
  assert.equal((await logRows()).at(-1).status, 'cached');
  await runWithGeneration({ fresh: true }, () => ai.invokeLLM({ system: 'S', prompt: 'Teach caching', schema: SCHEMA }));
  assert.equal(calls.length, before + 1);
});

test('text answers, and a per-request provider choice (Ollama)', async () => {
  assert.equal(await ai.invokeLLM({ prompt: 'Say hi' }), 'Plain answer from Gemini');
  assert.deepEqual(await ai.invokeLLM({ prompt: 'Ollama please', schema: SCHEMA, provider: 'ollama' }), { title: 'From Ollama', items: [] });
  assert.deepEqual(calls.at(-1).body.format, SCHEMA);
  assert.equal((await logRows()).find((r) => r.provider === 'ollama').cost_usd, 0, 'self-hosted');
});

test('Gemini rejects the schema: the request is repeated with the schema in the prompt', async () => {
  behaviour.geminiSchemaRejected = true;
  try {
    assert.deepEqual(await ai.invokeLLM({ prompt: 'Schema fallback', schema: SCHEMA }), { title: 'From Gemini', items: ['x'] });
    const last = calls.at(-1);
    assert.equal(last.body.generationConfig.responseFormat, undefined);
    assert.match(last.body.contents[0].parts.at(-1).text, /matching this JSON schema/);
  } finally {
    behaviour.geminiSchemaRejected = false;
  }
});

test('an explicitly configured fallback: Gemini overloaded → Ollama answers, and the switch is logged', async () => {
  behaviour.gemini = 'down';
  try {
    const out = await ai.invokeLLM({ prompt: 'Fallback please', schema: SCHEMA });
    assert.equal(out.title, 'From Ollama');
    const rows = (await logRows()).slice(-2);
    assert.deepEqual(rows.map((r) => [r.provider, r.status]), [['gemini', 'error'], ['ollama', 'ok']]);
  } finally {
    behaviour.gemini = 'ok';
  }
});

test('output that does not match the schema is rejected, not saved or cached', async () => {
  behaviour.gemini = 'badshape';
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Bad shape', schema: SCHEMA }), /unexpected format \(\$\.title should be a string\)/);
  } finally {
    behaviour.gemini = 'ok';
  }
  const before = calls.length;
  assert.deepEqual(await ai.invokeLLM({ prompt: 'Bad shape', schema: SCHEMA }), { title: 'From Gemini', items: ['x'] });
  assert.equal(calls.length, before + 1, 'the bad answer was not cached');
});

test('usage limits: the daily request limit stops new paid calls (cache hits still work)', async () => {
  const done = (await db().query("SELECT count(*) n FROM generation_log WHERE kind = 'ai' AND status = 'ok'"))[0].n;
  await setLimits({ aiDailyRequests: done });
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Over the limit' }), (err) => err.status === 429 && /daily AI request limit/.test(err.message));
    assert.equal((await logRows()).at(-1).status, 'blocked');
    assert.equal((await ai.invokeLLM({ prompt: 'Say hi' })), 'Plain answer from Gemini', 'a cached answer is not a paid call');
  } finally {
    await setLimits({ aiDailyRequests: null });
  }
});

test('a monthly budget stops calls once the estimated spend reaches it', async () => {
  await setLimits({ aiMonthlyBudgetUsd: 0.0001 });
  try {
    await assert.rejects(ai.invokeLLM({ prompt: 'Budget exceeded' }), /monthly AI budget/);
  } finally {
    await setLimits({ aiMonthlyBudgetUsd: null });
  }
  await assert.rejects(setLimits({ aiMonthlyBudgetUsd: -5 }), /non-negative/);
});

test('AI_PROVIDER=anthropic is no longer supported and says so', () => {
  const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', "const a = await import('./src/ai/index.js'); console.log(JSON.stringify({ on: a.aiEnabled(), why: a.aiUnavailableReason() }))"], {
    cwd: api, encoding: 'utf8', env: { ...process.env, AI_PROVIDER: 'anthropic', AI_ENABLED: 'true', LOG_LEVEL: 'error' },
  });
  const out = JSON.parse(r.stdout.trim().split('\n').at(-1));
  assert.equal(out.on, false);
  assert.match(out.why, /AI_PROVIDER=anthropic is not supported/);
});
