# R0 — Current-state discovery and scope validation

Date: 2026-11-14 · Branch `Feature-base-removal` at `4add53f` (clean, pushed) · Baseline: `docs/APEX_MASTER_PLAN.md`

**Legend**
- **[V] Verified.** Seen in the repository or produced by a command, with evidence.
- **[A] Assumption.**
- **[?] Open.** Needs founder input.

**Method.** Every database finding comes from **snapshot copies** of the local SQLite files (db + WAL + SHM), opened read-only. A SHA-256 fingerprint of all live database files was identical before and after the run (`68b244641d41a2a7`). No application code, schema or data was changed in R0.

---

## 1. Discrepancies between the master plan and the repository

| # | Plan statement | Repository evidence | Effect |
|---|---|---|---|
| D1 | Remediation and root CI are "uncommitted" (§0 finding 9, §2 Deployment, §13 action 1) | [V] Committed and pushed as `8e11ccb`, `190b866`, `b4bcc32`, `1fab9a4`, `9d4a36c`, `4add53f`. GitHub Actions run `43420040675`: all 6 jobs succeeded | Next action 1 is **done**. The plan's current-state rows are outdated on this point |
| D2 | Postgres and Docker are unverified | [V] **Externally verified in CI:** the SlidesVault Docker image builds, and the SlidesVault migrations run on Postgres 16 (same run). Still unverified: Academia and Showcase on Postgres | Lowers deployment risk for SlidesVault only; Academia/Core on Postgres remains a prerequisite (ADR 0001) |
| D3 | The implementation brief refers to `AGENTS.md` | [V] No `AGENTS.md` or `CLAUDE.md` exists anywhere in the repository (excluding `node_modules`) | Conventions were taken from the code and existing docs instead. Founder may want to add one |
| D4 | Five personas cover the user base | [V] **Every current Academia user has audience `employee`** (1 admin, 1 user). Academia's built-in categories target staff: "Corporate Knowledge Base" and others (`packages/shared/src/audience.js`). Employees are none of the five personas | Inspironics staff must be modelled, at least as an operational role (staff learner, author, mentor). New decision DEC-013 |
| D5 | Identity consolidation is a migration risk because of volume (§13 risks) | [V] 4 accounts, 2 distinct emails across all three apps (§3) | The risk is **design correctness**, not volume. Manual review of links is cheap (ADR 0003) |
| D6 | Preserve existing learning records and certificates (brief rule 4) | [V] Local Academia data: 0 certificates, 0 quiz attempts, 1 course-progress record. Content is the asset: 11 courses, 200 modules, 714 lessons, 2,523 questions, 1,340 flashcards (§4) | Preservation still applies. The local database is a development database; no production data exists [V audit] |
| D7 | Identity is email and password (§8.1) | [V] Showcase users carry `provider` and `verified` columns (Google sign-in) | Core identity needs external sign-in links, not only password hashes (ADR 0002) |
| D8 | — | [V] `node --test <folder>` fails on Windows for the new discovery tests; naming the test file works | CI names the file explicitly |

All other plan current-state findings checked in R0 still hold:
- the gateway's credential fan-out (`apex/auth.mjs`)
- one role column per app
- the `audience` column (migration `005_user_audience`)
- the `Team` roster of names (`entities.js`)
- the `certification` assessment type (`entities.js`)
- the absence of organisations, projects, challenges, portfolios and consent

---

## 2. Named areas (Use Case 001)

| Area | Repository evidence | Status |
|---|---|---|
| Inspironics Academy | [V] `Inspironics Academia/`, which uses four names: "Inspironics Academia", "Engineering Academy", "Inspironics Learn", "Inspironics Academy" | Exists; naming open (DEC-011) |
| "Slide World" | [V] No string "Slide World" anywhere. The closest app is **SlidesVault** (`slide vault/`), a presentation library | **[?] Unresolved (DEC-001).** Not planned until confirmed |
| Innovations | [V] No separate module. The Showcase hero labels the plate count "Innovations" | **[?] Open (DEC-002)** |
| Showcase | [V] `inspironics-innovation-showcase/`, a curated corporate catalogue | Exists |

Use Case 001 **cannot be closed by engineering**: it is a founder decision.

---

## 3. Cross-application user overlap (Use Case 002)

Tool: `tools/discovery/user-overlap.mjs` (tests: `tools/discovery/user-overlap.test.mjs`, 5 passing).
- The full summary is regenerable with the command in the tool header.
- The per-account detail contains personal data and is kept **outside the repository**: `E:\apex-review-tmp\r0\user-overlap-detail-2026-11-14.csv`. The tool refuses to write it inside the repository.

| App | Table | Accounts | Active | Admins | Sign-in |
|---|---|---|---|---|---|
| Academia | `users` | 2 | 2 | 1 | password 2 |
| Showcase | `users` | 1 | 1 | 1 | password 1 |
| SlidesVault | `app_user` | 1 | 1 | 1 | password 1 |

| Measure | Result |
|---|---|
| Distinct emails (normalised for reporting) | 2 |
| In all three apps | 1, classified **multi-app-conflict** (reason: name differs) |
| In Academia only | 1, classified single-app |
| Duplicates within an app; accounts without email | 0; 0 |
| Accounts merged or linked | **0.** The report never merges (ADR 0003) |

**Schema differences** the R1 migration must map:

| | Academia | Showcase | SlidesVault |
|---|---|---|---|
| Name column | `full_name` | `name` | `full_name` |
| Status | `disabled` (integer) | `disabled` (integer) | `status` (text) |
| Created column | `created_date` | `created_at` | `created_at` |
| Extra columns | `audience`, `avatar_url` | `provider`, `verified`, `picture` | `last_active_at` |

---

## 4. Records R1 must preserve (Academia, local development database)

| Kind | Count | | Kind | Count |
|---|---:|---|---|---:|
| Courses / modules / lessons / chapters | 11 / 200 / 714 / 1,074 | | Certificates | 0 |
| Questions / assessments / flashcards | 2,523 / 54 / 1,340 | | Course progress / quiz attempts | 1 / 0 |
| Playbooks / versions / categories | 16 / 19 / 3 | | Meetings / transcripts / action items / teams | 18 / 18 / 60 / 3 |
| Users / login history / sessions | 2 / 56 / 5 | | Applied migrations | 8 |

Showcase and SlidesVault content is synced from Dropbox, and its sources are re-syncable. User-generated state there (favourites, analytics) is small and was not counted in R0.

---

## 5. Persona matrix validation (master plan §3)

| Persona | Data available today | Missing for entry conditions | Mapping from existing data | Verdict |
|---|---|---|---|---|
| 1. Student (not final year) | Name, email, avatar | Institution, programme, year of study, expected graduation, consent | None (no student users exist) | Feasible in R1–R2; entry rule needs DEC-003 |
| 2. Final-year / intern | Academia audience `intern` (content filter only) | Graduation date, application, eligibility record | `audience = intern` *suggests* candidates but proves nothing about final-year status | Feasible; needs an application and eligibility model (R3) |
| 3. Alumni | Nothing | Prior intern record or verification source | None | Blocked on DEC-005 (who verifies) |
| 4. Industry | Nothing | Organisation, membership, agreements | None | Needs organisations (R1 schema) and legal terms (DEC-004) |
| 5. Executive | Academia audience `leadership` (content filter only) | Objectives, initiatives | `audience = leadership` maps to content visibility only | Feasible (R5) |
| (Staff, not in the plan) | **All current users** (audience `employee`) | — | `audience = employee` | **Gap D4:** add a staff role, or confirm staff are out of scope (DEC-013) |

The organisation account vs organisation administrator distinction in the plan holds: no conflicting structure exists.

---

## 6. Decision log

DEC-007, DEC-008, DEC-009 and DEC-013 were approved by the founder on 2026-11-14 (recorded verbatim in the phase report). All other decisions remain open; their engineering recommendations are defaults only and are not to be treated as approved. §9 records why each open decision does not block the authorised R1 scope.

| ID | Decision | Options | Recommended default | Blocks |
|---|---|---|---|---|
| DEC-001 | What is "Slide World", and its purpose per persona? | SlidesVault / something else / drop | — (founder only) | Any work on that area (Use Case 041) |
| DEC-002 | Are Innovations and Showcase separate? | Separate module / one area | Separate Innovation module for challenges; Showcase for publication | R4 scope |
| DEC-003 | Who may register; are under-18 users in scope? | Invite-only / partner institutions / open | Invite-only for pilot; no under-18 users until legal guidance | R1 onboarding, consent design |
| DEC-004 | IP and confidentiality for student, intern and industry work | — (legal) | — | R3 publication, R4 challenges |
| DEC-005 | Who verifies alumni, against which records? | Prior intern record / institution evidence / manual | Auto from APEX intern history, else manual with evidence | R4 alumni |
| DEC-006 | Confirmed pilot partners | — | None evidenced in the repository | R4, R6 pilot |
| DEC-007 | Core approach | ADR 0001 options A–D | **Approved 2026-11-14 (founder):** Academia's API becomes APEX Core within one modular codebase; constrained identity and authorization tables; existing content and functionality preserved | — (unblocked R1) |
| DEC-008 | Identity assertion | ADR 0002 | **Approved with conditions 2026-11-14 (founder):** signed, short-lived, per-application assertions; verify signature, issuer, audience and expiry; key rotation and documented revocation; strip client-supplied identity headers; prevent direct backend bypass; every app still enforces scoped authorization | — (conditions are R1 acceptance criteria) |
| DEC-009 | Account-linking policy | ADR 0003 | **Approved 2026-11-14 (founder):** explicit reviewed mappings only; never merge on email alone; passwordless Google sign-in preserved through verified provider-and-subject mappings | — (unblocked R1) |
| DEC-010 | Hosting target and data residency | — | Linux container host behind HTTPS | R1 staging, R6 |
| DEC-011 | External name for the Academy | Four variants in the code | One name, applied in R1 navigation | R1 navigation copy |
| DEC-012 | Who staffs mentor, assessor and publication-reviewer roles | — | Nominate by R3 | R3 |
| DEC-013 | How are Inspironics employees represented? | Staff role / out of scope / separate persona | **Approved 2026-11-14 (founder):** Inspironics organisation membership plus an explicit Staff role; staff may also hold learner, mentor, assessor or administrator assignments; employment never grants privileged access automatically | — (unblocked R1) |

---

## 7. Legal, consent and privacy inputs needed before R1 onboarding ships

1. The lawful basis and consent wording for students and alumni, by purpose: learning analytics, mentoring, publication.
2. Age policy (DEC-003), and guardian consent if minors are ever in scope.
3. Retention periods for evaluations, completion records and audit events, and what erasure may anonymise.
4. IP assignment and licence terms for student, intern and industry work (DEC-004). NDA templates for industry challenges.
5. Data residency and processor list: Dropbox, AI providers and email providers already appear in the code.

---

## 8. Exit gate status

See §9 for the criterion-by-criterion evaluation and `docs/implementation/R0_PHASE_REPORT.md` for the verdict.

---

## 9. R0 exit evaluation (2026-11-14)

### 9.1 Mandatory criteria

| # | Criterion | Evidence | Result |
|---|---|---|---|
| E1 | Use Case 002 report produced, data unmodified | Tool and 5 fixture tests; live database hashes identical before and after (§3, phase report §4) | Pass |
| E2 | Discovery tests pass in GitHub CI | Recorded in the phase report §4 after the push | See phase report |
| E3 | Existing regression unaffected | Gateway 13/13 locally; app code unchanged in R0 | Pass |
| E4 | No personal data or secrets committed | Diff review before commit (phase report §4) | See phase report |
| E5 | Architecture decisions required by R1 approved | DEC-007, DEC-008, DEC-009, DEC-013 approved by founder | Pass |
| E6 | Remaining decisions documented as non-blocking for the authorised R1 scope | §9.2 | Pass |
| E7 | Persona matrix validated | §5 | Pass |

### 9.2 Open decisions and why each does not block the authorised R1 scope

The founder authorised this R1 scope: shared identity, reviewed account mappings, organisation membership, scoped roles, gateway security and private staging readiness. The founder explicitly held public registration, production consent screens, student-work publication and real external onboarding.

| ID | Status | Why it does not block R1 | Blocks later |
|---|---|---|---|
| DEC-001 "Slide World" | Open; **Use Case 001 deliberately unresolved** | R1 renames and consolidates nothing; SlidesVault keeps its name and behaviour and only gains identity verification | Any work defining that area |
| DEC-002 Innovations vs Showcase | Open | R1 does not touch either area's scope | R4 |
| DEC-003 Registration and age policy | Open | Public registration is held; development uses invitation-only adult test accounts | R2 onboarding, any public sign-up |
| DEC-004 IP and confidentiality | Open | Publication and challenges are held | R3 publication, R4 challenges |
| DEC-005 Alumni verification | Open | Alumni features are not in R1; the role catalogue may name the role, but nothing grants it automatically | R4 |
| DEC-006 Pilot partners | Open | No external organisations are onboarded in R1 (only the Inspironics organisation) | R4, R6 |
| DEC-010 Hosting and data residency | Open | R1 delivers *private staging readiness* (images, compose, runbook, CI verification) without deploying | Actual staging or production deployment |
| DEC-011 Academy name | Open | R1 adds no new naming; existing strings are unchanged | R2 navigation copy |
| DEC-012 Reviewer staffing | Open | No review workflows in R1 beyond administrator review of identity links | R3 |
