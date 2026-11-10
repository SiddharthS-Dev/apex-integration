# Google Cloud Text-to-Speech setup

Voice-overs for lesson videos, meeting briefings and AI Studio use Google Cloud Text-to-Speech when `MEDIA_PROVIDER=google`. Without a voice provider (`MEDIA_PROVIDER=none`), the players read scripts aloud with the browser's voice, and MP4 renders that need new narration are refused with a clear message.

## 1. Enable the API

1. In the Google Cloud console, select (or create) a project with billing enabled.
2. APIs & Services → Library → **Cloud Text-to-Speech API** → Enable.

## 2. Choose an authentication method

**Option A: API key (simplest)**

1. APIs & Services → Credentials → Create credentials → API key.
2. Restrict the key: API restrictions → Cloud Text-to-Speech API only.
3. In `apps/api/.env`: `GOOGLE_TTS_API_KEY=<key>`

**Option B: service account**

1. IAM & Admin → Service accounts → Create. No project role is needed for the TTS API itself; your organisation may require one.
2. Keys → Add key → JSON. Store the file outside the repository (e.g. `C:\secrets\academia-tts.json`).
3. In `apps/api/.env`:
   ```
   GOOGLE_APPLICATION_CREDENTIALS=C:\secrets\academia-tts.json
   GOOGLE_CLOUD_PROJECT_ID=<project id>   # optional: bills/quota to this project
   ```
   The server signs a JWT with the key and exchanges it for an access token, refreshed hourly. The key file is never read by the browser.

If both are set, the API key is used.

## 3. Voice settings

```
MEDIA_PROVIDER=google
TTS_LANGUAGE=en-IN            # e.g. en-IN, en-US, en-GB, hi-IN
TTS_VOICE=                    # a voice name, e.g. one listed in AI Studio → Voice; empty = Google's default for the language
TTS_SPEAKING_RATE=1           # 0.25–4.0 (AI Studio offers 0.7–1.3)
TTS_PITCH=0                   # -20.0–20.0
TTS_PRICE_PER_MILLION_CHARS=<your price>   # for cost estimates; empty = counted but not costed
TTS_MONTHLY_CHARACTER_LIMIT=  # optional monthly cap
```

Restart the API. AI Studio → Voice lists the available voices for the language; pick one, listen, and copy its name into `TTS_VOICE` to make it the default.

## How it is used

- Requests are limited to 5,000 bytes of text, so long narration is split at sentence ends and the MP3 parts are joined in order.
- Output is MP3 at 44.1 kHz.
- **Audio cache:** the same text with the same provider, voice, language, rate and pitch is reused from storage at no cost. When a lesson or video is regenerated with unchanged narration, nothing is paid.
- Each voice-over is logged with its characters and estimated cost (AI Studio → History, Usage & budget).

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Voice-over is turned off (MEDIA_PROVIDER=none)" | Set `MEDIA_PROVIDER=google` and restart. |
| "The google voice provider is not configured" | No key and no readable credentials file. |
| "Google Text-to-Speech error (403)" | API not enabled for the project, or the key is restricted to other APIs. |
| "Google TTS sign-in failed" | Service-account key revoked or the file is not the JSON key. |
| 429 "Generation paused: … voice-over limit" | The monthly character limit is reached (AI Studio → Usage & budget). |

## Alternatives

- **ElevenLabs:** `MEDIA_PROVIDER=elevenlabs`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` (optional `ELEVENLABS_MODEL`).
- **Piper (local, free):** install Piper and a voice model, then `MEDIA_PROVIDER=piper`, `PIPER_EXECUTABLE_PATH`, `PIPER_MODEL_PATH`. Runs on the server's CPU, so keep it for light use on this machine.
