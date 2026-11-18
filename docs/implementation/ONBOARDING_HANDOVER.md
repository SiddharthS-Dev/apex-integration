# Enterprise onboarding (Use Case 007): Phase 3 handover

- Date: 2026-11-17
- Branch: `Feature-base-removal`
- Status: uncommitted; nothing pushed or deployed
- Authority: DEC-014 to DEC-017, and the Phase 3 approval of 2026-11-17
- Plan: `ONBOARDING_PLAN.md`

## 1. What exists now

| Part | Where | Port |
|---|---|---|
| Enterprise Onboarding Assistant (new, separate app) | `onboarding/`: a dependency-free Node server and one page | **5180** |
| Shared backend | The portal's own Academia Core API: onboarding routes `/api/onboarding/*`, reviewer routes `/api/core/registrations*` | 4177 |
| Reviewer screen | The portal: Academia → People & access → **Access requests** | via 5173 |
| Sign-in, password setting | Unchanged portal features: `5173/login`, and the invitation email's set-password link | 5173 |

**The gateway is identical to its committed version.** Earlier uncommitted gateway work (the `/join` page, the "Request access" link on the sign-in page, the gateway relay) was removed. Dropbox OAuth, Google sign-in, sessions and cookies are untouched.

## 2. The six roles

The roles are defined in one central catalogue, `ONBOARDING_ROLES` in `Inspironics Academia/packages/shared/src/onboarding.js`.

| Role | Stored category | Reviewer may grant | Follow-ups |
|---|---|---|---|
| Intern | `INTERNSHIP_CANDIDATE` | learner; intern only once the offer is verified | mentor name, only if a mentor was assigned |
| Alumni / Former Member | `ALUMNI_MEMBER` | learner; alumni only once the association is verified | completion year, only if a programme was completed |
| Industry Partner | `INDUSTRY_PROFESSIONAL` | learner | partnership description if "other"; contact name if someone else |
| CEO, VP, Director (three separate configurations) | `EXECUTIVE_LEADER` | learner only | — |

**For every role:**
- No phone number, no address, and no location beyond an optional country.
- No password at any point in the conversation.
- Each role has its own wording and a verification note shown to the reviewer.

**Grant limits are enforced on the server.** Every administrator role, and any grant not listed for the role, is refused with 403. The API's privilege-escalation tests cover this.

## 3. Flow

1. Welcome and the 18+/consent attestation.
2. The role, chosen from cards in three groups.
3. Name, then email (worded per role).
4. The organisation, where the role requires it.
5. The role's questions, one at a time, with quick replies, Back and Skip for optional questions, and follow-ups that appear only when an earlier answer calls for them.
6. Country (optional).
7. The review: "Would you like to review and confirm your information?" Each item has Edit, then **Confirm and Submit**.
8. A 6-digit email code, then submission.
9. The submitted message:

   > "Your onboarding request has been submitted successfully. Your information will be reviewed by the appropriate administrator. You will receive an update once your account is approved."

**Reviewer actions:** filter by role, open a request, see the verification note and advice, then approve (nothing pre-ticked, an explicit confirmation) or ask a question or reject.

**After approval:**
1. The account is created with only the ticked roles. Its credential is random and unusable.
2. The **existing invitation email** is sent, with its 7-day set-password link.
3. The person sets a password and signs in at `5173/login`.

**Resume:** reloading the page continues where the person left off (code entry, review, waiting, or answering a question).

**AI:** the conversation is deterministic and needs no AI. Reviewer advice can use the existing AI adapter when `ONBOARDING_AI_ENABLED=true`; it is off by default. Each field the model returns is validated, privileged suggestions are refused, and it falls back to the rules on any failure.

## 4. Database

- **No change was made.**
- **Migration 011** was already applied to the real `academy.db` on 2026-11-16 at 11:51 UTC, before Phase 3. The applied table matches the migration column for column. It was not modified or re-run.
- **The role** is stored in the existing `category_profile` JSON (`onboarding_role`, profile schema version 2). No new table, no new migration.
- **Backup before any change:** `E:\apex-backups\academy-20261117-104446\`
  - contains `academy.db`, its `-wal` and `-shm` files, and a copy of the Academia `.env` taken before the append
  - SHA-256 of the live and backup files match (`live-before.sha256`, `backup.sha256`)
  - opened read-only from a scratch copy: integrity check ok, 46 tables
- **After the change** (checked on a fresh copy): integrity ok, still 13 migrations, users and role assignments unchanged.

## 5. Configuration changed

`Inspironics Academia/apps/api/.env`: four keys **appended** (none existed; nothing overwritten):

| Key | Value | Purpose |
|---|---|---|
| `ONBOARDING_ENABLED` | `true` | switches the flow on |
| `SELF_REGISTRATION_ENABLED` | `true` | allows new requests |
| `PUBLIC_BASE_URL` | `http://localhost:5180` | emailed "answer a question" links open the assistant |
| `ONBOARDING_DEV_LOG_CODES` | `true` | prints verification codes in the Academia API window; no email service is configured; ignored in production |

- **To switch onboarding off:** set `ONBOARDING_ENABLED=false` and restart the portal.
- **Production stays blocked:** under `start.bat prod` (NODE_ENV=production) onboarding stays off until an approved consent notice and `REGISTRATION_CODE_SECRET` are configured.

## 6. Commands

| What | Command |
|---|---|
| Portal (unchanged) | `start.bat` → http://localhost:5173 |
| Onboarding | `cd onboarding` then `npm run dev` (or `npm run dev:onboarding`) → http://localhost:5180 |
| Both | `cd onboarding` then `npm run dev:all` |

The onboarding app refuses the portal's ports and never falls back to another port. Stopping it does not affect the portal.

## 7. Test results (2026-11-17)

| Suite | Result |
|---|---|
| Core API, all (`node --test "test/**/*.test.js"`) | **319/319** (18 onboarding: all six roles end to end through the invitation link and first sign-in, follow-ups, escalation refusal, no passwords, non-disclosure, codes, resume, reviewer actions, AI fallbacks, log hygiene) |
| Gateway (`apex`, `npm test`) | **47/47**, the original suite, gateway unchanged |
| Onboarding app (`onboarding`, `npm test`) | **2/2** (port isolation; page, relay, refusals) |
| Browser, `node tools/e2e/onboarding-app-ui.mjs` (disposable database) | **25/25, twice** |
| Showcase, shared and API | 3/3 and 81/81 |
| SlidesVault | 233/233 |
| Academia web build | builds |

**Live, read-only checks on the running portal:**
- every port (5173–5176, 4175–4177) answers
- all three Dropbox OAuth callbacks answer with their normal error redirects
- `5173/login` returns 200
- no Dropbox, OAuth, session, Google or gateway file differs from its committed version

**Not executed:**
- a real Dropbox authorisation round trip (it needs your Dropbox account)
- a real sign-in on 5173 with your credentials

## 8. Remaining items

1. **Email delivery** is not configured (`EMAIL_PROVIDER=log`), so applicants can't receive codes or invitations by email yet. In development, codes appear in the Academia API window, and invitation links are written to that window's log.
2. **Approved people have no Showcase or SlidesVault account.** At `5173/login` only Academia opens for them until accounts are linked (Use Case 004).
3. **No course category is open to the `external` audience yet,** so approved people see no courses until an administrator opens one.
4. **Production needs** an approved consent notice and URL, `REGISTRATION_CODE_SECRET` and an https `PUBLIC_BASE_URL`.
5. **Postgres:** the onboarding SQL is portable but has only run on SQLite here. CI's `core-postgres` job checks it.
6. **Drive C: is full** (0 MB). Free space before long-running work.

## APEX platform choice (added 2026-11-17)

- The "About you" step asks **"Which APEX platforms do you want to use?"** (Innovation Showcase, SlidesVault, Inspironics Academia; one or more, required). The choice is stored in `registration_requests.preferences.platforms` (existing JSON column; validated by `validatePlatforms` in `packages/shared/src/onboarding.js`).
- The approver sees the request and confirms or changes the list in the Approve dialog (`RegistrationsTab.jsx`). `POST /core/registrations/:id/approve` accepts `platforms` (omitted = as requested, empty = refused). Request and decision are both in the `registration.approved` audit event.
- The approved list is saved in the existing `settings` table under `apex_platforms:<userId>` (`src/core/platforms.js`); **no schema change**. `GET /core/me` returns it as `platforms` (`null` = no setting: show everything, e.g. administrators and earlier users).
- The APEX home (`apex/public/index.html`) shows only those platform cards. **This is a display setting, not an authorization.** The gateway still opens Showcase or SlidesVault only where the person has an account there, which an administrator creates and links (ADR 0003: never by email). The role catalogue and identity contract are unchanged.
- Tests: `test/onboarding.test.js` ("APEX platforms …" plus each role's flow), `tools/e2e/onboarding-app-ui.mjs` (34 checks).

## Password chosen during onboarding (changed 2026-11-17, reverses the Phase 3 "no password" decision at the founder's request)

- "About you" asks **Create a password** + **Confirm password** (at least 8 characters, the account rule `validatePassword`). The page keeps it in memory only and sends it once, with `/start` (`password`, `password_confirmation`).
- The Core validates it and stores only the scrypt hash in `registration_requests.credential_hash` (existing column; hashed on every path, decoys included, so timing reveals nothing). `/complete` still refuses a password. The start audit event records `password_chosen: true`, never the password.
- Nobody can sign in before approval (no account exists). On approval the account is created with that hash, and the person gets the **"Your APEX access is approved — sign in"** email (`onboarding_approved`) instead of the invitation link. Requests started without a password (all earlier ones) still get the invitation (set-password) link.
- On rejection, expiry or supersession the hash is cleared with the other secrets, as before.
- Tests: `test/onboarding.test.js` ("password chosen at onboarding …"), `tools/e2e/onboarding-app-ui.mjs` (35 checks).

## APEX admin console (added 2026-11-17)

- Access requests are reviewed on the APEX front door at **`/admin`** (`apex/public/admin.html`), opened from the account menu ("Admin console", shown to reviewers only) or the approvals bell. It lists requests (filters: status, role, search), shows one request's details, and approves (roles, APEX platforms, confirmation), asks a question or rejects.
- The page only calls the Core API through the gateway (`/academia/api/core/registrations…`); the Core allows platform administrators alone (`registration.review` / `registration.decide`, default deny). Others see "Administrators only". The gateway serves `/admin` to signed-in sessions only, with a hash-based CSP (no inline handlers), `no-store`, `X-Frame-Options: DENY`.
- The reviewer notification email links to `<APP_ORIGIN>/admin`. The Academia "People & access → Access requests" tab still works as a fallback; nothing in APEX links to it any more.
- Tests: `apex/link.test.mjs` ("admin console page …"), `tools/e2e/admin-console-ui.mjs` (14 checks, mocked Core).
