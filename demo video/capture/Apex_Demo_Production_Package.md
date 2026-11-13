# Apex product demo: production package

Status: capture script, storyboard, narration and subtitle pipeline are ready. The MP4 is **not yet rendered**: it needs one capture run on your PC (see Workflow). Nothing below claims a result that has not been observed.

## Workflow
1. Make sure Apex is running (`start.bat`, http://localhost:5173, or `start.bat prod`).
2. Double-click `demo video\capture\run-capture.bat` (add the URL as an argument for prod). It records 1920x1080 with a visible cursor, click ripples and highlight rings, and writes `out\` (frames, marks.json, issues.json, steps.json).
3. Tell Claude "capture done". Claude reads `out\issues.json`, fixes any failed step, re-runs `build_srt.py` so subtitles follow the real scene marks, generates the voice-over, and runs `assemble.sh` to produce `Apex_Product_Demo.mp4`.

## Storyboard (scene, real route, on-screen action)
| # | Scene | Route / action |
|---|---|---|
| 1 | Intro | Logo card: "Three platforms. One front door." |
| 2 | Login | `/login`: type admin email, masked password, submit; shared sign-in opens all three apps |
| 3 | Dashboard | `/`: three platform cards with live Ready status, recent activity feed, Ctrl+K quick search |
| 4 | Innovation Showcase | `/showcase/`: gallery scroll, ecosystem explorer, reports, copilot (each only if present) |
| 5 | SlidesVault | `/vault/`: library, search, open a deck, `/vault/dashboard` analytics, offline library, user manual |
| 6 | Academia | `/academia/courses`, playbooks, tests, certificates, then admin overview, AI studio and integrations (view only) |
| 7 | End-to-end workflow | Dashboard, then SlidesVault search, then open deck (scene 5), told as one story in the narration |
| 8 | Finale | Dashboard again, hover each card, outro card |

## Narration
Full text: `narration.json` (8 blocks, about 2.5 words per second). Subtitles: `Apex_Demo.srt` (currently estimated timing; rebuilt from real marks after capture).

## Feature coverage checklist
| Feature | Source | In script | Verified on screen |
|---|---|---|---|
| Single sign-in | README, live | yes | pending capture |
| Dashboard cards and live status | live page text | yes | seen (3/3 Ready) |
| Recent activity feed | live page text | yes | seen |
| Quick search (Ctrl+K) | live page text | yes | pending |
| Showcase gallery, ecosystem, reports | card text, router | yes | pending |
| SlidesVault library, search, viewer, analytics, offline, manual | routes | yes | pending |
| Academia courses, playbooks, tests, certificates | routes | yes | pending |
| Academia admin: AI studio, integrations | routes | view only | pending |
| Create/edit/delete forms (CRUD) | n/a | **not included** | see issues |
| Export/download, role-based permissions, user management | not confirmed | not included | not demonstrated |

## Testing and issue report (preliminary)
1. **Write workflows not recorded.** Your brief asks for form entry and submission, but also says not to modify application data without authorization. The capture is read-only. Approve specific safe writes (for example a test bookmark) and I will add them.
2. **Academia "Sync failed" (28 min ago)** is shown in the dashboard's Recent activity. I will not hide it: either fix the sync before recording, or I crop the activity panel. Your call.
3. **Showcase count mismatch.** The dashboard says 342 blueprints; the old Apex_Demo_Video.srt says 235. The new narration uses no number.
4. **Admin credentials on screen.** The typed email shows; the password is a masked field. The password is read from the project's `.env` at run time and is not stored in any script.
5. Selectors for Showcase and Vault actions were not testable before the run; every miss is logged in `issues.json` and will be fixed from there.
6. Real-data caution: pages show whatever is in your local database. Review the final video for private deck titles before sharing.

## Video production summary
- Capture: headless Chrome through puppeteer-core (already in the Showcase project), CDP screencast, 1920x1080, assembled to 30 fps H.264 CRF 18 by ffmpeg.
- Overlay: cursor, ripple and highlight ring are injected into the page for recording only; no app code or UI is changed.
- Voice-over: not yet generated. Needs a natural English voice; I will use the best TTS available once capture is done, or you can supply an ElevenLabs or Google TTS key (Academia already has these configured).
- Music: optional low-volume bed, not included until you supply a licensed track.

---
## Update: edit pipeline (produce.py)
Originals preserved as `capture.mjs.orig`, `narration.json.orig`, `Apex_Demo.srt.orig`.

Changes to `capture.mjs` (still read-only): intro/outro cards removed (now produced in the edit); dashboard facts recorded to `out/facts.json` (Sync failed visible, blueprint count, platforms ready) so narration follows what is actually on screen; Apex-link return transition, sign-out and key screenshots added; Academia admin/AI-studio/integrations pages dropped.

`narration_final.json` replaces the old narration: no blueprint count, no export/roles/user-management, no single-session or security claims. The limitation line plays only if "Sync failed" is actually visible at capture time; the sign-out line only if sign-out succeeded.

`produce.py` builds: animated opening, explainer and closing cards; per-scene cut, subtle zoom, lower third; voice per phrase so subtitle timing comes from real audio; loudness-normalised mix; `Apex_Demo_Final.mp4` (clean), `Apex_Demo_Subtitled.mp4` (burned), `Apex_Demo.srt`, `voiceover.wav`, screenshots. Pipeline tested end-to-end on a synthetic stand-in (never delivered); cards and subtitle layout were inspected by eye. Rendering is resumable: re-run the same command until it prints OK.

Voice: local Kokoro (Apache-2.0) via `kokoro-onnx`, needs one approved model download (about 326 MB). No music is included (no licensed track available).
