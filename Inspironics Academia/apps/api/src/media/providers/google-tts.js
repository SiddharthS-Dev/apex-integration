import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from '../../config.js';
import { HttpError, unavailable } from '../../lib/errors.js';
import { postJson } from '../../ai/providers/http.js';
import { concatMp3 } from '../mp3.js';
import { chunkText } from './textChunks.js';

// Google Cloud Text-to-Speech (REST v1). Authentication, in order:
//   GOOGLE_TTS_API_KEY            an API key restricted to the Text-to-Speech API (X-Goog-Api-Key header)
//   GOOGLE_APPLICATION_CREDENTIALS a service-account JSON key file (OAuth access token, refreshed hourly)
// Requests are limited to 5,000 bytes of text, so long narration is split at sentence ends and the MP3
// parts joined in order. Output: MP3 at 44.1 kHz.

const API = 'https://texttospeech.googleapis.com/v1';
const MAX_BYTES = 4500;
let token = null;

function serviceAccount() {
  const file = config.tts.google.credentialsFile;
  if (!file) return null;
  try {
    const sa = JSON.parse(fs.readFileSync(file, 'utf8'));
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

async function accessToken() {
  if (token && token.expiresAt - Date.now() > 60_000) return token.value;
  const sa = serviceAccount();
  if (!sa) throw unavailable('Google TTS credentials are missing or unreadable (GOOGLE_APPLICATION_CREDENTIALS)');
  const now = Math.floor(Date.now() / 1000);
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = crypto.createSign('RSA-SHA256').update(unsigned).sign(sa.private_key).toString('base64url');
  const res = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw unavailable(`Google TTS sign-in failed (${res.status}${data.error ? `: ${data.error}` : ''})`);
  token = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return token.value;
}

async function authHeaders() {
  if (config.tts.google.apiKey) return { 'X-Goog-Api-Key': config.tts.google.apiKey };
  const h = { Authorization: `Bearer ${await accessToken()}` };
  if (config.tts.google.projectId) h['x-goog-user-project'] = config.tts.google.projectId;
  return h;
}

export default {
  name: 'google',
  ready: () => !!(config.tts.google.apiKey || serviceAccount()),

  async synthesize({ text, voice, language, rate, pitch }) {
    const headers = await authHeaders();
    const parts = [];
    for (const piece of chunkText(text, MAX_BYTES)) {
      const data = await postJson(`${API}/text:synthesize`, {
        input: { text: piece },
        voice: { languageCode: language || 'en-US', ...(voice ? { name: voice } : {}) },
        audioConfig: { audioEncoding: 'MP3', speakingRate: rate ?? 1, pitch: pitch ?? 0, sampleRateHertz: 44100 },
      }, { headers, label: 'Google Text-to-Speech', timeoutMs: 120_000 });
      if (!data.audioContent) throw new HttpError(502, 'Google Text-to-Speech returned no audio');
      parts.push(Buffer.from(data.audioContent, 'base64'));
    }
    return { bytes: parts.length === 1 ? parts[0] : concatMp3(parts).bytes, contentType: 'audio/mpeg' };
  },

  async voices(language) {
    const res = await fetch(`${API}/voices${language ? `?languageCode=${encodeURIComponent(language)}` : ''}`, { headers: await authHeaders() });
    if (!res.ok) throw new HttpError(502, `Google Text-to-Speech voices failed (${res.status})`);
    const data = await res.json();
    return (data.voices || []).map((v) => ({ id: v.name, name: v.name, languages: v.languageCodes || [], gender: v.ssmlGender || '' }))
      .sort((a, b) => a.name.localeCompare(b.name));
  },
};
