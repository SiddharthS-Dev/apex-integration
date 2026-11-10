# Google Gemini integration — Inspironics Academia

| | |
|---|---|
| Date | 2026-11-10 |
| Scope | Academia API and web app (`E:\apex\Inspironics Academia`). SlidesVault and Showcase were not changed |
| Status | **Implemented, tested (212 mocked tests) and verified with one real sample lesson** (§12). The remaining 82 lessons are **not** generated and wait for your approval. Nothing is committed |

Gemini facts below come from Google's official pages, read on 2026-11-10:
[models](https://ai.google.dev/gemini-api/docs/models), [pricing](https://ai.google.dev/gemini-api/docs/pricing),
[structured output](https://ai.google.dev/gemini-api/docs/structured-output),
[speech generation](https://ai.google.dev/gemini-api/docs/speech-generation),
[deprecations](https://ai.google.dev/gemini-api/docs/deprecations). Those URLs now redirect to `aistudio.google.com/docs/…`.

## 1. Previous architecture

- **AI router** (`apps/api/src/ai/index.js`):
  - providers Anthropic (default), Gemini and Ollama;
  - content cache, optional fallback provider, JSON shape check;
  - usage logging to `generation_log`, with limits and a monthly budget.
- **Gemini provider:** existed, but used the older `responseMimeType` / `responseSchema` fields and had no built-in prices, so Gemini usage was logged with an unknown cost and never counted toward the dollar budget.
- **Voice-over:** Google Cloud Text-to-Speech (its own key or service account), ElevenLabs or Piper. No Gemini speech.
- **Video:** slides rendered as SVG then PNG, the narration track, and FFmpeg producing MP4, SRT/VTT subtitles and a thumbnail. Lessons had no intro or closing cards.
- **Lesson content:** generated one lesson at a time from the Content Studio. There was no server-side course batch, no per-lesson failure tracking and no resume.
- **Base44:** already removed (see `BASE44_REMOVAL_FINAL_AUDIT.md`).

## 2. New architecture

```
AI Studio → Course generation tab
   │  GET /api/studio/courses, GET /api/studio/courses/:id/progress
   │  POST /api/studio/courses/:id/generate  (sample: {limit:1}; more than one lesson needs {confirm:true})
   ▼
jobs queue: content:course  (one per course, resumable, cancellable)
   │ for each lesson without content, in course order (AI_BATCH_CONCURRENCY, default 1):
   │   generateLessonContent ─► ai/index.js invokeLLM ─► providers/gemini.js ─► Gemini generateContent
   │       (script, summary, key points, 6 MCQs, 5 flashcards; JSON validated, quality-gated, saved)
   │   [media]  generateLessonMedia ─► Gemini storyboard (slides) + media/index.js synthesize
   │                                    ─► providers/gemini-tts.js ─► gemini-3.8-flash-tts (WAV → MP3)
   │   [render] render:lesson job ─► media/video/renderer.js (FFmpeg)
   │            intro card + narrated slides + key-takeaways card → MP4, SRT, VTT, thumbnail
   ▼
generation_log (provider, model, lesson id, kind, tokens, estimated cost, status) → budget checks
```

- **Gemini is the default provider.** `AI_PROVIDER` defaults to `gemini`, and `GEMINI_MODEL` to `gemini-3.8-flash`.
- **No hidden fallback.** `AI_FALLBACK_PROVIDER` is empty, so a failed Gemini call is reported and never re-sent to another provider.
- **Narration** uses the same `GEMINI_API_KEY` (`MEDIA_PROVIDER=gemini`); no Google Cloud project is needed. With no voice provider, the in-app players still read the script with the browser voice.

## 3. Files changed

**API, new files:**

| File | Purpose |
|---|---|
| `src/media/providers/gemini-tts.js` | Gemini speech: chunking, WAV/PCM decoding, MP3 encoding, token cost |
| `src/pipeline/courseContent.js` | Course batch job, lesson states, progress |
| `test/gemini.test.js` | 16 mocked tests |

**API, changed files:**

| File | Change |
|---|---|
| `src/config.js` | Gemini default; default models; `GEMINI_TIMEOUT_SECONDS`, `AI_BATCH_CONCURRENCY`, `GEMINI_TTS_*` |
| `src/ai/providers/gemini.js` | Documented `responseFormat.text` JSON output; clear errors for invalid key, 403, quota/429, unknown model; empty-response check; timeout |
| `src/ai/index.js` | Gemini key names in the "why AI is off" message |
| `src/ai/schema.js` | Removed the unused `geminiSchema` converter |
| `src/usage/pricing.js` | Dated Gemini text and speech prices |
| `src/media/index.js` | Registers Gemini speech; provider-reported cost and tokens are logged; the cache key includes the speech model and style |
| `src/media/video/renderer.js` | Silent scenes (intro/closing cards) |
| `src/media/video/slides.js` | `cover` layout, `kicker` label |
| `src/pipeline/renderVideo.js` | Intro and closing cards in lesson videos |
| `src/pipeline/generateLessonContent.js` | Quality gate (≥300-word script, ≥4 valid MCQs, ≥3 flashcards); records `content_error`, `content_attempts`, `content_generated_at`; keeps existing content on failure |
| `src/studio/routes.js` | Course endpoints, cost estimate, confirmation, provider and key status in `/studio/config` |
| `src/pipeline/processMeeting.js` | Comments only (provider-neutral wording) |
| `packages/shared/src/entities.js` | Lesson: `content_generated_at`, `content_error`, `content_attempts`, `media_error`; provider-neutral description |
| `.env.example` | AI and voice sections for Gemini |

**API, tests updated:**
- `aiRouter.test.js`: mock and assertions for the documented `responseFormat`.
- `contentPipeline.test.js`: a mock script long enough for the quality gate.
- `studio.test.js`: the Gemini voice provider; lesson video length with intro and closing cards.

**Web:**

| File | Change |
|---|---|
| `src/components/studio/CourseGeneration.jsx` (new) | Course generation tab |
| `src/pages/admin/AIStudio.jsx` | New tab |
| `src/api/drivers/http.js`, `src/api/drivers/demo/index.js` | Course methods |

**Local, git-ignored:** `apps/api/.env`. Only these non-secret lines were set: `AI_ENABLED=true`, `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.8-flash`, `AI_MONTHLY_BUDGET=30`, `MEDIA_PROVIDER=gemini`. `GEMINI_API_KEY` is left for you to fill in.

## 4. Environment variables

| Variable | Value | Notes |
|---|---|---|
| `AI_ENABLED` | `true` | |
| `AI_PROVIDER` | `gemini` | Default when unset |
| `GEMINI_API_KEY` | *(you add it)* | From https://aistudio.google.com/apikey. Read only by the API server, sent in the `x-goog-api-key` header, never logged or returned |
| `GEMINI_MODEL` | `gemini-3.8-flash` | Default when unset |
| `GEMINI_TIMEOUT_SECONDS` | `300` | |
| `AI_BATCH_CONCURRENCY` | `1` | 1–3 |
| `AI_MONTHLY_BUDGET` | `30` | USD; covers AI text and voice-over estimates |
| `AI_FALLBACK_PROVIDER` | *(empty)* | No fallback |
| `MEDIA_PROVIDER` | `gemini` | Narration with the same key. `none` = browser voice in the players |
| `GEMINI_TTS_MODEL` | `gemini-3.8-flash-tts` | `gemini-3.8-flash-lite-tts` is cheaper |
| `GEMINI_TTS_VOICE` | `Kore` | Any of the 30 prebuilt voices |
| `GEMINI_TTS_STYLE` | `clear, warm and encouraging, at a steady teaching pace` | Empty to send none |

`.env` is git-ignored (`Inspironics Academia/.gitignore`).

## 5. Gemini model selected

**`gemini-3.8-flash`.** The models page says: *"For any new projects, use our latest models: 3.5 Flash-Lite or 3.8 Flash."*

**Rejected alternatives:**
- **`gemini-2.5-*`:** access is limited to existing users, and 2.5 Pro and Flash shut down on 2026-12-01.
- **`gemini-4-argon`** (flagship): $2/$10 rising to $4/$20 on 2026-12-01. Unnecessary for lesson writing.
- **`gemini-3.5-flash-lite`:** cheapest at $0.30/$2.50, but lower quality. A one-line switch (`GEMINI_MODEL`) if the sample shows it is good enough.

**Prices** (standard paid tier, per 1M tokens, output including thinking):

| Model | Until 2026-12-31 | From 2027-01-01 |
|---|---|---|
| `gemini-3.8-flash` | $0.75 in / $3.75 out | $1.50 / $7.50 |
| `gemini-3.8-flash-tts` | $0.50 text in / $9.00 audio out (25 audio tokens per second ≈ $0.00225 per 10 s) | $1 / $18 |

These are encoded with their dates in `usage/pricing.js`.

**Not verified in the docs:** the exact `usageMetadata` field names of `generateContent`, and a `generateContent` thinking-level field. The provider reads `promptTokenCount`, `candidatesTokenCount` and `thoughtsTokenCount` defensively, and sets no thinking field (the model default is medium). Check the logged token counts after the sample.

## 6. Voice-over

- **Option chosen:** Gemini speech, because the Gemini API offers it and it needs no second credential. Google Cloud Text-to-Speech stays available (`MEDIA_PROVIDER=google`) but needs its own key or service account; the Gemini key does not grant Cloud TTS.
- **Request:**
  ```
  POST models/gemini-3.8-flash-tts:generateContent
  generationConfig: { responseModalities: ['AUDIO'], speechConfig: { voiceConfig: { voice } } }
  parts[].speech_metadata.style  (the teaching style; dropped automatically if the API rejects it)
  ```
- **Audio:** the 24 kHz mono 16-bit WAV is decoded (headerless PCM is also handled). Long narration is voiced in sentence-aligned pieces of up to 3,500 bytes with the same voice and style, joined and encoded once to MP3 by FFmpeg.
- **Reuse:** cached by text, voice, model and style, so repeated narration is free. Usage is logged with tokens and estimated cost, and the monthly budget is checked first.
- **Slide alignment:** each scene's narration is timed against its slide; subtitles come from the same timings.
- **Retry without regenerating content:** "Narrate" on a lesson re-runs only the narration and slides.
- **Fallback:** without a voice provider, the in-app slide player uses the browser's speech. MP4 rendering needs recorded narration.

## 7. Video rendering

The local FFmpeg pipeline is unchanged except for the new opening and closing cards. No paid video generation (Veo or similar) is used or enabled.

**What each lesson MP4 contains:**
- an **intro card** (4 s): "LESSON", the lesson title, the module and course names;
- the narrated slides, each with the course and module in the header, the source section, progress dots, the animated presenter and burned-in subtitles, with a fade between scenes;
- a **closing card**: "Key takeaways" from the lesson's key points, or "Thank you for watching";
- SRT and VTT subtitle files, and a thumbnail (the intro card).

**Steps:** "Narrate" (storyboard and voice-over), then "Render" (`render:lesson` job). The batch can do both per lesson with the two switches. Unchanged scenes are reused from the scene cache.

## 8. Cost tracking

- **Every AI or speech request** is written to `generation_log` with:
  - the provider and model;
  - the lesson (`ref_type`/`ref_id` = `lesson`/id) and operation (`generateLessonContent`, `generateLessonMedia`, …);
  - input and output tokens, characters and seconds;
  - the estimated cost, status (`ok`, `cached`, `error`, `blocked`), duration and timestamp.
- **Retries:** the lesson's `content_attempts` counts retries.
- **Budget:** limits are checked before each call. The monthly budget covers AI text and voice-over; a batch stops cleanly when it is reached, and the remaining lessons stay pending.
- **Dashboards:** AI Studio's "Course generation" tab shows spend and remaining budget; "Usage & budget" shows per-provider totals.
- **Estimates, not bills:** all figures are list-price estimates, labelled as such. Google's invoice is what is billed, and the free tier is not modelled.
- **Duplicates avoided:**
  - the content cache returns identical requests at no cost;
  - the audio cache returns repeated narration;
  - a batch never processes a lesson that already has content;
  - there is one batch job per course and a lock per lesson.

**Course estimate** (83 lessons, real chapter sizes, list prices until 2026-12-31). It assumes 5–10k output tokens per lesson and about 9 minutes of narration per lesson:

| Scope | Estimated cost |
|---|---|
| Content only (script, summary, key points, quiz, flashcards) | **$1.79 – $3.35** (about $0.02–0.04 per lesson) |
| Slide storyboards (only when narrating) | $1.01 – $1.64 |
| Gemini narration | about $10.17 |
| Everything | **about $13 – $15** |

After the sample, the confirmation dialog shows a **measured** per-lesson figure from the actual logged usage.

## 9. Test results (updated after the sample)

| Suite | Result |
|---|---|
| Academia API `npm test` | **212 / 212 pass** (191 before; 21 new in `gemini.test.js`, including the failure modes met in the real sample) |
| Academia web `npm run build` | **builds** |

`gemini.test.js` uses a mocked Gemini API, with no real calls. It covers:
- Gemini as the default provider and model, with no fallback;
- the key never reaching any response or URL;
- a missing key, with a reason naming `GEMINI_API_KEY`;
- documented structured output, with usage and cost logged at list price;
- the dated prices and versioned model names;
- an invalid key (400) and a forbidden key (403), each with a clear error and no retry;
- a 429 retried, and an exhausted quota reported;
- a timeout;
- malformed JSON rejected;
- Gemini speech: request shape, WAV to MP3, cost, cache, chunking, the style fallback, raw PCM;
- the batch: a one-lesson sample grounded in the chapter text, with per-lesson usage; confirmation and a measured estimate; resume; skipping existing content (an approved lesson was not overwritten); failed lessons recorded and retried only on request;
- job deduplication, and a clean stop at the budget;
- narration in the batch;
- intro and closing cards;
- a real FFmpeg render of a silent card plus a narrated scene.

**Not executed:** any real Gemini call (no key yet), a real voice-over, and a browser walkthrough of the new tab.

## 10. Remaining limitations

1. **The real sample is pending.** It waits for your key. The model's actual output length, quality and token accounting are unverified until then.
2. ~~Anthropic code is still present~~ **Removed** (see §13). Previously it was inactive: `ai/providers/anthropic.js`, the `@anthropic-ai/sdk` dependency, its price table and config entries. It is only reachable with `AI_PROVIDER=anthropic` or `AI_FALLBACK_PROVIDER=anthropic`, and neither is set. Per your Phase 7, removing it waits until Gemini has worked for real. The removal list is the references above, plus `aiRouter.test.js`, which tests Anthropic and needs rewriting for Gemini.
3. **Speech pacing.** Gemini speech has no numeric speaking-rate setting in the docs. Pace is directed through the style text, and `TTS_SPEAKING_RATE` applies to Google Cloud TTS only.
4. **Thinking level.** The `generateContent` field for it is not in the docs read, so the model default (medium) is used.
5. **Free tier.** If your key is on the free tier, quotas are lower: keep `AI_BATCH_CONCURRENCY=1`. The batch retries 429s with backoff, and failed lessons can be retried later.
6. **Prices change on 2027-01-01** (Flash and speech double). The table has both dates, but check Google's page if you generate later.
7. **Course-level generation** creates lesson content only; the course-level final assessment is still generated separately ("Generate Tests" in the Content Studio).

## 11. Generating all 83 lessons

1. Add `GEMINI_API_KEY=<your key>` to `Inspironics Academia/apps/api/.env`, then restart the Academia API (or `stop.bat` and `start.bat`).
2. Open AI Studio → **Course generation**, choose "Inspironics CK to Autonomous Intelligence Engineering Playbook — Complete Reference Edition" (14 modules, 83 lessons), and check that the status cards say "Google Gemini · gemini-3.8-flash — Connected".
3. Click **Generate a sample lesson**. It generates lesson 1, "Vision and Strategic Context".
4. Review it: in the table, open the Content Studio and check the script against Part 1 / Chapter 1 of the playbook, plus the summary, key points, 6 questions and 5 flashcards. Optionally click **Narrate** then **Render** to check voice, slides, subtitles and the MP4.
5. If the sample is good, click **Generate remaining lessons…**. The dialog shows the measured cost for the 82 remaining lessons; confirm. Turn on "Also record narration" and "Also render the MP4" for full videos.
6. Watch progress in the tab. **Stop after this lesson** halts cleanly, and running the batch again resumes. Failed lessons show their error; use **Retry** on one, or **Retry N failed**.
7. If the budget stops the batch, raise `AI_MONTHLY_BUDGET` (or the limit in the Usage & budget tab) and start the batch again; it continues where it stopped.
8. After Gemini has worked, approve the Anthropic code removal (limitation 2).

## 12. Real sample lesson (2026-11-10)

**Lesson:** "Vision and Strategic Context" (module 1, lesson 1 of course `84ea48e41b3bd61e92b20729`).

### What happened on the way

| Step | Result | Fix applied |
|---|---|---|
| Key check (free model listing) | Key accepted; `gemini-3.8-flash` and `gemini-3.8-flash-tts` both available | — |
| Content on `gemini-3.8-flash` | **503 "high demand"** on every attempt over about 5 minutes, and a tiny probe hung for 5 minutes. Google-side capacity; $0 billed | More retries (`GEMINI_MAX_ATTEMPTS`=5); clear overload message; in batches a delayed retry (`AI_BATCH_RETRY_DELAY_SECONDS`=60), a clean stop after two overloaded lessons in a row, and automatic resume of temporarily failed lessons |
| Switched `GEMINI_MODEL` to **`gemini-3.6-flash`** | Answers (stable GA; same price as 3.8 Flash). `gemini-3.5-flash-lite` also answers. Switch back with one `.env` line when 3.8 Flash recovers | — |
| First 3.6 answer | Runaway title (the whole lesson inside `video_title`), and the AI cache stored it unvalidated | AI answers are cached only after validation (bad cached answers are dropped); the script is the first schema field; required top-level fields; title `maxLength`; one automatic fresh retry for malformed or incomplete answers |
| Next answers | Questions without options or answers, flashcards without backs: Gemini treats fields not marked required as optional | The Gemini provider now marks every field required in the schema it sends (`requireAllFields`); single bad items are still dropped by the pipeline, not the whole lesson |
| Content | **Saved**, see below | — |
| Narration | 7 of 8 scenes voiced, then **429** (speech requests-per-minute limit) | Speech waits out per-minute limits (30, 60, 90 s; `GEMINI_TTS_RATE_LIMIT_WAIT_SECONDS`); finishing reused the 7 cached clips and the cached storyboard |
| MP4 render | First attempt failed with `ENOSPC` (the C: drive has under 40 MB free); the automatic retry succeeded | Processing temp moved to `TEMP_PROCESSING_DIR=data/tmp` (E:); a re-render was verified to use only E:. The one failing write was not identified, so free space on C: |

### Output (verified)

| Item | Result |
|---|---|
| Script | **1,235 words**, instructor style, grounded in Chapter 1: the connected-infrastructure problem, the seven-domain mandate, the three durable properties (traceability, differentiation protection, sequenced maturity), "data before intelligence before autonomy", L6 → L1 write-back only, the evidence doctrine, the non-goals |
| Relevance | 208 of 295 distinct long words of the script occur in the source chapter (155 in Chapter 1's own section) |
| Summary / key points / examples | 5 sentences / 7 points / 2 worked examples (an HVAC ESG audit trail, a chiller control loop) |
| Quiz | **6 questions**, 4 options each. Correct answers match the playbook, and each explanation cites the section (1.2, 1.3, 1.4, 3.3, 4.3, 4.4). Mix: 2 recall, 1 understanding, 2 application, 1 analysis |
| Flashcards | 5, each with a precise back |
| Slides | 8 storyboard slides in varied layouts (compare, table, steps, timeline, rule, points), timed to the narration |
| Narration | Gemini speech, voice Kore, 8 clips ≈ 6 minutes; audio billed at exactly 25 tokens per second, as documented |
| MP4 | **6 min 26 s**, 1280×720 H.264 + AAC, **0 decode errors**, 10.9 MB. Intro card, 8 slides, key-takeaways card. 91 subtitle cues (SRT + VTT), the first at 0:04 after the intro. Thumbnail |
| Status | `pending_review`; nothing is approved or published automatically |

### Measured usage and cost

| Request | Tokens in / out | Estimated cost |
|---|---|---|
| Lesson content (the successful call) | 14,792 / 6,238 | $0.030 |
| Slide storyboard | 9,411 / 7,272 | $0.034 |
| Narration, 8 clips (≈ 6 min) | ≈ 940 text / 9,270 audio | $0.084 |
| **One lesson, clean run** | | **≈ $0.15** |
| This sample including every failed or retried attempt above | | $0.26 |

**Projection for the remaining 82 lessons** (at this measured rate): about **$12–15** with narration and MP4; content only, about $2.50–4. That is within the $30 monthly cap.

The confirmation dialog's "measured" estimate currently averages the sample's $0.26, which includes the debugging attempts, so it will show about $21 for 82 lessons: a deliberately cautious figure.

**Time per lesson:** about 1 minute for content, 40 s for the storyboard, 1.5–3 minutes for narration (per-minute speech limits) and 3 minutes to render (in parallel). That is roughly 5 minutes per lesson, or about **7 hours** for 82 lessons at concurrency 1.

### Configuration now in `apps/api/.env` (non-secret lines)

`AI_ENABLED=true`, `AI_PROVIDER=gemini`, `GEMINI_MODEL=gemini-3.6-flash`, `AI_MONTHLY_BUDGET=30`, `MEDIA_PROVIDER=gemini`, `TEMP_PROCESSING_DIR=data/tmp`, plus `GEMINI_API_KEY` (set, never printed).

### New settings (also in `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_MAX_ATTEMPTS` | 5 | Attempts per Gemini request on 429/5xx, with backoff |
| `AI_BATCH_RETRY_DELAY_SECONDS` | 60 | Batch: wait before retrying a lesson after overload or a rate limit |
| `GEMINI_TTS_RATE_LIMIT_WAIT_SECONDS` | 30 | Speech: wait × attempt after a per-minute limit |

## 13. Anthropic removed, batch started (approved 2026-11-10)

### Anthropic removal (Academia)

| Removed | Where |
|---|---|
| Anthropic provider | `src/ai/providers/anthropic.js` (deleted) |
| Provider registration, key name | `src/ai/index.js`: `PROVIDERS = { gemini, ollama }` |
| Provider option and model setting | `src/config.js`: `AI_PROVIDERS = ['gemini', 'ollama', 'none']`; `ANTHROPIC_*` no longer read |
| Price table | `src/usage/pricing.js` (Gemini only) |
| `strictSchema()` (Claude strict mode) | `src/ai/schema.js` (`requireAllFields()` remains for Gemini) |
| SDK | `@anthropic-ai/sdk` uninstalled from `apps/api` (`package.json` and lockfile; 6 packages removed) |
| Settings | `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` removed from `.env.example` and the local `.env`; comments updated |
| Tests | `aiRouter.test.js` rewritten for Gemini (primary) and Ollama (an explicit, optional fallback); schema tests use `requireAllFields()` |
| Texts | Pricing note, demo comment |

**Kept on purpose:**
- The provider abstraction (`ai/index.js` router, `providers/http.js`), so another provider can be added later.
- Ollama, self-hosted and optional.

`AI_PROVIDER=anthropic` now leaves AI off with the message "AI_PROVIDER=anthropic is not supported (use gemini, ollama or none)", which is tested. No Anthropic or Base44 reference remains in Academia's active code; historical docs keep theirs. SlidesVault and Showcase still use the Anthropic SDK for their own AI features; they were outside this task and were not changed.

**Tests:** 213 / 213 pass. The web build succeeds.

### Batch

Started as a server job (`content:course`, the API's job worker) for the **82 lessons** without content, with narration and MP4. The sample lesson is skipped because it already has content.

Settings in use:
- `GEMINI_MODEL=gemini-3.6-flash`
- `AI_BATCH_CONCURRENCY=1`
- `AI_MONTHLY_BUDGET=30`

Expected: about 5 minutes and about $0.15 per lesson.

**Following progress:** AI Studio → Course generation shows the counts, the current lesson, errors with **Retry**, and **Stop after this lesson**. The job continues if the browser is closed. After an API restart it resumes where it stopped.
