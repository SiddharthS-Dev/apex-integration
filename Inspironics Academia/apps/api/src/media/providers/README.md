# Media providers

`generateLessonMedia` produces an explainer video and narration audio for a lesson through a
pluggable provider chosen by the `MEDIA_PROVIDER` environment variable (default `none`).

| Provider | Video | Narration | Notes |
|---|---|---|---|
| `none` | – | – | Default. `generateLessonMedia` returns 503 and leaves the lesson untouched; the web app shows a placeholder and narrates with the browser's `speechSynthesis`. |
| `base44` | ✓ | ✓ | The Base44 app's built-in `Core.GenerateVideo` (8 s, 16:9) and `Core.GenerateSpeech` (MP3), billed to its integration credits. Needs `BASE44_APP_ID` (plus `BASE44_EMAIL`/`BASE44_PASSWORD` if the app requires sign-in). Files are downloaded into the object store. |

## Contract

A provider is a plain object exported as the default export of `providers/<name>.js`:

```js
export default {
  name: 'example',
  // optional; `false` makes mediaEnabled() return false
  enabled: true,
  // optional; omit when the provider can't do video
  async generateVideo({ prompt, durationSeconds, aspectRatio }) { /* ... */ },
  // optional; omit when the provider can't do speech
  async generateNarration({ text, voice }) { /* ... */ },
};
```

Each method returns one of:

- `{ bytes: Buffer, contentType: 'video/mp4' | 'audio/mpeg' | ... }` — preferred. The pipeline stores the
  bytes in the object store (`objectKey('media', lessonId, kind, sha256)`) and sets
  `lesson.video_url` / `lesson.audio_url` to `/api/media/<key>`, served (signed-in users only) by
  `GET /api/media/:key` with the stored content type.
- `{ url: 'https://…' }` — for providers that host the file themselves. Only use this for URLs that are
  durable and safe to hand to browsers.

Throw an `Error` on failure. The pipeline makes 2 attempts per asset and runs video and narration in
parallel (`Promise.allSettled`), so one can fail while the other succeeds. `voice` is a provider-neutral
hint (the pipeline passes `storm`); map it to one of your provider's voices.

Never log prompts, narration text or API keys.

## Adding a provider

1. Create `providers/<name>.js` implementing the contract. Use Node's built-in `fetch` — do not add
   npm dependencies.
2. Register it in `media/index.js`:
   ```js
   import openai from './providers/openai.js';
   const PROVIDERS = { none, openai };
   ```
3. Read its credentials from `process.env` (e.g. `OPENAI_API_KEY`) inside the provider and throw a clear
   error when they're missing.
4. Set `MEDIA_PROVIDER=<name>` on the API server. `/api/config` then reports `media_enabled: true`.

### Example: OpenAI text-to-speech (narration only)

```js
// providers/openai.js
const VOICES = { storm: 'onyx' };

export default {
  name: 'openai',
  async generateNarration({ text, voice }) {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new Error('OPENAI_API_KEY is not set');
    const res = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o-mini-tts', voice: VOICES[voice] || 'alloy', input: text, response_format: 'mp3' }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) throw new Error(`OpenAI TTS failed (HTTP ${res.status})`);
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType: 'audio/mpeg' };
  },
  // no generateVideo → video attempts fail with "does not support video"; narration still succeeds
};
```

Video providers are usually asynchronous (submit a job, poll until done, then download). Do the polling
inside `generateVideo` with a bounded timeout and return the downloaded bytes.
