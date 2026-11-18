import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { geminiPost } from '../../ai/providers/gemini.js';
import { createTempDir, releaseTempDir } from '../../files/tempStore.js';
import { GEMINI_AUDIO_TOKENS_PER_SECOND, geminiTtsCost } from '../../usage/pricing.js';
import { runFfmpeg } from '../video/ffmpeg.js';
import { chunkText } from './textChunks.js';

// Gemini speech generation (MEDIA_PROVIDER=gemini): the same GEMINI_API_KEY as the text model, no Google
// Cloud project needed. Request shape from https://ai.google.dev/gemini-api/docs/speech-generation
// (generateContent variant, checked 2026-11-10):
//   POST models/gemini-3.8-flash-tts:generateContent
//   { contents: [{ role: 'user', parts: [{ text, speech_metadata: { style } }] }],
//     generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice: 'Kore' } } } }
// The audio comes back base64 in candidates[0].content.parts[].inlineData.data — a WAV (24 kHz, mono,
// 16-bit PCM) by default. Long narration is voiced in sentence-aligned pieces with the same voice and
// style, joined, and encoded once as MP3 for the existing player and renderer.

// No input limit is documented; pieces stay well below typical request sizes and keep each call short.
const MAX_BYTES = 3500;
// Per-minute speech limits: up to this many waits (GEMINI_TTS_RATE_LIMIT_WAIT_SECONDS × attempt) on a 429.
const RATE_LIMIT_WAITS = 3;

export const GEMINI_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat',
];

/** PCM samples and format from the returned audio: a RIFF/WAV file, or headerless 16-bit PCM. */
export function decodeGeminiAudio(buf, mimeType = '') {
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE') {
    let rate = 24000;
    let channels = 1;
    let bits = 16;
    let pcm = null;
    for (let o = 12; o + 8 <= buf.length;) {
      const id = buf.toString('ascii', o, o + 4);
      const size = buf.readUInt32LE(o + 4);
      const start = o + 8;
      if (id === 'fmt ') {
        channels = buf.readUInt16LE(start + 2);
        rate = buf.readUInt32LE(start + 4);
        bits = buf.readUInt16LE(start + 14);
      } else if (id === 'data') {
        pcm = buf.subarray(start, Math.min(buf.length, start + size));
        break;
      }
      o = start + size + (size % 2);
    }
    if (!pcm) throw new HttpError(502, 'Gemini returned a WAV file without audio data');
    if (bits !== 16) throw new HttpError(502, `Gemini returned ${bits}-bit audio; 16-bit PCM was expected`);
    return { pcm, rate, channels };
  }
  const rate = Number((/rate=(\d+)/i.exec(mimeType) || [])[1]) || 24000;
  return { pcm: buf, rate, channels: 1 };
}

function audioPart(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  const part = parts.find((p) => p.inlineData?.data || p.inline_data?.data);
  if (!part) {
    const reason = data?.promptFeedback?.blockReason || data?.candidates?.[0]?.finishReason;
    throw new HttpError(502, `Gemini returned no audio${reason ? ` (${reason})` : ''}`);
  }
  const inline = part.inlineData || part.inline_data;
  return { buf: Buffer.from(inline.data, 'base64'), mimeType: inline.mimeType || inline.mime_type || '' };
}

async function speak(text, voice, style) {
  const { model } = config.tts.gemini;
  const body = (withStyle) => ({
    contents: [{ role: 'user', parts: [{ text, ...(withStyle && style ? { speech_metadata: { style } } : {}) }] }],
    generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } },
  });
  let data;
  let withStyle = !!style;
  for (let attempt = 1; ; attempt++) {
    try {
      data = await geminiPost(model, body(withStyle));
      break;
    } catch (err) {
      // The style direction is optional: if the API rejects it, voice the text plainly.
      if (withStyle && err.details?.upstreamStatus === 400 && !/api key/i.test(err.message)) { withStyle = false; attempt--; continue; }
      // Speech has tight per-minute request limits: after the quick retries, wait for the next minute.
      if (err.status === 429 && !err.details?.quotaDaily && attempt <= RATE_LIMIT_WAITS) { await new Promise((r) => setTimeout(r, config.tts.gemini.rateLimitWaitMs * attempt)); continue; }
      throw err;
    }
  }
  const { buf, mimeType } = audioPart(data);
  const audio = decodeGeminiAudio(buf, mimeType);
  const u = data.usageMetadata || {};
  return { ...audio, inputTokens: u.promptTokenCount, outputTokens: u.candidatesTokenCount };
}

export default {
  name: 'gemini',
  ready: () => !!config.ai.gemini.apiKey,
  // Part of the audio cache key: a different speech model or style is a different recording.
  cacheTag: () => `${config.tts.gemini.model}|${config.tts.gemini.style || ''}`,

  async synthesize({ text, voice }) {
    const name = voice && GEMINI_VOICES.includes(voice) ? voice : config.tts.gemini.voice;
    const pieces = chunkText(text, MAX_BYTES);
    const out = [];
    for (const piece of pieces) out.push(await speak(piece, name, config.tts.gemini.style));
    const { rate, channels } = out[0];
    if (out.some((a) => a.rate !== rate || a.channels !== channels)) throw new HttpError(502, 'Gemini returned pieces of narration in different audio formats');
    const pcm = Buffer.concat(out.map((a) => a.pcm));
    const seconds = pcm.length / (rate * channels * 2);

    const dir = await createTempDir('gemini-tts');
    try {
      const raw = path.join(dir, 'speech.pcm');
      const mp3 = path.join(dir, 'speech.mp3');
      await fsp.writeFile(raw, pcm);
      await runFfmpeg(['-f', 's16le', '-ar', String(rate), '-ac', String(channels), '-i', raw,
        '-ar', '44100', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', '128k', mp3], { timeoutMs: 5 * 60_000 });
      // Usage as reported by the API, estimated where a response did not report it
      // (about 4 characters per text token; 25 audio tokens per second of speech).
      const inputTokens = out.reduce((n, a, i) => n + (a.inputTokens ?? Math.ceil(pieces[i].length / 4)), 0);
      const outputTokens = out.reduce((n, a) => n + (a.outputTokens ?? Math.ceil((a.pcm.length / (a.rate * a.channels * 2)) * GEMINI_AUDIO_TOKENS_PER_SECOND)), 0);
      return {
        bytes: await fsp.readFile(mp3),
        contentType: 'audio/mpeg',
        seconds,
        model: config.tts.gemini.model,
        usage: { input_tokens: inputTokens, output_tokens: outputTokens },
        cost_usd: geminiTtsCost(config.tts.gemini.model, { inputTokens, outputTokens }),
      };
    } finally {
      await releaseTempDir(dir);
    }
  },

  async voices() {
    return GEMINI_VOICES.map((v) => ({ id: v, name: v, languages: [], gender: '' }));
  },
};
