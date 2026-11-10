import { config } from '../../config.js';
import { HttpError, unavailable } from '../../lib/errors.js';
import { requireAllFields } from '../schema.js';
import { postJson } from './http.js';

// Google Gemini through its REST API (models/{model}:generateContent, header x-goog-api-key — the key
// never goes in a URL). Structured output uses the documented REST form
//   generationConfig.responseFormat.text = { mimeType: 'APPLICATION_JSON', schema: <JSON Schema> }
// (https://ai.google.dev/gemini-api/docs/structured-output, checked 2026-11-10). If the API rejects a
// schema (400), the request is repeated once with the schema stated in the prompt; the router validates
// the JSON either way. Retries with backoff for 429/5xx/network errors come from postJson.

const finishProblem = {
  MAX_TOKENS: [502, 'Gemini stopped early: the maximum output length was reached — try a smaller input'],
  SAFETY: [422, 'Gemini declined this request (safety filter)'],
  PROHIBITED_CONTENT: [422, 'Gemini declined this request (prohibited content)'],
  RECITATION: [422, 'Gemini declined this request (recitation)'],
  BLOCKLIST: [422, 'Gemini declined this request (blocklist)'],
  SPII: [422, 'Gemini declined this request (sensitive personal information)'],
};

/** A clear, actionable error for the failures people actually hit (never includes the key). */
export function geminiError(err) {
  const status = err?.details?.upstreamStatus;
  const text = String(err?.message || '');
  if (status === 400 && /api key not valid|api_key_invalid|invalid api key/i.test(text)) {
    return unavailable('Gemini rejected the API key (check GEMINI_API_KEY on the API server)');
  }
  if (status === 401 || status === 403) {
    return unavailable(`Gemini refused access (${status}): check that GEMINI_API_KEY is valid and the Generative Language API is enabled for its project`);
  }
  if (status === 429) {
    // Google names the quota that ran out. A daily quota (e.g. the free tier's requests per day per
    // model) does not clear by waiting a minute: report it as such so callers stop instead of retrying.
    const daily = /per\s*day|PerDay/i.test(text);
    const limit = (/limit:\s*(\d+)/i.exec(text) || [])[1];
    const model = (/model:\s*([\w.-]+)/i.exec(text) || [])[1];
    const freeTier = /free.?tier/i.test(text);
    if (daily) {
      return new HttpError(429, `Gemini daily quota reached${model ? ` for ${model}` : ''}${limit ? ` (${limit} requests per day${freeTier ? ' on the free tier' : ''})` : ''} — it resets daily; enable billing on the Google AI Studio project for higher limits`, { retryable: false, quotaDaily: true, upstreamStatus: 429 });
    }
    return new HttpError(429, 'Gemini rate limit reached — wait a minute and retry (see the rate limits of your Google AI Studio project)', { retryable: true, upstreamStatus: 429 });
  }
  if (status === 404) {
    return new HttpError(502, `Gemini does not know the model "${config.ai.gemini.model}" (check GEMINI_MODEL against https://ai.google.dev/gemini-api/docs/models)`, { upstreamStatus: 404 });
  }
  if (status === 503 || status === 500 || status === 504) {
    return new HttpError(503, `Gemini is temporarily overloaded or unavailable (${status}) — this is on Google's side; retry in a few minutes`, { retryable: true, upstreamStatus: status, overloaded: true });
  }
  return err;
}

export async function geminiPost(model, body, { timeoutMs = config.ai.gemini.timeoutMs } = {}) {
  const { apiKey, baseUrl } = config.ai.gemini;
  if (!apiKey) throw unavailable('Gemini is not configured: GEMINI_API_KEY is not set on the API server');
  const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`;
  try {
    // Demand spikes (503) and rate limits (429) usually clear within seconds: 5 attempts with
    // exponential backoff (about 15 s in all, longer when Google sends Retry-After).
    return await postJson(url, body, { headers: { 'x-goog-api-key': apiKey }, label: 'Gemini', timeoutMs, attempts: config.ai.gemini.attempts });
  } catch (err) {
    throw geminiError(err);
  }
}

/** Token usage from a generateContent response (usageMetadata), output including thinking tokens. */
export function geminiUsage(data) {
  const u = data?.usageMetadata || {};
  return {
    input_tokens: u.promptTokenCount || 0,
    output_tokens: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0),
    cache_read_tokens: u.cachedContentTokenCount || 0,
  };
}

export default {
  name: 'gemini',
  ready: () => !!config.ai.gemini.apiKey,
  model: () => config.ai.gemini.model,

  async generate({ system, prompt, schema, maxTokens = 32000, images = [] }) {
    const { model } = config.ai.gemini;
    const body = (withSchema) => ({
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: [{
        role: 'user',
        parts: [
          ...images.map((img) => ({ inlineData: { mimeType: img.mediaType, data: img.base64 } })),
          { text: schema && !withSchema ? `${prompt}\n\nRespond with JSON only (no prose, no code fences), matching this JSON schema (every listed field is required):\n${JSON.stringify(requireAllFields(schema))}` : prompt },
        ],
      }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        ...(schema && withSchema ? { responseFormat: { text: { mimeType: 'APPLICATION_JSON', schema: requireAllFields(schema) } } } : {}),
      },
    });
    let data;
    try {
      data = await geminiPost(model, body(true));
    } catch (err) {
      // A schema the API can't express (400): state it in the prompt instead.
      if (schema && err.details?.upstreamStatus === 400 && !/api key/i.test(err.message)) data = await geminiPost(model, body(false));
      else throw err;
    }
    const usage = geminiUsage(data);
    if (data.promptFeedback?.blockReason) {
      const err = new HttpError(422, `Gemini declined this request (${data.promptFeedback.blockReason})`);
      err.usage = usage;
      throw err;
    }
    const candidate = data.candidates?.[0];
    const problem = finishProblem[candidate?.finishReason];
    if (problem) {
      const err = new HttpError(problem[0], problem[1]);
      err.usage = usage;
      throw err;
    }
    const text = (candidate?.content?.parts || []).filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join('');
    if (!text.trim()) {
      const err = new HttpError(502, 'Gemini returned an empty response');
      err.usage = usage;
      throw err;
    }
    return { text, usage, model: data.modelVersion || model };
  },
};
