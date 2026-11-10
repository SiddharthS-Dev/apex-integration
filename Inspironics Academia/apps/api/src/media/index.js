import crypto from 'node:crypto';
import { config } from '../config.js';
import { getObject, objectKey, putObject } from '../files/objectStore.js';
import { badRequest, unavailable } from '../lib/errors.js';
import { assertWithinLimits } from '../usage/limits.js';
import { recordGeneration } from '../usage/log.js';
import { ttsCost } from '../usage/pricing.js';
import elevenlabs from './providers/elevenlabs.js';
import gemini from './providers/gemini-tts.js';
import google from './providers/google-tts.js';
import none from './providers/none.js';
import piper from './providers/piper.js';

// The media provider router: voice-over (text to speech) for lesson and meeting videos.
// MEDIA_PROVIDER picks the default provider (gemini | google | elevenlabs | piper | none); a request may name
// another configured one. A provider implements:
//   synthesize({ text, voice, language, rate, pitch }) → { bytes: Buffer (MP3), contentType }
//   voices(language?)                                  → [{ id, name, languages, gender }]
// Every voice-over is cached by its exact inputs (text, provider, voice, language, rate, pitch,
// format), so the same narration is never paid for twice; usage is logged with its characters and
// estimated cost, and checked against the monthly character limit first.
//
// Generated video clips are not offered: videos are rendered from slides with FFmpeg (media/video).

export const TTS_PROVIDERS = { gemini, google, elevenlabs, piper };
const FORMAT = 'mp3';

const pick = (name) => (name && name !== 'none' ? TTS_PROVIDERS[name] || null : null);

export function ttsReady(name = config.mediaProvider) {
  return !!pick(name)?.ready();
}

/** True when the default voice provider can record narration. */
export function mediaEnabled() {
  return ttsReady(config.mediaProvider);
}

export function availableVoiceProviders() {
  return Object.keys(TTS_PROVIDERS).filter(ttsReady);
}

export function mediaUnavailableError() {
  if (config.mediaProvider === 'none') return unavailable('Voice-over is turned off (MEDIA_PROVIDER=none)');
  if (!TTS_PROVIDERS[config.mediaProvider]) return unavailable(`Unknown MEDIA_PROVIDER "${config.mediaProvider}" (available: ${Object.keys(TTS_PROVIDERS).join(', ')}, none)`);
  if (config.mediaProvider === 'gemini') return unavailable('Gemini voice-over is not configured: GEMINI_API_KEY is not set on the API server');
  return unavailable(`The ${config.mediaProvider} voice provider is not configured on the API server (see GOOGLE_TTS_SETUP.md)`);
}

/** The voice settings a request ends up with: its own values over the configured defaults. */
export function voiceSettings(o = {}) {
  const provider = o.provider || config.mediaProvider;
  return {
    provider,
    // TTS_VOICE names a voice of the default provider; another provider uses its own default.
    voice: o.voice || (provider === config.mediaProvider ? config.tts.voice : '') || '',
    language: o.language || config.tts.language,
    rate: Number.isFinite(Number(o.rate)) && o.rate !== '' && o.rate != null ? Number(o.rate) : config.tts.rate,
    pitch: Number.isFinite(Number(o.pitch)) && o.pitch !== '' && o.pitch != null ? Number(o.pitch) : config.tts.pitch,
  };
}

export const normalizeNarration = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** Stable cache key for a voice-over: the same narration and settings always map to the same audio. */
export function audioCacheKey(text, s) {
  const id = crypto.createHash('sha256').update(JSON.stringify([normalizeNarration(text), s.provider, s.voice || '', s.language, s.rate, s.pitch, FORMAT, ...(TTS_PROVIDERS[s.provider]?.cacheTag ? [TTS_PROVIDERS[s.provider].cacheTag()] : [])])).digest('hex');
  return objectKey('tts', id);
}

/**
 * Voice-over for `text`. Returns { bytes, contentType, cached, characters, key, url }; the audio is
 * stored (and served at /api/media/<key>) so it can be reused, previewed and downloaded.
 */
export async function synthesize(text, options = {}) {
  const clean = normalizeNarration(text);
  if (!clean) throw badRequest('Nothing to say: the narration is empty');
  const s = voiceSettings(options);
  const provider = pick(s.provider);
  if (!provider) throw mediaUnavailableError();
  if (!provider.ready()) throw unavailable(`The ${s.provider} voice provider is not configured on the API server`);
  const key = audioCacheKey(clean, s);
  const url = `/api/media/${key}`;

  if (config.tts.audioCache && options.cache !== false) {
    const hit = await getObject(key).catch(() => null);
    if (hit) {
      await recordGeneration({ kind: 'tts', provider: s.provider, model: s.voice || null, status: 'cached', output_ref: url });
      return { bytes: hit, contentType: 'audio/mpeg', cached: true, characters: clean.length, key, url };
    }
  }

  await assertWithinLimits('tts', { provider: s.provider, characters: clean.length });
  const started = Date.now();
  try {
    const out = await provider.synthesize({ text: clean, voice: s.voice || undefined, language: s.language, rate: s.rate, pitch: s.pitch });
    await putObject(key, out.bytes, { source: 'media', kind: 'audio', provider: s.provider, content_type: 'audio/mpeg' });
    await recordGeneration({
      kind: 'tts', provider: s.provider, model: out.model ? `${out.model}${s.voice ? `:${s.voice}` : ''}` : s.voice || null, status: 'ok', characters: clean.length,
      input_tokens: out.usage?.input_tokens, output_tokens: out.usage?.output_tokens, seconds: out.seconds,
      // A provider that knows its own price (Gemini: by tokens) reports it; others use the per-character price.
      cost_usd: out.cost_usd !== undefined ? out.cost_usd : ttsCost(s.provider, clean.length), duration_ms: Date.now() - started, output_ref: url,
    });
    return { bytes: out.bytes, contentType: 'audio/mpeg', cached: false, characters: clean.length, key, url };
  } catch (err) {
    await recordGeneration({ kind: 'tts', provider: s.provider, model: s.voice || null, status: 'error', error: err.message, characters: clean.length, duration_ms: Date.now() - started });
    throw err;
  }
}

/** Narration for the lesson and meeting pipelines (MP3 bytes), with the configured voice. */
export async function generateNarration({ text, ...options }) {
  const { bytes, contentType } = await synthesize(text, options);
  return { bytes, contentType };
}

export async function listVoices(providerName = config.mediaProvider, language) {
  const provider = pick(providerName);
  if (!provider?.ready()) throw unavailable(`The ${providerName} voice provider is not configured on the API server`);
  return provider.voices(language);
}

/** Generated AI video clips are not offered: videos are rendered from slides (VIDEO_PROVIDER=ffmpeg). */
export async function generateVideo() {
  throw unavailable('Generated AI video clips are not available; lesson videos are rendered from slides with FFmpeg');
}

export { none };
