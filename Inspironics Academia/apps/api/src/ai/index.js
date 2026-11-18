import crypto from 'node:crypto';
import { config } from '../config.js';
import { deleteObject, getObject, objectKey, putObject } from '../files/objectStore.js';
import { HttpError, unavailable } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { currentGeneration } from '../usage/context.js';
import { assertWithinLimits } from '../usage/limits.js';
import { recordGeneration } from '../usage/log.js';
import { aiCost } from '../usage/pricing.js';
import gemini from './providers/gemini.js';
import ollama from './providers/ollama.js';
import { checkShape } from './schema.js';


// The AI provider router: the single entry point for AI text generation.
//   invokeLLM({ system, prompt, schema, maxTokens, effort, images, provider? })
//     schema given  → the parsed JSON object (checked against the schema's shape)
//     no schema     → the response text
// AI_PROVIDER picks the provider (gemini | ollama | none); AI_FALLBACK_PROVIDER, when set,
// takes over on availability errors (rate limit, outage, bad credentials) — logged, never silent.
// Every call is checked against the usage limits, answered from the content cache when an identical
// request was made before (unless the caller asks for a fresh answer), and recorded in the
// generation log with its tokens and estimated cost.

export const PROVIDERS = { gemini, ollama };

export function providerReady(name) {
  return !!PROVIDERS[name]?.ready();
}

/** Providers that can be chosen per request (configured with keys/models). */
export function availableProviders() {
  return Object.keys(PROVIDERS).filter(providerReady).map((name) => ({ name, model: PROVIDERS[name].model() }));
}

export function aiEnabled() {
  return config.aiEnabled;
}

export function aiModel() {
  if (!config.aiEnabled) return null;
  const p = PROVIDERS[config.aiProvider];
  return p ? `${config.aiProvider}:${p.model()}` : null;
}

const KEY_NAMES = { gemini: 'GEMINI_API_KEY', ollama: 'OLLAMA_BASE_URL and OLLAMA_MODEL' };

/** Why AI is unavailable, naming the setting to change (never its value); null when AI is on. */
export function aiUnavailableReason() {
  if (config.aiEnabled) return null;
  const asked = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (asked && asked !== 'none' && config.aiProvider === 'none') return `AI_PROVIDER=${asked} is not supported (use gemini, ollama or none).`;
  if (config.aiProvider === 'none') return 'AI is turned off (AI_PROVIDER=none).';
  if (!/^(1|true|yes|on)$/i.test(String(process.env.AI_ENABLED ?? '').trim())) return 'AI is turned off (AI_ENABLED=false).';
  if (!providerReady(config.aiProvider)) {
    return `AI is not configured: AI_PROVIDER=${config.aiProvider} but ${KEY_NAMES[config.aiProvider] || 'its credentials'} is not set on the API server.`;
  }
  return 'AI is not configured on the API server.';
}

export function requireAI() {
  if (!config.aiEnabled) throw unavailable(`${aiUnavailableReason()} See AI_PROVIDER_SETUP.md.`);
}

/** Startup check: what is configured, what is missing. Never logs secrets. */
export function describeAiConfig() {
  return {
    provider: config.aiProvider,
    enabled: config.aiEnabled,
    ready: providerReady(config.aiProvider),
    model: PROVIDERS[config.aiProvider]?.model() || null,
    fallback: config.aiFallbackProvider || null,
    fallbackReady: config.aiFallbackProvider ? providerReady(config.aiFallbackProvider) : null,
  };
}

// Fallback is for the provider being unavailable (rate limit, outage, missing/rejected credentials),
// never for a bad request, a refusal or malformed output — those would fail the same way elsewhere.
const isAvailabilityError = (err) => !!err?.details?.retryable || [429, 503, 504].includes(err?.status);

function parseJson(text, providerName) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    throw new HttpError(502, `The AI (${providerName}) returned malformed JSON`, { malformed: true });
  }
}

const cacheKeyOf = (providerName, model, req) => objectKey('ai-cache', crypto.createHash('sha256')
  .update(JSON.stringify([providerName, model, req.system || '', req.prompt, req.schema || null, req.maxTokens || null, req.effort || null, (req.images || []).map((i) => crypto.createHash('sha256').update(i.base64 || '').digest('hex'))]))
  .digest('hex'));

async function callProvider(name, req) {
  const provider = PROVIDERS[name];
  if (!provider) throw unavailable(`Unknown AI provider "${name}"`);
  if (!provider.ready()) throw unavailable(`The ${name} AI provider is not configured on the API server`);
  const model = provider.model();
  const ctx = currentGeneration();
  const useCache = config.ai.contentCache && !ctx.fresh && !req.fresh;
  const key = cacheKeyOf(name, model, req);

  if (useCache) {
    const hit = await getObject(key).catch(() => null);
    if (hit) {
      await recordGeneration({ kind: 'ai', provider: name, model, status: 'cached' });
      const { text } = JSON.parse(hit.toString('utf8'));
      // A cached answer that no longer validates is dropped, so a retry asks the provider again.
      return { text, providerName: name, cached: true, save: async () => {}, drop: () => deleteObject(key).catch(() => {}) };
    }
  }

  await assertWithinLimits('ai', { provider: name });
  const started = Date.now();
  try {
    const out = await provider.generate(req);
    await recordGeneration({
      kind: 'ai', provider: name, model: out.model || model, status: 'ok',
      input_tokens: out.usage.input_tokens + (out.usage.cache_read_tokens || 0) + (out.usage.cache_write_tokens || 0),
      output_tokens: out.usage.output_tokens, cost_usd: aiCost(name, out.model || model, out.usage), duration_ms: Date.now() - started,
    });
    // Cached only once the caller has validated it (see invokeLLM): a malformed answer is never reused.
    const save = async () => {
      if (config.ai.contentCache) await putObject(key, Buffer.from(JSON.stringify({ text: out.text })), { source: 'ai-cache', provider: name, model }).catch(() => {});
    };
    return { text: out.text, providerName: name, cached: false, save, drop: async () => {} };
  } catch (err) {
    await recordGeneration({
      kind: 'ai', provider: name, model, status: 'error', error: err.message, duration_ms: Date.now() - started,
      input_tokens: err.usage?.input_tokens, output_tokens: err.usage?.output_tokens, cost_usd: err.usage ? aiCost(name, model, err.usage) : null,
    });
    throw err;
  }
}

export async function invokeLLM({ system, prompt, schema, maxTokens = 32000, effort = 'high', images = [], provider, fresh = false } = {}) {
  requireAI();
  const primary = provider && PROVIDERS[provider] ? provider : config.aiProvider;
  const req = { system, prompt, schema, maxTokens, effort, images, fresh };
  let result;
  try {
    result = await callProvider(primary, req);
  } catch (err) {
    const fallback = config.aiFallbackProvider;
    if (!fallback || fallback === primary || !providerReady(fallback) || err.code === 'usage_limit' || !isAvailabilityError(err)) throw err;
    log.warn('ai.fallback', { from: primary, to: fallback, reason: err.message });
    result = await callProvider(fallback, req);
  }
  if (!schema) {
    await result.save();
    return result.text;
  }
  let value;
  try {
    value = parseJson(result.text, result.providerName);
  } catch (err) {
    await result.drop();
    throw err;
  }
  const problems = checkShape(schema, value);
  if (problems.length) {
    log.warn('ai.output_shape_mismatch', { provider: result.providerName, problems: problems.slice(0, 5) });
    await result.drop();
    throw new HttpError(502, `The AI returned output in an unexpected format (${problems[0]})`, { malformed: true });
  }
  await result.save();
  return value;
}
