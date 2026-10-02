import Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { HttpError, unavailable } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { invokeBase44 } from './base44.js';

// Single entry point for all LLM work (Claude via the official SDK).
//   invokeLLM({ system, prompt, schema, maxTokens, effort, images })
//     schema given  → returns the parsed JSON object (structured output via output_config.format)
//     no schema     → returns the response text
// Streaming + finalMessage() so long outputs (teaching scripts, 50-question exams) don't hit HTTP timeouts.
// Server-side refusal fallbacks are enabled (fallbacks: "default").

let client;
function getClient() {
  if (!client) client = new Anthropic({ maxRetries: 3 });
  return client;
}

export function aiEnabled() {
  return config.aiEnabled;
}

export function aiModel() {
  if (!config.aiEnabled) return null;
  return config.aiProvider === 'base44' ? `base44${config.base44.model ? `:${config.base44.model}` : ''}` : config.anthropicModel;
}

export function requireAI() {
  if (!config.aiEnabled) {
    throw unavailable(config.aiProvider === 'base44'
      ? 'AI is disabled. Set AI_ENABLED=true and BASE44_APP_ID on the API server.'
      : 'AI is disabled. Set AI_ENABLED=true and ANTHROPIC_API_KEY on the API server.');
  }
}

// Structured outputs need additionalProperties:false on every object and don't support
// numeric/string-length constraints; normalise schemas written in the looser style.
export function strictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  if (Array.isArray(schema)) return schema.map(strictSchema);
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'multipleOf', 'default'].includes(k)) continue;
    out[k] = typeof v === 'object' ? strictSchema(v) : v;
  }
  if (out.type === 'object') {
    out.additionalProperties = false;
    if (out.properties && !out.required) out.required = Object.keys(out.properties);
  }
  return out;
}

export async function invokeLLM({ system, prompt, schema, maxTokens = 32000, effort = 'high', images = [] }) {
  requireAI();
  // Base44 takes no token/effort settings; nothing here sends images.
  if (config.aiProvider === 'base44') return invokeBase44({ system, prompt, schema });
  const content = [
    ...images.map((img) => ({ type: 'image', source: { type: 'base64', media_type: img.mediaType, data: img.base64 } })),
    { type: 'text', text: prompt },
  ];
  const params = {
    model: config.anthropicModel,
    max_tokens: maxTokens,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    thinking: { type: 'adaptive' },
    output_config: {
      effort,
      ...(schema ? { format: { type: 'json_schema', schema: strictSchema(schema) } } : {}),
    },
    ...(system ? { system } : {}),
    messages: [{ role: 'user', content }],
  };

  let message;
  try {
    message = await getClient().beta.messages.stream(params).finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) throw new HttpError(429, 'AI rate limit reached — retry shortly');
    if (err instanceof Anthropic.AuthenticationError) throw unavailable('AI credentials were rejected (check ANTHROPIC_API_KEY)');
    if (err instanceof Anthropic.BadRequestError) throw new HttpError(502, `AI request rejected: ${err.message}`);
    if (err instanceof Anthropic.APIError) throw new HttpError(502, `AI service error (${err.status}): ${err.message}`);
    throw err;
  }

  if (message.stop_reason === 'refusal') {
    throw new HttpError(422, `The AI declined this request${message.stop_details?.category ? ` (${message.stop_details.category})` : ''}`);
  }
  if (message.stop_reason === 'max_tokens') {
    throw new HttpError(502, 'AI response was cut off (max_tokens reached) — try a smaller input');
  }

  const text = message.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  log.debug('ai.usage', { model: message.model, input: message.usage?.input_tokens, output: message.usage?.output_tokens });
  if (!schema) return text;
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'AI returned malformed JSON');
  }
}
