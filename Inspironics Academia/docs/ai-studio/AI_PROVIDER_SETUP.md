# AI provider setup

AI text generation (playbook extraction, course design, lessons, assessments, meeting analysis, storyboards, AI Studio) runs on the API server through the AI provider router. Configure it in `apps/api/.env`, then restart the API.

## Choose a provider

The router (`apps/api/src/ai/index.js`) has two adapters: `PROVIDERS = { gemini, ollama }`.

| `AI_PROVIDER` | Needs | Cost estimate in the dashboard |
|---|---|---|
| `gemini` (default) | `GEMINI_API_KEY` (`GEMINI_MODEL` optional) | Built in (Gemini list prices, `usage/pricing.js`) |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | $0 (self-hosted) |
| `none` | — | AI features are off |

**Anthropic / Claude is not implemented.** There is no Anthropic adapter and no `@anthropic-ai/sdk` dependency; `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL` are ignored, and any `AI_PROVIDER` value other than `gemini` or `ollama` is treated as `none`. (Earlier versions of these docs described a Claude adapter; the current code has none.)

Also set `AI_ENABLED=true`. Optionally set `AI_FALLBACK_PROVIDER` to the other configured provider: it takes over when the primary is rate-limited, unavailable or its credentials are rejected (never for a bad request, a refusal or malformed output). Every fallback is logged (`ai.fallback`) and appears in the generation history.

## Google Gemini (default)

1. Create a key in Google AI Studio (https://aistudio.google.com/apikey), or a Google Cloud project with the Generative Language API.
2. In `apps/api/.env`:
   ```
   AI_ENABLED=true
   AI_PROVIDER=gemini
   GEMINI_API_KEY=...
   GEMINI_MODEL=gemini-3.8-flash   # optional; this is the default (DEFAULT_GEMINI_MODEL in src/config.js)
   ```
3. Restart the API. The startup log line `api.listening` shows `ai_config: { provider: 'gemini', ready: true, model: ... }`.

Calls go to the Gemini REST API (`GEMINI_BASE_URL`, default `https://generativelanguage.googleapis.com/v1beta`) with plain `fetch`, no SDK. Rate limits and overload (429/503) are retried with exponential backoff (`GEMINI_MAX_ATTEMPTS`, `GEMINI_TIMEOUT_SECONDS`). Structured output uses `responseMimeType: application/json` with `responseSchema`. If Gemini rejects a schema, the request is repeated with the schema stated in the prompt, and the router validates the result either way. A course batch stopped by the daily quota is resumed automatically after the quota resets (08:00 UTC).

## Ollama (optional)

For a self-hosted model on a machine with enough memory/GPU (not this laptop):
```
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://gpu-server:11434
OLLAMA_MODEL=<model name>
```
Structured output uses Ollama's `format` (JSON schema).

## Content cache

`ENABLE_CONTENT_CACHE=true` (default): an identical request (same provider, model, prompt, schema and settings) is answered from the cache at no cost and logged as `cached`. Explicit regenerations send `fresh: true` and always ask the provider again.

## Checking it works

- AI Studio → the header chip shows "AI text: gemini · gemini-3.8-flash" (or your `GEMINI_MODEL`).
- AI Studio → Content → generate a short summary from pasted text.
- AI Studio → History shows the request with its tokens and estimated cost.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| 503 "AI is not configured" | `AI_ENABLED` not `true`, or the provider's key/model missing. Check the `ai_config` in the startup log. |
| 503 "AI credentials were rejected" | Wrong or revoked key. |
| 429 "Generation paused: … limit" | A usage limit is reached (AI Studio → Usage & budget). |
| 429 "AI rate limit reached" | Provider rate limit; retried automatically, then reported. Configure a fallback provider to keep working. |
| 502 "unexpected format" | The model's JSON didn't match the schema; nothing was saved. Retry, or try another provider/model. |
