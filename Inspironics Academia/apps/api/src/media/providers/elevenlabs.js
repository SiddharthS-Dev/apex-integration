import { config } from '../../config.js';
import { HttpError } from '../../lib/errors.js';
import { postJson } from '../../ai/providers/http.js';
import { concatMp3 } from '../mp3.js';
import { chunkText } from './textChunks.js';

// ElevenLabs text to speech (optional; used only when MEDIA_PROVIDER=elevenlabs or chosen per request).
// The key travels in the xi-api-key header. Output: MP3 44.1 kHz / 128 kbps.

const API = 'https://api.elevenlabs.io/v1';
const MAX_BYTES = 2500;

export default {
  name: 'elevenlabs',
  ready: () => !!(config.tts.elevenlabs.apiKey && (config.tts.elevenlabs.voiceId || config.tts.voice)),

  async synthesize({ text, voice, rate }) {
    const { apiKey, voiceId, model } = config.tts.elevenlabs;
    const id = voice || voiceId;
    if (!id) throw new HttpError(400, 'Choose an ElevenLabs voice (ELEVENLABS_VOICE_ID)');
    const parts = [];
    for (const piece of chunkText(text, MAX_BYTES)) {
      const res = await postJson(`${API}/text-to-speech/${encodeURIComponent(id)}?output_format=mp3_44100_128`, {
        text: piece,
        ...(model ? { model_id: model } : {}),
        ...(rate && rate !== 1 ? { voice_settings: { speed: Math.min(1.2, Math.max(0.7, rate)) } } : {}),
      }, { headers: { 'xi-api-key': apiKey, Accept: 'audio/mpeg' }, label: 'ElevenLabs', raw: true, timeoutMs: 120_000 });
      parts.push(Buffer.from(await res.arrayBuffer()));
    }
    return { bytes: parts.length === 1 ? parts[0] : concatMp3(parts).bytes, contentType: 'audio/mpeg' };
  },

  async voices() {
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': config.tts.elevenlabs.apiKey } });
    if (!res.ok) throw new HttpError(502, `ElevenLabs voices failed (${res.status})`);
    const data = await res.json();
    return (data.voices || []).map((v) => ({ id: v.voice_id, name: v.name, languages: [], gender: v.labels?.gender || '' }));
  },
};
