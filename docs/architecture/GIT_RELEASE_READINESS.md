# Git release readiness — Base44 removal, AI Studio, Dropbox storage

| | |
|---|---|
| Date | 2026-11-10 |
| Repository | `github.com/SiddharthS-Dev/apex-integration`, local `E:\apex` |
| Branch | `feature-classification-personas` @ `ce2366e` (upstream `origin/feature-classification-personas`) |
| Git | 2.53.0.windows.1, `core.autocrlf=true`, no hooks, no `.gitattributes` |
| Scope | Inspection only. No file, index entry or commit was changed. The only repository-side action was `git fetch origin main`, which updated the remote-tracking ref `origin/main` and nothing else |

## 1. Verdict

**READY TO COMMIT once approved: 6 commits, no conflicts expected.**

- Every pending change is accounted for: 181 paths, each assigned to exactly one commit or the
  exclusion list.
- The Base44 removal is complete.
- No secrets, databases or generated files are candidates for commit.
- The feature branch is in sync with its upstream.
- `origin/main` has the same file tree as `HEAD`.

Nothing has been committed, pushed or merged.

## 2. Git change summary

| State | Count | Meaning |
|---|---:|---|
| Staged deletions (`D `) | 43 | The 42 Base44 paths + `Inspironics Academia/apps/api/src/ai/claude.js` (replaced by `ai/providers/anthropic.js`) |
| Modified, unstaged (` M`) | 69 | Edits across all three apps |
| Untracked, not ignored (`??`) | 69 | New modules, tests, docs, 2 repository reports, 1 stray file |
| **Total paths** | **181** | (+1 once this document is added) |
| Stashes | 0 | |
| `assume-unchanged` / `skip-worktree` | 0 | |

Lines changed versus `HEAD`:

| App | Files | Lines |
|---|---:|---|
| Academia | 137 | about +8,560 / −3,628 (new files counted by line) |
| SlidesVault | 35 | +146 / −1,963 |
| Showcase | 6 | +87 / −6 |
| Root | 3 | reports, plus 1 excluded stray file |

The diff is identical with line endings ignored, so it contains no line-ending churn.

### Classification (all 181 paths)

| Category | Paths | Where |
|---|---:|---|
| Base44 removal | 65 | Academia: 29 deletions (legacy folder, `ai/base44.js`, `ai/claude.js`, `media/providers/base44.js`, 2 Base44 tests), `rls.js` comment. SlidesVault: 14 deletions and 18 edits (web API layer, auth pages, `package.json`/lockfile, `start.bat`, READMEs) |
| Independent AI Studio (replaces Base44) | 62 | Academia AI router and providers, TTS providers, video engine, jobs, usage/limits, studio API, AI Studio web UI, tests, `docs/ai-studio`, `package.json` (+`@resvg/resvg-js`, `ffmpeg-static`) and lockfile |
| Dropbox / storage optimisation | 32 | Academia: Dropbox client/processing/output, streaming, temp store, storage report/clean-up, sync, PPTX extraction, `dropboxStorage.test.js`, `DropboxPicker`, `StorageDashboard`, `docs/dropbox`. SlidesVault: retention and `.tmp` fixes + test. Showcase: cache TTL + test |
| AI Studio + Dropbox (same file) | 19 | `config.js`, `server.js`, `pipeline/index.js`, `processPlaybookExtract.js`, `renderVideo.js`, `renderer.js`, `piper.js`, `studio/routes.js`, `usage/log.js`, shared `entities.js`/`constants.js`, `.env.example`, `README.md`, web `http.js`, `demo/index.js`, `lib/studio.js`, `AIStudio.jsx`, `VideoStudio.jsx`, `ContentGenerator.jsx` |
| Release documentation | 2 (+1) | `FINAL_PRODUCTION_READINESS_REPORT.md`, `docs/architecture/BASE44_REMOVAL_FINAL_AUDIT.md` (+ this file) |
| Unrelated | 1 | `ync handling` at the repository root — stray, **exclude** |
| Generated, databases, logs, temp | 0 | All are git-ignored (§4) |

The full per-file list is in §9.

## 3. Base44 removal completeness

| Check | Result |
|---|---|
| Base44-named paths at `HEAD` | 42 |
| …staged as deleted | **42 / 42** |
| …still in the index | 0 |
| Other `HEAD` files whose content mentioned Base44 | 30. All now have 0 mentions, except `Inspironics Academia/docs/BUILD_SPEC.md` (6 historical mentions, intentional) |
| `@base44/sdk` in any `package.json` / lockfile | 0 (removed from `slide vault/apps/web/package.json` and `slide vault/package-lock.json`, which is in commit C1) |
| Replacement for each deleted module | `ai/base44.js` and `ai/claude.js` → `ai/index.js` + `ai/providers/*`; `media/providers/base44.js` → `media/providers/{google-tts,elevenlabs,piper}.js`; SlidesVault `base44Client.js` → `backendClient.js` + `apiClient.js` |

## 4. Never commit

| Item | Status |
|---|---|
| `Inspironics Academia/apps/api/.env`, `slide vault/apps/api/.env`, `inspironics-innovation-showcase/apps/api/.env` | Ignored (each app's `.gitignore`) |
| `apex/.session-secret` (gateway signing key) | Ignored (root `.gitignore:18`), not tracked |
| `inspironics-innovation-showcase/apps/api/data/.dev-encryption-key` | Ignored |
| Databases: `academy.db` (+`-wal`/`-shm`), `data/backups/*.db`, `slidesvault.db`, `app.db` | Ignored (`apps/api/data`) |
| Object stores (`apps/api/data/objects`, including 1.6 GB of Dropbox copies and narration) | Ignored |
| `dist/` build output (rebuilt during the audits) | Ignored |
| `node_modules/` (including the empty `slide vault/node_modules/@base44/`) | Ignored |
| `*.log` | Ignored |
| `ync handling` (root, 713 bytes) | **Not ignored** — leave it out of every `git add` (the commands in §7 never touch it) |
| `E:\apex-review-tmp\` (audit helper scripts and logs) | Outside the repository |

A secret scan of all 181 candidate paths for Anthropic, Google, Resend and GitHub key patterns,
private keys, Dropbox tokens, and the known Dropbox app key and secret found **0 matches**. No
`.env` file is tracked.

## 5. Branches and potential conflicts

| Check | Result |
|---|---|
| Feature vs `origin/feature-classification-personas` | 0 behind / 0 ahead: **in sync** (checked live with `git ls-remote`) |
| Feature vs `origin/main` (`925ad23`, fetched today) | 2 behind / 0 ahead. The 2 commits are the merge commits of PR #2 and PR #3 (this branch) |
| File differences `HEAD` ↔ `origin/main` | **0 files**, so a merge of this work into main cannot conflict |
| Local `main` | `6bf4660`, 29 commits behind `origin/main`. Stale; do not use it as a base |
| `origin/feature-meeting-module`, `origin/vault-dropbox-api`, local `main` | Already merged into `origin/main`; each still has the 42 Base44 paths at its tip |
| Uncommitted work vs `origin/main` | Applies cleanly: same base tree |

**Can the old configuration bring Base44 back?** No. This was tested by loading the config with
`AI_ENABLED=true AI_PROVIDER=base44 MEDIA_PROVIDER=base44 BASE44_APP_ID=x BASE44_SERVER_URL=https://base44.app`:

| Path back to Base44 | Result |
|---|---|
| Old Academia `.env` values | `aiProvider` resolves to `none` (`config.js` whitelist `anthropic`, `gemini`, `ollama`, `none`) and AI is disabled. `MEDIA_PROVIDER=base44` matches no provider (`TTS_PROVIDERS = { google, elevenlabs, piper }`), so voice-over is disabled. `BASE44_*` variables are read nowhere |
| Old SlidesVault web `.env` (`VITE_BASE44_APP_ID`, `VITE_BASE44_SERVER_URL`) | Read nowhere. Without `VITE_API_BASE_URL` the app reports "no backend" instead of contacting Base44 |
| Reinstalling packages | `npm ci` can't restore `@base44/sdk`: it is in no lockfile |
| Merging an old branch | No effect: all old branches are ancestors of `origin/main` |
| Checking out an old branch or `HEAD~` | Would restore the files locally, as with any history; it would not affect `main` once this work is merged |

**Caveat.** An old value fails *silently*: AI or voice-over is simply off, with no startup warning
naming the unknown provider. Worth a follow-up change (not made here: no source edits).

## 6. Recommended commit sequence

Each app lives in its own folder with its own `package.json` and lockfile, and no app imports
another's code. So per-app commits leave every intermediate state buildable.

Academia's three streams of work can't be split by file: 19 files carry both AI Studio and Dropbox
changes, and the shared modules import each other (for example `studio/routes.js` imports
`dropbox/processing.js` and `storage/storage.js`, and `renderer.js` imports `files/tempStore.js`).
Splitting would need interactive hunk staging and would leave intermediate commits that don't build.
Academia code therefore goes in **one commit (C4)**, with its documentation in C5.

| # | Commit message | Files | Verify after |
|---|---|---:|---|
| C1 | `refactor(vault): remove the Base44 SDK and legacy functions` | 32 | `slide vault/apps/web`: `npm run build` |
| C2 | `fix(vault): run preview-cache retention without scheduled sync; clean partial writes` | 3 | `slide vault/apps/api`: `npm test` (203) |
| C3 | `fix(showcase): bound the preview cache with a daily TTL sweep; clean partial writes` | 6 | `inspironics-innovation-showcase/apps/api`: `npm test` (49) |
| C4 | `feat(academia): independent AI Studio replacing Base44, with Dropbox-first storage` | 115 | `Inspironics Academia/apps/api`: `npm test` (187); `apps/web`: `npm run build` |
| C5 | `docs(academia): AI Studio, provider setup and Dropbox storage documentation` | 22 | — |
| C6 | `docs: Base44 removal audit and release-readiness reports` | 3 | — |

Every commit is authored as **SiddharthS-Dev**, matching the existing history, with no
co-author trailer, as previously instructed.

## 7. Exact commands (run only after approval)

Git Bash, from the repository root. Each `git commit … -- <paths>` commits **only** those paths; the
other staged deletions stay staged for their own commit. This was verified with
`git commit --dry-run --short`. Untracked files must be `git add`ed first. The stray `ync handling`
file is never named.

```bash
cd /e/apex
export GIT_AUTHOR_NAME="SiddharthS-Dev"  GIT_AUTHOR_EMAIL="297077192+SiddharthS-Dev@users.noreply.github.com"
export GIT_COMMITTER_NAME="SiddharthS-Dev" GIT_COMMITTER_EMAIL="297077192+SiddharthS-Dev@users.noreply.github.com"

# Optional, recommended: bring in the two merge commits from main (no file changes; fast-forward only).
git merge-base --is-ancestor HEAD origin/main && git diff --quiet HEAD origin/main && git merge --ff-only origin/main

# Pre-flight check: expect 181 (or 182 with this document), and only the stray file left at the end.
git status --porcelain -uall | wc -l

# C1 — SlidesVault: remove Base44 (expect 32 entries)
C1=("slide vault/README.md" "slide vault/apps/api/docs/DEPLOYMENT.md" "slide vault/apps/web" "slide vault/legacy" "slide vault/package-lock.json" "slide vault/start.bat")
git add -- "slide vault/apps/web/src/api/backendClient.js"
git commit --dry-run --short -- "${C1[@]}" | grep -cE '^[MADR]'
git commit -m "refactor(vault): remove the Base44 SDK and legacy functions" \
  -m "SlidesVault's web app talks only to its own API (backendClient/apiClient) or the opt-in local demo. Drops @base44/sdk, base44Client.js and legacy/base44; start.bat and docs use VITE_API_BASE_URL." \
  -- "${C1[@]}"
(cd "slide vault/apps/web" && npm run build)
git push origin feature-classification-personas

# C2 — SlidesVault: preview-cache retention (expect 3)
C2=("slide vault/apps/api/src/services/scheduler/SyncScheduler.js" "slide vault/apps/api/src/services/storage/ObjectStore.js" "slide vault/apps/api/tests/unit/storage.test.js")
git add -- "slide vault/apps/api/tests/unit/storage.test.js"
git commit --dry-run --short -- "${C2[@]}" | grep -cE '^[MADR]'
git commit -m "fix(vault): run preview-cache retention without scheduled sync; clean partial writes" -- "${C2[@]}"
(cd "slide vault/apps/api" && npm test)
git push origin feature-classification-personas

# C3 — Showcase: cache TTL (expect 6)
C3=("inspironics-innovation-showcase/apps/api")
git commit --dry-run --short -- "${C3[@]}" | grep -cE '^[MADR]'
git commit -m "fix(showcase): bound the preview cache with a daily TTL sweep; clean partial writes" \
  -m "OBJECT_CACHE_TTL_HOURS (default 336) removes derivatives unused that long; the sweep runs whether or not scheduled sync is on." \
  -- "${C3[@]}"
(cd inspironics-innovation-showcase/apps/api && npm test)
git push origin feature-classification-personas

# C4 — Academia code (expect 115)
C4=("Inspironics Academia/apps" "Inspironics Academia/packages" "Inspironics Academia/legacy" "Inspironics Academia/package-lock.json")
git add -- "Inspironics Academia/apps" "Inspironics Academia/packages"
git commit --dry-run --short -- "${C4[@]}" | grep -cE '^[MADR]'
git commit -m "feat(academia): independent AI Studio replacing Base44, with Dropbox-first storage" \
  -m "Removes the Base44 AI and voice providers and legacy/base44. Adds the AI router (Anthropic, Gemini, Ollama), Google TTS / ElevenLabs / Piper voice-over with caching, an FFmpeg video engine, background jobs, usage limits and cost tracking, and the AI Studio admin UI. Dropbox stays the primary store: sync is metadata-only, previews stream from Dropbox, unchanged revisions are not re-extracted, temporary files are tracked and swept, a storage report and dry-run-first clean-up, and optional upload of rendered videos to Dropbox." \
  -- "${C4[@]}"
(cd "Inspironics Academia/apps/api" && npm test) && (cd "Inspironics Academia/apps/web" && npm run build)
git push origin feature-classification-personas

# C5 — Academia docs (expect 22)
C5=("Inspironics Academia/docs" "Inspironics Academia/README.md")
git add -- "Inspironics Academia/docs"
git commit --dry-run --short -- "${C5[@]}" | grep -cE '^[MADR]'
git commit -m "docs(academia): AI Studio, provider setup and Dropbox storage documentation" -- "${C5[@]}"
git push origin feature-classification-personas

# C6 — Repository reports (expect 3)
C6=("FINAL_PRODUCTION_READINESS_REPORT.md" "docs/architecture")
git add -- "${C6[@]}"
git commit --dry-run --short -- "${C6[@]}" | grep -cE '^[MADR]'
git commit -m "docs: Base44 removal audit and release-readiness reports" -- "${C6[@]}"
git push origin feature-classification-personas

# Post-check: only the stray file may remain.
git status --porcelain -uall      # expect exactly:  ?? "ync handling…"
git ls-tree -r --name-only HEAD | grep -ci base44   # expect 0
```

If any dry-run count differs from the expected number, stop. Don't commit; investigate first.

**Open a pull request to `main` after the pushes.** This is not a merge.

```bash
gh pr create --base main --head feature-classification-personas \
  --title "Remove Base44: independent AI Studio, Dropbox-first storage" \
  --body-file docs/architecture/GIT_RELEASE_READINESS.md
```

**After the PR is merged (separate approval):**
- Fast-forward the stale local `main` with `git checkout main && git merge --ff-only origin/main`.
- Optionally delete the fully merged remote branches `feature-meeting-module` and `vault-dropbox-api`,
  so nobody branches from a Base44-era tip.

## 8. Before release (outside git)

These are not blockers for committing; they come from the readiness and audit reports.

1. Configure an AI provider and a voice provider; run one approved live smoke test of each.
2. Run the Academia suite once against Postgres.
3. Do a browser walkthrough of AI Studio, Academia lessons and meetings, and the SlidesVault sign-in and catalog.
4. Pre-existing dependency advisories: `jspdf` (critical, major upgrade) and `body-parser` (high, `npm audit fix`).
5. Production env: unique `TOKEN_ENCRYPTION_KEY`, `COOKIE_SECURE=true`, production Dropbox redirect
   URIs, `TEMP_PROCESSING_DIR` with disk space.
6. Follow-up code change: log a startup warning for an unknown `AI_PROVIDER` / `MEDIA_PROVIDER` (§5 caveat).

## 9. Every pending file, by commit

Status: **A** added (untracked), **M** modified, **D** deleted. Line counts are against `HEAD`; for
new files, the file's line count.

#### C1 — SlidesVault — remove Base44

32 files (17 modified, 1 added, 14 deleted), +81 / −1952 lines

| St | File | Area | +/− |
|---|---|---|---|
| M | `slide vault/apps/api/docs/DEPLOYMENT.md` | Base44 removal | +3/−3 |
| M | `slide vault/apps/web/.env.example` | Base44 removal | +4/−13 |
| M | `slide vault/apps/web/package.json` | Base44 removal | +2/−3 |
| A | `slide vault/apps/web/src/api/backendClient.js` | Base44 removal | +46/−0 |
| D | `slide vault/apps/web/src/api/base44Client.js` | Base44 removal | +0/−156 |
| M | `slide vault/apps/web/src/api/entities.js` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/api/functions.js` | Base44 removal | +3/−4 |
| M | `slide vault/apps/web/src/api/integrations.js` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/api/localClient.js` | Base44 removal | +4/−5 |
| M | `slide vault/apps/web/src/components/AiCopilot.jsx` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/lib/AuthContext.jsx` | Base44 removal | +2/−2 |
| M | `slide vault/apps/web/src/pages/DropboxSettings.jsx` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/pages/ForgotPassword.jsx` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/pages/Login.jsx` | Base44 removal | +2/−2 |
| M | `slide vault/apps/web/src/pages/Register.jsx` | Base44 removal | +1/−1 |
| M | `slide vault/apps/web/src/pages/ResetPassword.jsx` | Base44 removal | +1/−1 |
| D | `slide vault/legacy/base44/entities/DropboxConfig.json` | Base44 removal | +0/−18 |
| D | `slide vault/legacy/base44/entities/LoginHistory.json` | Base44 removal | +0/−13 |
| D | `slide vault/legacy/base44/entities/Presentation.json` | Base44 removal | +0/−36 |
| D | `slide vault/legacy/base44/entities/PresentationAnalytics.json` | Base44 removal | +0/−31 |
| D | `slide vault/legacy/base44/entities/SyncLog.json` | Base44 removal | +0/−18 |
| D | `slide vault/legacy/base44/functions/dropboxAuth/entry.ts` | Base44 removal | +0/−194 |
| D | `slide vault/legacy/base44/functions/getDownloadLinks/entry.ts` | Base44 removal | +0/−57 |
| D | `slide vault/legacy/base44/functions/getPresentationStream/entry.ts` | Base44 removal | +0/−86 |
| D | `slide vault/legacy/base44/functions/recordLogin/entry.ts` | Base44 removal | +0/−31 |
| D | `slide vault/legacy/base44/functions/renameUntitledPresentations/entry.ts` | Base44 removal | +0/−172 |
| D | `slide vault/legacy/base44/functions/syncDropbox/entry.ts` | Base44 removal | +0/−414 |
| D | `slide vault/legacy/base44/functions/trackView/entry.ts` | Base44 removal | +0/−126 |
| D | `slide vault/legacy/base44/shared/dropboxClient.ts` | Base44 removal | +0/−269 |
| M | `slide vault/package-lock.json` | Base44 removal | +0/−271 |
| M | `slide vault/README.md` | Base44 removal | +2/−15 |
| M | `slide vault/start.bat` | Base44 removal | +6/−6 |

#### C2 — SlidesVault — preview-cache retention

3 files (2 modified, 1 added), +65 / −11 lines

| St | File | Area | +/− |
|---|---|---|---|
| M | `slide vault/apps/api/src/services/scheduler/SyncScheduler.js` | Dropbox/storage | +11/−8 |
| M | `slide vault/apps/api/src/services/storage/ObjectStore.js` | Dropbox/storage | +9/−3 |
| A | `slide vault/apps/api/tests/unit/storage.test.js` | Dropbox/storage | +45/−0 |

#### C3 — Showcase — preview-cache TTL

6 files (6 modified), +87 / −6 lines

| St | File | Area | +/− |
|---|---|---|---|
| M | `inspironics-innovation-showcase/apps/api/.env.example` | Dropbox/storage | +3/−0 |
| M | `inspironics-innovation-showcase/apps/api/src/config.js` | Dropbox/storage | +2/−0 |
| M | `inspironics-innovation-showcase/apps/api/src/services.js` | Dropbox/storage | +1/−1 |
| M | `inspironics-innovation-showcase/apps/api/src/storage/objectStore.js` | Dropbox/storage | +35/−2 |
| M | `inspironics-innovation-showcase/apps/api/src/sync/scheduler.js` | Dropbox/storage | +16/−3 |
| M | `inspironics-innovation-showcase/apps/api/test/units.test.mjs` | Dropbox/storage | +30/−0 |

#### C4 — Academia — Base44 removal + AI Studio + Dropbox storage (code, tests)

115 files (42 modified, 29 deleted, 44 added), +6967 / −3624 lines

| St | File | Area | +/− |
|---|---|---|---|
| M | `Inspironics Academia/apps/api/.env.example` | AI Studio + Dropbox/storage (shared) | +86/−17 |
| M | `Inspironics Academia/apps/api/package.json` | AI Studio (replaces Base44) | +2/−0 |
| D | `Inspironics Academia/apps/api/src/ai/base44.js` | Base44 removal | +0/−90 |
| D | `Inspironics Academia/apps/api/src/ai/claude.js` | Base44 removal | +0/−102 |
| A | `Inspironics Academia/apps/api/src/ai/index.js` | AI Studio (replaces Base44) | +147/−0 |
| A | `Inspironics Academia/apps/api/src/ai/providers/anthropic.js` | AI Studio (replaces Base44) | +72/−0 |
| A | `Inspironics Academia/apps/api/src/ai/providers/gemini.js` | AI Studio (replaces Base44) | +71/−0 |
| A | `Inspironics Academia/apps/api/src/ai/providers/http.js` | AI Studio (replaces Base44) | +42/−0 |
| A | `Inspironics Academia/apps/api/src/ai/providers/ollama.js` | AI Studio (replaces Base44) | +32/−0 |
| A | `Inspironics Academia/apps/api/src/ai/schema.js` | AI Studio (replaces Base44) | +59/−0 |
| M | `Inspironics Academia/apps/api/src/app.js` | AI Studio (replaces Base44) | +5/−1 |
| M | `Inspironics Academia/apps/api/src/config.js` | AI Studio + Dropbox/storage (shared) | +97/−14 |
| M | `Inspironics Academia/apps/api/src/db/migrations.js` | AI Studio (replaces Base44) | +59/−0 |
| M | `Inspironics Academia/apps/api/src/dropbox/client.js` | Dropbox/storage | +89/−1 |
| A | `Inspironics Academia/apps/api/src/dropbox/output.js` | Dropbox/storage | +95/−0 |
| A | `Inspironics Academia/apps/api/src/dropbox/processing.js` | Dropbox/storage | +116/−0 |
| M | `Inspironics Academia/apps/api/src/files/playbookSource.js` | Dropbox/storage | +56/−14 |
| M | `Inspironics Academia/apps/api/src/files/routes.js` | Dropbox/storage | +33/−8 |
| A | `Inspironics Academia/apps/api/src/files/tempStore.js` | Dropbox/storage | +91/−0 |
| M | `Inspironics Academia/apps/api/src/functions/routes.js` | AI Studio (replaces Base44) | +7/−1 |
| A | `Inspironics Academia/apps/api/src/jobs/queue.js` | AI Studio (replaces Base44) | +185/−0 |
| M | `Inspironics Academia/apps/api/src/media/index.js` | AI Studio (replaces Base44) | +106/−32 |
| D | `Inspironics Academia/apps/api/src/media/providers/base44.js` | Base44 removal | +0/−37 |
| A | `Inspironics Academia/apps/api/src/media/providers/elevenlabs.js` | AI Studio (replaces Base44) | +40/−0 |
| A | `Inspironics Academia/apps/api/src/media/providers/google-tts.js` | AI Studio (replaces Base44) | +83/−0 |
| A | `Inspironics Academia/apps/api/src/media/providers/piper.js` | AI Studio + Dropbox/storage (shared) | +45/−0 |
| M | `Inspironics Academia/apps/api/src/media/providers/README.md` | AI Studio (replaces Base44) | +30/−66 |
| A | `Inspironics Academia/apps/api/src/media/providers/textChunks.js` | AI Studio (replaces Base44) | +28/−0 |
| A | `Inspironics Academia/apps/api/src/media/video/ffmpeg.js` | AI Studio (replaces Base44) | +68/−0 |
| A | `Inspironics Academia/apps/api/src/media/video/renderer.js` | AI Studio + Dropbox/storage (shared) | +277/−0 |
| A | `Inspironics Academia/apps/api/src/media/video/slides.js` | AI Studio (replaces Base44) | +288/−0 |
| A | `Inspironics Academia/apps/api/src/media/video/subtitleGenerator.js` | AI Studio (replaces Base44) | +57/−0 |
| M | `Inspironics Academia/apps/api/src/meetings/routes.js` | Dropbox/storage | +7/−8 |
| M | `Inspironics Academia/apps/api/src/pipeline/generateAssessment.js` | AI Studio (replaces Base44) | +1/−1 |
| M | `Inspironics Academia/apps/api/src/pipeline/generateLessonContent.js` | AI Studio (replaces Base44) | +6/−2 |
| M | `Inspironics Academia/apps/api/src/pipeline/generateLessonMedia.js` | AI Studio (replaces Base44) | +4/−3 |
| M | `Inspironics Academia/apps/api/src/pipeline/generateMeetingVideo.js` | AI Studio (replaces Base44) | +6/−5 |
| M | `Inspironics Academia/apps/api/src/pipeline/index.js` | AI Studio + Dropbox/storage (shared) | +11/−2 |
| M | `Inspironics Academia/apps/api/src/pipeline/processMeeting.js` | AI Studio (replaces Base44) | +4/−4 |
| M | `Inspironics Academia/apps/api/src/pipeline/processPlaybookExtract.js` | AI Studio + Dropbox/storage (shared) | +27/−6 |
| M | `Inspironics Academia/apps/api/src/pipeline/processPlaybookStructure.js` | AI Studio (replaces Base44) | +1/−1 |
| A | `Inspironics Academia/apps/api/src/pipeline/renderVideo.js` | AI Studio + Dropbox/storage (shared) | +247/−0 |
| M | `Inspironics Academia/apps/api/src/pipeline/text.js` | Dropbox/storage | +34/−1 |
| M | `Inspironics Academia/apps/api/src/server.js` | AI Studio + Dropbox/storage (shared) | +8/−1 |
| A | `Inspironics Academia/apps/api/src/storage/storage.js` | Dropbox/storage | +247/−0 |
| A | `Inspironics Academia/apps/api/src/studio/contentTypes.js` | AI Studio (replaces Base44) | +64/−0 |
| A | `Inspironics Academia/apps/api/src/studio/projects.js` | AI Studio (replaces Base44) | +147/−0 |
| A | `Inspironics Academia/apps/api/src/studio/routes.js` | AI Studio + Dropbox/storage (shared) | +333/−0 |
| M | `Inspironics Academia/apps/api/src/sync/pipeline.js` | Dropbox/storage | +5/−10 |
| A | `Inspironics Academia/apps/api/src/usage/context.js` | AI Studio (replaces Base44) | +15/−0 |
| A | `Inspironics Academia/apps/api/src/usage/limits.js` | AI Studio (replaces Base44) | +74/−0 |
| A | `Inspironics Academia/apps/api/src/usage/log.js` | AI Studio + Dropbox/storage (shared) | +97/−0 |
| A | `Inspironics Academia/apps/api/src/usage/pricing.js` | AI Studio (replaces Base44) | +48/−0 |
| A | `Inspironics Academia/apps/api/test/aiRouter.test.js` | AI Studio (replaces Base44) | +184/−0 |
| D | `Inspironics Academia/apps/api/test/base44-anon.test.js` | Base44 removal | +0/−41 |
| D | `Inspironics Academia/apps/api/test/base44.test.js` | Base44 removal | +0/−67 |
| M | `Inspironics Academia/apps/api/test/contentPipeline.test.js` | AI Studio (replaces Base44) | +8/−7 |
| A | `Inspironics Academia/apps/api/test/dropboxStorage.test.js` | Dropbox/storage | +343/−0 |
| M | `Inspironics Academia/apps/api/test/media.test.js` | AI Studio (replaces Base44) | +0/−39 |
| M | `Inspironics Academia/apps/api/test/meetings.test.js` | AI Studio (replaces Base44) | +1/−1 |
| M | `Inspironics Academia/apps/api/test/meetingVideo.test.js` | AI Studio (replaces Base44) | +22/−19 |
| A | `Inspironics Academia/apps/api/test/studio.test.js` | AI Studio (replaces Base44) | +311/−0 |
| A | `Inspironics Academia/apps/api/test/tts.test.js` | AI Studio (replaces Base44) | +152/−0 |
| A | `Inspironics Academia/apps/api/test/videoEngine.test.js` | AI Studio (replaces Base44) | +124/−0 |
| M | `Inspironics Academia/apps/api/test/videoPlan.test.js` | AI Studio (replaces Base44) | +1/−1 |
| M | `Inspironics Academia/apps/web/src/api/drivers/demo/index.js` | AI Studio + Dropbox/storage (shared) | +33/−0 |
| M | `Inspironics Academia/apps/web/src/api/drivers/http.js` | AI Studio + Dropbox/storage (shared) | +41/−0 |
| M | `Inspironics Academia/apps/web/src/App.jsx` | AI Studio (replaces Base44) | +2/−0 |
| M | `Inspironics Academia/apps/web/src/components/admin/review/MediaTab.jsx` | AI Studio (replaces Base44) | +14/−0 |
| M | `Inspironics Academia/apps/web/src/components/admin/studio/StudioGenerateButtons.jsx` | AI Studio (replaces Base44) | +27/−4 |
| M | `Inspironics Academia/apps/web/src/components/admin/studio/useStudioActions.js` | AI Studio (replaces Base44) | +28/−1 |
| M | `Inspironics Academia/apps/web/src/components/meetings/VideoBriefingTab.jsx` | AI Studio (replaces Base44) | +13/−2 |
| M | `Inspironics Academia/apps/web/src/components/shell/NavLinks.jsx` | AI Studio (replaces Base44) | +2/−2 |
| A | `Inspironics Academia/apps/web/src/components/studio/ContentGenerator.jsx` | AI Studio + Dropbox/storage (shared) | +115/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/DropboxPicker.jsx` | Dropbox/storage | +90/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/GenerationHistory.jsx` | AI Studio (replaces Base44) | +55/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/JobStatus.jsx` | AI Studio (replaces Base44) | +45/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/RenderedVideoPanel.jsx` | AI Studio (replaces Base44) | +59/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/StorageDashboard.jsx` | Dropbox/storage | +265/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/StudioFields.jsx` | AI Studio (replaces Base44) | +39/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/UsageBudget.jsx` | AI Studio (replaces Base44) | +105/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/VideoStudio.jsx` | AI Studio + Dropbox/storage (shared) | +274/−0 |
| A | `Inspironics Academia/apps/web/src/components/studio/VoiceStudio.jsx` | AI Studio (replaces Base44) | +80/−0 |
| A | `Inspironics Academia/apps/web/src/lib/studio.js` | AI Studio + Dropbox/storage (shared) | +87/−0 |
| M | `Inspironics Academia/apps/web/src/lib/useAppConfig.js` | AI Studio (replaces Base44) | +1/−0 |
| M | `Inspironics Academia/apps/web/src/pages/admin/AdminDashboard.jsx` | AI Studio (replaces Base44) | +2/−1 |
| A | `Inspironics Academia/apps/web/src/pages/admin/AIStudio.jsx` | AI Studio + Dropbox/storage (shared) | +59/−0 |
| D | `Inspironics Academia/legacy/base44/base44Client.js` | Base44 removal | +0/−10 |
| D | `Inspironics Academia/legacy/base44/config.jsonc` | Base44 removal | +0/−11 |
| D | `Inspironics Academia/legacy/base44/entities/Assessment.jsonc` | Base44 removal | +0/−91 |
| D | `Inspironics Academia/legacy/base44/entities/Bookmark.jsonc` | Base44 removal | +0/−42 |
| D | `Inspironics Academia/legacy/base44/entities/Certificate.jsonc` | Base44 removal | +0/−69 |
| D | `Inspironics Academia/legacy/base44/entities/Chapter.jsonc` | Base44 removal | +0/−59 |
| D | `Inspironics Academia/legacy/base44/entities/Course.jsonc` | Base44 removal | +0/−102 |
| D | `Inspironics Academia/legacy/base44/entities/CourseProgress.jsonc` | Base44 removal | +0/−95 |
| D | `Inspironics Academia/legacy/base44/entities/Flashcard.jsonc` | Base44 removal | +0/−84 |
| D | `Inspironics Academia/legacy/base44/entities/Lesson.jsonc` | Base44 removal | +0/−127 |
| D | `Inspironics Academia/legacy/base44/entities/LessonFeedback.jsonc` | Base44 removal | +0/−77 |
| D | `Inspironics Academia/legacy/base44/entities/Module.jsonc` | Base44 removal | +0/−56 |
| D | `Inspironics Academia/legacy/base44/entities/Playbook.jsonc` | Base44 removal | +0/−94 |
| D | `Inspironics Academia/legacy/base44/entities/PlaybookVersion.jsonc` | Base44 removal | +0/−76 |
| D | `Inspironics Academia/legacy/base44/entities/Question.jsonc` | Base44 removal | +0/−115 |
| D | `Inspironics Academia/legacy/base44/entities/QuizAttempt.jsonc` | Base44 removal | +0/−103 |
| D | `Inspironics Academia/legacy/base44/entities/ReviewSchedule.jsonc` | Base44 removal | +0/−67 |
| D | `Inspironics Academia/legacy/base44/functions/generateAssessment/entry.ts` | Base44 removal | +0/−263 |
| D | `Inspironics Academia/legacy/base44/functions/generateLessonContent/entry.ts` | Base44 removal | +0/−276 |
| D | `Inspironics Academia/legacy/base44/functions/generateLessonMedia/entry.ts` | Base44 removal | +0/−140 |
| D | `Inspironics Academia/legacy/base44/functions/processPlaybookExtract/entry.ts` | Base44 removal | +0/−748 |
| D | `Inspironics Academia/legacy/base44/functions/processPlaybookStructure/entry.ts` | Base44 removal | +0/−259 |
| D | `Inspironics Academia/legacy/base44/functions/verifyCertificate/entry.ts` | Base44 removal | +0/−40 |
| D | `Inspironics Academia/legacy/base44/README.md` | Base44 removal | +0/−7 |
| M | `Inspironics Academia/package-lock.json` | AI Studio (replaces Base44) | +379/−0 |
| M | `Inspironics Academia/packages/shared/src/constants.js` | AI Studio + Dropbox/storage (shared) | +4/−0 |
| M | `Inspironics Academia/packages/shared/src/entities.js` | AI Studio + Dropbox/storage (shared) | +249/−0 |
| M | `Inspironics Academia/packages/shared/src/rls.js` | Base44 removal | +1/−1 |

#### C5 — Academia — documentation

22 files (20 added, 2 modified), +1593 / −4 lines

| St | File | Area | +/− |
|---|---|---|---|
| A | `Inspironics Academia/docs/ai-studio/AI_PROVIDER_SETUP.md` | AI Studio (replaces Base44) | +75/−0 |
| A | `Inspironics Academia/docs/ai-studio/AI_STUDIO_ARCHITECTURE.md` | AI Studio (replaces Base44) | +81/−0 |
| A | `Inspironics Academia/docs/ai-studio/API_DOCUMENTATION.md` | AI Studio (replaces Base44) | +91/−0 |
| A | `Inspironics Academia/docs/ai-studio/BASE44_DEPENDENCY_AUDIT.md` | Base44 removal | +351/−0 |
| A | `Inspironics Academia/docs/ai-studio/BASE44_REMOVAL_REPORT.md` | Base44 removal | +43/−0 |
| A | `Inspironics Academia/docs/ai-studio/GENERATION_COST_OPTIMIZATION.md` | AI Studio (replaces Base44) | +47/−0 |
| A | `Inspironics Academia/docs/ai-studio/GOOGLE_TTS_SETUP.md` | AI Studio (replaces Base44) | +66/−0 |
| A | `Inspironics Academia/docs/ai-studio/MIGRATION_GUIDE.md` | AI Studio (replaces Base44) | +58/−0 |
| A | `Inspironics Academia/docs/ai-studio/TESTING_REPORT.md` | AI Studio (replaces Base44) | +63/−0 |
| A | `Inspironics Academia/docs/ai-studio/VIDEO_ENGINE_SETUP.md` | AI Studio (replaces Base44) | +63/−0 |
| M | `Inspironics Academia/docs/BUILD_SPEC.md` | Base44 removal | +1/−1 |
| A | `Inspironics Academia/docs/dropbox/AI_DROPBOX_PROCESSING_WORKFLOW.md` | Dropbox/storage | +66/−0 |
| A | `Inspironics Academia/docs/dropbox/APEX_STORAGE_CONSUMPTION_REPORT.md` | Dropbox/storage | +71/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_API_CONFIGURATION.md` | Dropbox/storage | +75/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_FILE_LIFECYCLE.md` | Dropbox/storage | +69/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_INTEGRATION_AUDIT.md` | Dropbox/storage | +70/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_OPTIMIZED_ARCHITECTURE.md` | Dropbox/storage | +57/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_SECURITY_REVIEW.md` | Dropbox/storage | +70/−0 |
| A | `Inspironics Academia/docs/dropbox/DROPBOX_TESTING_REPORT.md` | Dropbox/storage | +65/−0 |
| A | `Inspironics Academia/docs/dropbox/STORAGE_RETENTION_POLICY.md` | Dropbox/storage | +51/−0 |
| A | `Inspironics Academia/docs/dropbox/VIDEO_GENERATION_DROPBOX_WORKFLOW.md` | Dropbox/storage | +56/−0 |
| M | `Inspironics Academia/README.md` | AI Studio + Dropbox/storage (shared) | +4/−3 |

#### C6 — Repository-level reports

2 files (2 added), +532 / −0 lines

| St | File | Area | +/− |
|---|---|---|---|
| A | `docs/architecture/BASE44_REMOVAL_FINAL_AUDIT.md` | Release docs | +344/−0 |
| A | `FINAL_PRODUCTION_READINESS_REPORT.md` | Release docs | +188/−0 |

#### EXCLUDE — Never commit

1 files (1 added), +10 / −0 lines

| St | File | Area | +/− |
|---|---|---|---|
| A | `ync handling` | Unrelated (stray) | +10/−0 |

#### C6 (also) — this document

| St | File | Area | +/− |
|---|---|---|---|
| A | `docs/architecture/GIT_RELEASE_READINESS.md` | Release docs | new |
