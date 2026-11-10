import { config } from '../config.js';

// Estimated prices (USD), used only to estimate costs in the usage dashboard and budget checks; the
// provider's invoice is what is actually billed. Built-in table: Google Gemini (below). For anything
// else set AI_PRICE_INPUT_PER_MTOK / AI_PRICE_OUTPUT_PER_MTOK and TTS_PRICE_PER_MILLION_CHARS to your
// contract's prices, otherwise its cost is shown as unknown (never as zero).

// Google Gemini Developer API, standard paid tier, USD per million tokens (output includes thinking
// tokens), from https://ai.google.dev/gemini-api/docs/pricing as read on 2026-11-10. Several prices
// change on a published date, so each model lists [from-date, input, output] steps, newest last.
// The free tier is not modelled: estimates assume paid-tier billing.
const GEMINI = {
  'gemini-4-argon': [['2000-01-01', 2, 10], ['2026-12-01', 4, 20]],
  'gemini-3.8-flash': [['2000-01-01', 0.75, 3.75], ['2027-01-01', 1.5, 7.5]],
  'gemini-3.6-flash': [['2000-01-01', 0.75, 3.75], ['2027-01-01', 1.5, 7.5]],
  'gemini-3.5-flash-lite': [['2000-01-01', 0.3, 2.5]],
  'gemini-3.1-flash-lite': [['2000-01-01', 0.25, 1.5]],
  'gemini-3.1-pro-preview': [['2000-01-01', 2, 12]], // prompts up to 200k tokens
  'gemini-3-flash-preview': [['2000-01-01', 0.5, 3]],
  'gemini-2.5-pro': [['2000-01-01', 1.25, 10]], // prompts up to 200k tokens
  'gemini-2.5-flash': [['2000-01-01', 0.3, 2.5]],
  'gemini-2.5-flash-lite': [['2000-01-01', 0.1, 0.4]],
};
// Gemini speech: text in, audio out (25 audio tokens per second of speech).
const GEMINI_TTS = {
  'gemini-3.8-flash-tts': [['2000-01-01', 0.5, 9], ['2027-01-01', 1, 18]],
  'gemini-3.8-flash-lite-tts': [['2000-01-01', 0.5, 6], ['2027-01-01', 1, 12]],
};
export const GEMINI_AUDIO_TOKENS_PER_SECOND = 25;
export const PRICES_CHECKED = '2026-11-10';

const today = () => new Date().toISOString().slice(0, 10);
function dated(table, model, on = today()) {
  // Exact code first, then the longest listed code the reported model starts with
  // (the API may report a versioned name such as "gemini-3.8-flash-001").
  const id = String(model || '').replace(/^models\//, '');
  const key = table[id] ? id : Object.keys(table).filter((k) => id.startsWith(`${k}-`)).sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const step = table[key].filter(([from]) => from <= on).at(-1);
  return step ? [step[1], step[2]] : null;
}

/** [inputPerMTok, outputPerMTok] for a provider/model, or null when unknown. */
export function aiPrice(provider, model, on) {
  const { priceInputPerMTok: i, priceOutputPerMTok: o } = config.ai;
  if (i != null && o != null) return [i, o];
  if (provider === 'gemini') return dated(GEMINI, model, on);
  if (provider === 'ollama') return [0, 0]; // runs on your own hardware: no per-token charge
  return null;
}

/** Estimated cost of one Gemini speech request from its token usage, or null for an unknown model. */
export function geminiTtsCost(model, { inputTokens = 0, outputTokens = 0 } = {}, on) {
  const price = dated(GEMINI_TTS, model, on);
  if (!price) return null;
  return +((inputTokens * price[0] + outputTokens * price[1]) / 1e6).toFixed(6);
}

/** Estimated cost of one AI call, or null when the price is unknown. Cache reads bill at 10% of input. */
export function aiCost(provider, model, usage = {}) {
  const price = aiPrice(provider, model);
  if (!price) return null;
  const [inP, outP] = price;
  const input = (usage.input_tokens || 0) + (usage.cache_write_tokens || 0) * 1.25 + (usage.cache_read_tokens || 0) * 0.1;
  return +(((input * inP) + (usage.output_tokens || 0) * outP) / 1e6).toFixed(6);
}

/** Estimated cost of a voice-over, or null when the price is unknown (Piper: local, free). */
export function ttsCost(provider, characters) {
  if (provider === 'piper') return 0;
  const p = config.tts.pricePerMillionChars;
  return p == null ? null : +((characters * p) / 1e6).toFixed(6);
}
