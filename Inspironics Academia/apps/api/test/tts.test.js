import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Voice-over (text to speech) with mocked provider APIs: Google Cloud TTS (API key and service
// account), ElevenLabs, long-text chunking, the audio cache, the monthly character limit and usage
// logging. No paid calls.

const frame = () => { const f = Buffer.alloc(417); f[0] = 0xff; f[1] = 0xfb; f[2] = 0x90; return f; };
const mp3 = (frames) => Buffer.concat(Array.from({ length: frames }, frame));
const calls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const headers = init.headers || {};
  if (u === 'https://texttospeech.googleapis.com/v1/text:synthesize') {
    const body = JSON.parse(init.body);
    calls.push({ provider: 'google', body, headers });
    return new Response(JSON.stringify({ audioContent: mp3(10).toString('base64') }), { status: 200 });
  }
  if (u.startsWith('https://texttospeech.googleapis.com/v1/voices')) {
    return new Response(JSON.stringify({ voices: [{ name: 'en-US-Neural2-F', languageCodes: ['en-US'], ssmlGender: 'FEMALE' }, { name: 'en-IN-Neural2-A', languageCodes: ['en-IN'], ssmlGender: 'FEMALE' }] }), { status: 200 });
  }
  if (u === 'https://oauth2.googleapis.com/token') {
    calls.push({ provider: 'google-oauth', body: String(init.body) });
    return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }), { status: 200 });
  }
  if (u.startsWith('https://api.elevenlabs.io/v1/text-to-speech/')) {
    calls.push({ provider: 'elevenlabs', url: u, body: JSON.parse(init.body), headers });
    return new Response(mp3(8), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
  }
  return realFetch(url, init);
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-tts-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const saFile = path.join(dir, 'sa.json');
fs.writeFileSync(saFile, JSON.stringify({ client_email: 'tts@proj.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' }));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error', AI_ENABLED: 'false',
  MEDIA_PROVIDER: 'google', GOOGLE_TTS_API_KEY: 'g-key', TTS_LANGUAGE: 'en-IN', TTS_VOICE: 'en-IN-Neural2-A', TTS_SPEAKING_RATE: '0.95',
  ELEVENLABS_API_KEY: 'el-key', ELEVENLABS_VOICE_ID: 'voice123', TTS_PRICE_PER_MILLION_CHARS: '16',
});

const { getDb, closeDb, db } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const media = await import('../src/media/index.js');
const { chunkText } = await import('../src/media/providers/textChunks.js');
const { setLimits } = await import('../src/usage/limits.js');
const { config } = await import('../src/config.js');

before(async () => { await migrate(await getDb()); });
after(async () => {
  globalThis.fetch = realFetch;
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});
const rows = () => db().query("SELECT * FROM generation_log WHERE kind = 'tts' ORDER BY created_at");

test('providers: Google is the default; ElevenLabs is available when configured; Piper is not', () => {
  assert.equal(media.mediaEnabled(), true);
  assert.deepEqual(media.availableVoiceProviders(), ['google', 'elevenlabs']);
  assert.deepEqual(media.voiceSettings(), { provider: 'google', voice: 'en-IN-Neural2-A', language: 'en-IN', rate: 0.95, pitch: 0 });
});

test('Google TTS: configured voice, MP3 at 44.1 kHz, key in a header, usage and cost logged', async () => {
  const out = await media.synthesize('Welcome to the lesson.');
  assert.equal(out.cached, false);
  assert.equal(out.bytes.length, 10 * 417);
  assert.match(out.url, /^\/api\/media\/[a-f0-9]{64}$/);
  const req = calls.at(-1);
  assert.deepEqual(req.body.voice, { languageCode: 'en-IN', name: 'en-IN-Neural2-A' });
  assert.deepEqual(req.body.audioConfig, { audioEncoding: 'MP3', speakingRate: 0.95, pitch: 0, sampleRateHertz: 44100 });
  assert.equal(req.headers['X-Goog-Api-Key'], 'g-key');
  const [row] = await rows();
  assert.deepEqual([row.provider, row.status, row.characters, row.cost_usd], ['google', 'ok', 22, (22 * 16) / 1e6]);
});

test('the same narration and settings come from the cache; different settings are a new voice-over', async () => {
  const n = calls.length;
  const again = await media.synthesize('  Welcome to   the lesson. ');
  assert.equal(again.cached, true, 'whitespace-normalised text hits the cache');
  assert.equal(calls.length, n);
  assert.equal((await rows()).at(-1).status, 'cached');
  const slower = await media.synthesize('Welcome to the lesson.', { rate: 0.8 });
  assert.equal(slower.cached, false);
  assert.notEqual(slower.key, again.key);
});

test('long narration is split at sentence ends (≤ 4,500 bytes each) and joined in order', async () => {
  const sentence = 'Every part of the playbook is read in the same order as it is written. ';
  const parts = chunkText(sentence.repeat(200), 4500);
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => Buffer.byteLength(p) <= 4500 && p.endsWith('.')));
  assert.equal(parts.join(' '), sentence.repeat(200).trim(), 'nothing lost or reordered');
  const n = calls.length;
  const out = await media.synthesize(sentence.repeat(200));
  assert.equal(calls.length - n, parts.length);
  assert.equal(out.bytes.length, parts.length * 10 * 417);
});

test('Google service-account credentials: a signed JWT is exchanged for an access token', async () => {
  const google = (await import('../src/media/providers/google-tts.js')).default;
  const key = config.tts.google.apiKey;
  config.tts.google.apiKey = '';
  config.tts.google.credentialsFile = saFile;
  try {
    await google.synthesize({ text: 'Signed in with a service account.', language: 'en-US' });
    const oauth = calls.find((c) => c.provider === 'google-oauth');
    assert.match(oauth.body, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=[\w-]+\.[\w-]+\.[\w-]+/);
    assert.equal(calls.at(-1).headers.Authorization, 'Bearer ya29.test');
  } finally {
    config.tts.google.apiKey = key;
  }
});

test('ElevenLabs on request: its voice, key header and MP3 output', async () => {
  const out = await media.synthesize('A different voice.', { provider: 'elevenlabs' });
  assert.equal(out.bytes.length, 8 * 417);
  const req = calls.at(-1);
  assert.match(req.url, /\/text-to-speech\/voice123\?output_format=mp3_44100_128$/);
  assert.equal(req.headers['xi-api-key'], 'el-key');
  assert.equal(req.body.text, 'A different voice.');
});

test('voices are listed per provider', async () => {
  const voices = await media.listVoices('google', 'en-IN');
  assert.deepEqual(voices.map((v) => v.id), ['en-IN-Neural2-A', 'en-US-Neural2-F']);
  await assert.rejects(media.listVoices('piper'), /not configured/);
});

test('the monthly character limit stops a voice-over that would exceed it; cached audio still plays', async () => {
  const used = (await db().query("SELECT sum(characters) n FROM generation_log WHERE kind = 'tts' AND status = 'ok'"))[0].n;
  await setLimits({ ttsMonthlyChars: used + 10 });
  try {
    await assert.rejects(media.synthesize('This sentence is longer than ten characters.'), (err) => err.status === 429 && /voice-over limit/.test(err.message));
    assert.equal((await rows()).at(-1).status, 'blocked');
    assert.equal((await media.synthesize('Welcome to the lesson.')).cached, true);
  } finally {
    await setLimits({ ttsMonthlyChars: null });
  }
});

test('empty narration and an unconfigured provider are refused clearly', async () => {
  await assert.rejects(media.synthesize('   '), /narration is empty/);
  await assert.rejects(media.synthesize('Hi', { provider: 'piper' }), /not configured|not available|turned off/);
  await assert.rejects(media.generateVideo(), /rendered from slides/);
});
