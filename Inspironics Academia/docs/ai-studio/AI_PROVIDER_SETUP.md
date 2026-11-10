# AI provider setup

AI text generation (playbook extraction, course design, lessons, assessments, meeting analysis, storyboards, AI Studio) runs on the API server through the AI provider router. Configure it in `apps/api/.env`, then restart the API.

## Choose a provider

| `AI_PROVIDER` | Needs | Cost estimate in the dashboard |
|---|---|---|
| `anthropic` (recommended) | `ANTHROPIC_API_KEY` | Built in (Anthropic list prices) |
| `gemini` | `GEMINI_API_KEY`, `GEMINI_MODEL` | Set `AI_PRICE_INPUT_PER_MTOK` / `AI_PRICE_OUTPUT_PER_MTOK` |
| `ollama` | `OLLAMA_BASE_URL`, `OLLAMA_MODEL` | $0 (self-hosted) |
| `none` | — | AI features are off |

Also set `AI_ENABLED=true`. Optionally set `AI_FALLBACK_PROVIDER` to a second configured provider: it takes over when the primary is rate-limited, unavailable or its credentials are rejected (never for a bad request, a refusal or malformed output). Every fallback is logged (`ai.fallback`) and appears in the generation history.

## Anthropic (Claude)

1. Create an API key in the Claude Console (Settings → API keys) for your organisation.
2. In `apps/api/.env`:
   ```
   AI_ENABLED=true
   AI_PROVIDER=anthropic
   ANTHROPIC_API_KEY=sk-ant-...
   ANTHROPIC_MODEL=claude-opus-5-5
   ```
   `claude-opus-5-5` is the default (current Opus). Any current model ID works, e.g. `claude-sonnet-5-5` or `claude-haiku-5-5` for lower cost; the choice is yours.
3. Restart the API. The startup log line `api.listening` shows `ai_config: { provider: 'anthropic', ready: true, model: ... }`.

How calls are made: the official `@anthropic-ai/sdk`, streamed (`finalMessage()`), structured JSON via `output_config.format`, adaptive thinking, and server-side refusal fallbacks (`fallbacks: "default"`), so a policy decline is re-run on a suitable model inside the same call. The SDK retries 408/409/429/5xx and connection errors. Prices used for estimates (USD per million tokens, checked 2026-11-03): Opus 5.5 $4 / $20, Sonnet 5.5 $2 / $10, Haiku 5.5 $0.10 / $0.50 (see `usage/pricing.js`).

## Google Gemini

1. Create a key in Google AI Studio (or a Google Cloud project with the Generative Language API).
2. In `apps/api/.env`:
   ```
   AI_PROVIDER=gemini            # or keep anthropic and use AI_FALLBACK_PROVIDER=gemini
   GEMINI_API_KEY=...
   GEMINI_MODEL=<the Gemini model id your account uses>
   AI_PRICE_INPUT_PER_MTOK=<your price>
   AI_PRICE_OUTPUT_PER_MTOK=<your price>
   ```
3. Restart the API.

Structured output uses `responseMimeType: application/json` with `responseSchema`. If Gemini rejects a schema, the request is repeated with the schema stated in the prompt, and the router validates the result either way.

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

- AI Studio → the header chip shows "AI text: anthropic · claude-opus-5-5".
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
