# Voice-over (text-to-speech) providers

Lesson videos and meeting briefings are narrated through a pluggable text-to-speech provider chosen by
`MEDIA_PROVIDER` (default `none`). The router is `media/index.js`; videos themselves are rendered from
slides by the FFmpeg engine in `media/video/` (no provider generates video clips).

| Provider | Needs | Notes |
|---|---|---|
| `none` | — | Default. No recorded narration: the web players read the script aloud with the browser's voice. |
| `google` | `GOOGLE_TTS_API_KEY`, or `GOOGLE_APPLICATION_CREDENTIALS` (service-account key file) | Google Cloud Text-to-Speech. MP3 44.1 kHz; text over 5,000 bytes is split at sentence ends and joined in order. |
| `elevenlabs` | `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` | Optional. MP3 44.1 kHz / 128 kbps. |
| `piper` | `PIPER_EXECUTABLE_PATH`, `PIPER_MODEL_PATH` | Optional, local and free; WAV converted to MP3 with FFmpeg. Runs on the API server's CPU. |

Voice settings (`TTS_LANGUAGE`, `TTS_VOICE`, `TTS_SPEAKING_RATE`, `TTS_PITCH`) are defaults; a request
(e.g. from AI Studio) may override them. `TTS_VOICE` applies to the default provider only.

## What the router adds around every provider

- **Audio cache** (`ENABLE_AUDIO_CACHE=true`): the key is a hash of the normalised text, provider,
  voice, language, rate, pitch and format. The same narration is never paid for twice.
- **Limits**: the monthly character limit is checked before a paid request (429 when exceeded).
- **Usage log**: every request, including cache hits, failures and blocked requests, goes into
  `generation_log` with characters and estimated cost (`TTS_PRICE_PER_MILLION_CHARS`).
- **Storage**: audio lives in the object store and is served at `/api/media/<key>` to signed-in users.

## Contract

A provider is the default export of `providers/<name>.js`:

```js
export default {
  name: 'example',
  ready: () => !!process.env.EXAMPLE_API_KEY,             // configured?
  async synthesize({ text, voice, language, rate, pitch }) {
    return { bytes /* MP3 Buffer */, contentType: 'audio/mpeg' };
  },
  async voices(language) { return [{ id, name, languages: [], gender: '' }]; },
};
```

Return MP3 (any MPEG-1/2 sample rate; 44.1 kHz preferred) so narration parts can be joined frame by
frame. Throw on failure; use `postJson` from `ai/providers/http.js` for retries with backoff on 429/5xx.
Never log narration text or API keys. Register the provider in `TTS_PROVIDERS` in `media/index.js` and
add a mocked test in `test/tts.test.js`.
