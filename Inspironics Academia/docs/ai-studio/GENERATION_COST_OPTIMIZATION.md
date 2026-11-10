# Generation cost optimisation

What was changed to stop paying for work nobody asked for, and the controls administrators now have. Savings below are **estimates** from the code paths; actual figures come from AI Studio → Usage & budget, which records every request from now on.

## Where the money went (Base44 era)

The Base44 audit (November 2026) traced almost all integration-credit use to:

1. **Lesson content automatically voiced every lesson.** "Generate Learning Package" ran, per lesson, 1 content request, 1 storyboard request and about 6 voice clips. Records show 1,536 voice clips for 259 lessons in a single day.
2. **AI extraction on every synced Dropbox file.** The first sync of the whole Dropbox added 1,097 files, each sent to AI extraction.
3. **No cache, no confirmation, no meter:** regenerations repaid in full, bulk actions started with one click, and nothing recorded usage.

## What is in place now

| Control | Default | Effect |
|---|---|---|
| **On-demand voice-over** (`AUTO_GENERATE_AUDIO`) | off | Lesson content no longer triggers voice-over or storyboards. Media is generated per lesson or with "Regenerate Media". |
| **No AI on sync** (`SYNC_AI_EXTRACT`, `SYNC_AI_MEETINGS`) | off | Sync stores and extracts files with the built-in chapter detection, and meetings get the keyword analysis. AI runs on an explicit action. |
| **Content cache** (`ENABLE_CONTENT_CACHE`) | on | Identical AI requests are answered from storage ($0, logged as `cached`). Regenerate actions send `fresh: true`. |
| **Audio cache** (`ENABLE_AUDIO_CACHE`) | on | Keyed by normalised text, provider, voice, language, rate, pitch and format. Unchanged narration is never voiced twice. |
| **Scene-level re-rendering** (`ENABLE_SCENE_REGENERATION`) | on | Rendering again reuses every unchanged scene. Rendering itself runs locally on FFmpeg and costs no API credits. |
| **Bulk confirmation** | always | Generate Learning Package, Regenerate Media and Generate Tests show the lessons affected, expected AI requests and voice-over characters, and run only after confirmation. |
| **Stop on limits** | always | A usage limit or exhausted credits (402/429) is not retried; the batch stops instead of failing every remaining lesson. |
| **Usage limits** | none set | Daily AI requests, monthly AI budget (USD, estimated), monthly voice-over characters, monthly render minutes. When reached, new paid requests are refused with a clear message; existing content is unaffected. Admins edit them in AI Studio. |
| **Usage dashboard and history** | always | Real totals by kind and provider, cached and failed counts, budget remaining, and every request with its tokens, characters, render seconds and estimated cost. |
| **Provider choice** | — | Use a lower-cost model or provider for routine work (`ANTHROPIC_MODEL`, per-request provider in AI Studio, `AI_FALLBACK_PROVIDER`). |

## Expected effect (estimates, not measurements)

| Action | Before | Now |
|---|---|---|
| Generate Learning Package, 170 lessons | ≈170 content + 170 storyboard requests + ≈1,000 voice clips | ≈170 content requests; voice-over only when requested |
| Re-run the same generation unchanged | Full price again | Cache hits, $0 |
| Regenerate media after editing one lesson | Every lesson re-voiced | Only changed narration is voiced |
| Re-render a video after editing one scene | (not available) | One scene encoded; no API cost |
| Sync adding N new playbooks | N × 1–3 AI requests | 0 AI requests (AI on demand) |
| A batch hitting a credit/usage limit | Every remaining lesson attempted | Stops at the first refusal |

AI text billing on Anthropic is per token, so prompt size matters too. The pipelines send only what each step needs (chapter text capped at 40,000 characters; course design batches six chapters at a time), and the prices used for estimates are in `apps/api/src/usage/pricing.js`.

## Recommended settings

- Set `AI_MONTHLY_BUDGET` and `TTS_MONTHLY_CHARACTER_LIMIT` to your plan's comfort level, and `AI_DAILY_LIMIT` to stop runaway batches.
- Set `TTS_PRICE_PER_MILLION_CHARS` (and `AI_PRICE_*` for Gemini) so the dashboard can estimate those costs. Unknown prices are shown as unpriced, never as $0.
- Keep `AUTO_GENERATE_AUDIO`, `SYNC_AI_EXTRACT` and `SYNC_AI_MEETINGS` off unless you need the automation and have limits set.
- Review AI Studio → Usage & budget weekly; the History tab shows which operation spent what.
