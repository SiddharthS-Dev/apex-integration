# AI-assisted stakeholder onboarding — implementation plan

- Date: 2026-11-16
- Source: `APEX_AI_Onboarding_Master_Prompt.md` (founder)
- Repository state: `Feature-base-removal` @ `2aee3b0`, CI 8/8 green
- Status: **slices O1–O4 implemented and tested locally (2026-11-16), flags off, not yet committed.** What was built, deviations from this plan, and results: `ONBOARDING_HANDOVER.md`

## 1. What the repository actually has (inspected)

| Need | Existing service to reuse | Evidence |
|---|---|---|
| Identity, sessions | APEX Core = Academia API: `users` (scrypt hashes, per-user salt, constant-time compare), sessions (12 h, httpOnly, SameSite=Lax) | `Inspironics Academia/apps/api/src/auth/*`; ADR 0001 |
| Password policy | `validatePassword()` | `src/auth/passwords.js` |
| Invitations | Admin invite: creates the account with a temporary password plus a 7-day set-password link | `src/auth/routes.js` `POST /invite` |
| Roles and scopes | `role_assignments` (scoped, dated), `organizations`, `organization_memberships`, default-deny `can()`, `audit_events` | `src/core/*`; R1 contract |
| Linking and Google | Reviewed identity links; Google only via `(provider, subject)` | ADR 0003; `src/core/linking.js`, `google.js` |
| Login lockout | Per-email lockout, shared module | `src/auth/lockout.js` |
| Rate limiting | `src/http/rateLimit.js` (in memory, per process) | Audit F-014 |
| Email | Outbox with retry; transports `log` (default), Resend, SMTP. **Real delivery has never been verified** | `src/notify/*` |
| AI | `invokeLLM({ system, prompt, schema })`: Gemini or Ollama, JSON-schema output, usage and budget limits, server-only keys | `src/ai/index.js`, `src/usage/*` |
| Gateway | One sign-in; every path except allow-listed public paths requires sign-in; signed per-app identity assertions | `apex/server.mjs`, `apex/projects.mjs` (`publicPaths`) |
| Registration today | `POST /api/auth/register`; closed in staging (`ALLOW_REGISTRATION=false`) | `src/auth/routes.js` |

**Modules for orientation.**

| Status | Modules |
|---|---|
| **Exist** | Academy learning: courses, lessons, quizzes, tests, completion records, spaced repetition; Innovation Showcase gallery; SlidesVault deck library |
| **Do not exist** | Internships, applied projects, mentoring, industry challenges, partnerships, executive dashboards, skills assessment (master plan R3–R5) |

Orientation will **not** fabricate the missing ones. It shows a truthful "not available yet — contact" step and lists each in the handover.

## 2. Category → access mapping (proposal)

Categories are profile data, never roles. The approver chooses roles explicitly; the system only proposes the least-privileged default.

| Code | Default proposal at approval | Never implied |
|---|---|---|
| `STUDENT_LEARNER` | `student` + `learner` (platform) | — |
| `INTERNSHIP_CANDIDATE` | `learner` (platform) | `intern` (only by a later offer workflow, R3) |
| `ALUMNI_MEMBER` | `learner` (platform) | `alumni` (only with verified evidence); `mentor` |
| `INDUSTRY_PROFESSIONAL` | `learner` (platform) | Any organisation membership (external organisations held); `org_admin` |
| `EXECUTIVE_LEADER` | `learner` (platform) | `platform_admin`, `org_admin`, any admin |

Resource scope defaults to empty. The approver's delegable authority is enforced with the existing `can(actor, 'role.grant', …)`. In v1, only a `platform_admin` may approve, because external organisations, and so organisation-scoped approvers, are held.

## 3. Data (Core migration `011_registration_requests`, additive)

**`registration_requests`**
- id, normalized email, name, claimed organisation (text, never trusted)
- `primary_category_code` (CHECK in the five codes), `category_profile` (JSON plus `schema_version`), `interest_codes` (JSON), preferences (JSON)
- `status` (CHECK in CODE_SENT, EMAIL_VERIFIED, PENDING_APPROVAL, INFO_REQUESTED, APPROVED, REJECTED, EXPIRED, SUPERSEDED)
- verification timestamps
- `code_digest` (HMAC-SHA256 over request id, generation and code, with server secret `REGISTRATION_CODE_SECRET`), `code_generation`, `code_expires_at`, `failed_attempts` (lifetime, never reset), `sends`
- `credential_hash` (temporary scrypt; cleared at decision or expiry)
- `resume_token_hash` with its expiry
- `ai_recommendation` (JSON) with source (`ai` or `rules`, set by the server), model and schema version
- info request and response
- decision actor, reason and time
- approved user, approved category and approved roles (stored separately from the requested ones)
- `created_at`, `updated_at`, `retention_due_at`

Indexes and constraints: partial unique on normalized email for open states, so one live request per address.

**Failed-attempt durability.** Attempt counters are written in their own statement before the comparison result is used, so a rollback can't erase them.

## 4. Flow and endpoints

**State machine (enforced on the server):**

```
CODE_SENT → EMAIL_VERIFIED → PENDING_APPROVAL → APPROVED | REJECTED
PENDING_APPROVAL ↔ INFO_REQUESTED
any open state → EXPIRED | SUPERSEDED
```

**Public, behind flags; Core under `/api/onboarding/*`, reached through the gateway as public paths:**

| Endpoint | Purpose |
|---|---|
| `GET /config` | Configuration |
| `POST /suggest` | Bounded AI suggestions, with rules fallback |
| `POST /start` | Uniform response for new, existing and pending addresses |
| `POST /resend` | Resend the code |
| `POST /verify` | Check the code |
| `POST /update` | Edit the request |
| `POST /complete` | Submit with password (existing policy) |
| `GET /status` | Resume |
| `POST /respond` | Answer an information request |

**Admin, `platform_admin` only, under `/api/core/registrations/*`:**

| Endpoint | Purpose |
|---|---|
| `GET /` | Queue |
| `GET /:id` | Request detail |
| `POST /:id/approve` | One transaction: lock, re-check, create the user through the existing user service (or refuse a duplicate email; **no merge**), assign roles via `insertAssignment`, clear secrets, audit |
| `POST /:id/reject` | Reason required |
| `POST /:id/request-info` | Ask the applicant for more information |

Emails go through the existing outbox after commit.

**Gateway changes:**
- public page `/join` (scripted state machine UI, plain-text model output, strict CSP with hashed scripts, accessible)
- public API allow-list for the onboarding routes only
- same-origin check
- rate limits per IP

The resume token travels in an httpOnly cookie scoped to the onboarding path. No session exists before approval.

## 5. AI (all optional; deterministic fallback always runs)

| Function | Input (bounded, sanitised) | Output (validated field by field) | Fallback |
|---|---|---|---|
| A. Interest mapping | Category, purpose text, skills, allow-listed interest catalogue. **No name or email** | `{reply, suggested_category_code, interest_codes, clarification_needed}` | Keep selections; keyword guide |
| B. Region and preferences | Region answer, browser time zone and locale only | `{reply, country_code, region_label, timezone, locale, date_format, unit_system}` | Browser time zone; unknown country; neutral formats |
| C. Review assistant | Category, objective, structured profile, email domain, approver-safe role catalogue | `{summary, suggested_category_code, suggested_role_code, suggested_organization_id, suggested_resource_ids, onboarding_path_code, observations}`; `source` set by the server | The rules engine always runs first; invalid fields fall back one by one; empty scope stays empty |

Through `invokeLLM` with timeout and token caps. The AI has no tools and never decides.

## 6. Flags (all default **off**)

| Flag | Controls |
|---|---|
| `ONBOARDING_ENABLED` | The `/join` entry point and the onboarding flow |
| `SELF_REGISTRATION_ENABLED` | Public start and submission |
| `ONBOARDING_AI_ENABLED` | AI suggestions |
| `HELP_ASSISTANT_ENABLED` | The authenticated help assistant (deferred) |

Plus `PUBLIC_BASE_URL` (trusted origin for emailed links) and `REGISTRATION_CODE_SECRET`.

The existing `ALLOW_REGISTRATION`, invitations and Google flows are unchanged. **Production enablement is refused unless an approved consent-notice version is configured (§9).**

## 7. Delivery slices, each tested and committed separately

| Slice | Contents |
|---|---|
| **O1** | Migration, state machine, code and resume-token handling, admin review and atomic approval (no AI, no UI) |
| **O2** | Gateway `/join` conversational UI; admin review screens in People & access |
| **O3** | AI functions A–C with fallbacks |
| **O4** | Category-aware orientation using only the existing modules |
| **Deferred** | Authenticated help assistant (§11 of the prompt) |

## 8. Validation

All of §13 of the prompt, with LLM calls mocked:
- five-category end-to-end runs
- account-existence non-disclosure across the whole public flow
- code expiry, attempt budget, resend invalidation and send caps
- races: concurrent approvals produce exactly one user
- delegable-authority enforcement in both the API and the UI
- secrets absent from logs, chat and LLM payloads
- AI failure modes
- accessibility checks in headless Chrome

The CI staging smoke test is extended with an onboarding run, in which the code is read from a test-only outbox in CI.

## 9. Decisions that block safe implementation

1. **Hold on public registration** (founder, 2026-11-14): does this request supersede it, with the flags kept off outside development and staging until the policies are approved?
2. **Age:** is v1 adults only (18+ attestation), with no student under 18 until a guardian-consent policy exists?
3. **Consent notice:** production stays blocked without an approved version. For development and staging, may I use a clearly marked draft notice?
4. **Sequencing against R1:** R1 is still pending (your account linking). Is onboarding authorised as an R1 extension (Use Case 007), or as R2?

**Not blocking, but needed before production:**
- verified real email delivery (Resend or SMTP)
- `PUBLIC_BASE_URL`
- an AI provider key and budget
- an alumni verification policy (DEC-005)
- an IP and data policy for industry and executive enquiries (DEC-004)

## 10. Founder decisions (2026-11-16)

| ID | Decision |
|---|---|
| DEC-014 | **Build, flags off.** Implement and test fully. Every onboarding flag defaults off. Enabled only in development and the isolated CI staging. Production enablement is refused until an approved consent-notice version is configured. This supersedes the 2026-11-14 hold *for implementation only*; public enablement stays held |
| DEC-015 | **Adults only in v1.** Applicants attest they are 18 or older. Applicants under 18 are told the programme is not open to them yet. No age or birth date is stored |
| DEC-016 | **Draft consent notice in development and staging only,** clearly marked DRAFT. The server refuses production enablement without an approved notice version |
| DEC-017 | **R1 extension (Use Case 007),** delivered in slices O1 to O4 with separate commits. The R1 exit gate still also requires the account linking (Use Case 004) |
