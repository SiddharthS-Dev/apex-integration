# Phase report — R1 Shared identity, reviewed account mappings, organisation membership, scoped roles, gateway security, private staging readiness

- Date: 2026-11-14
- Baseline: `docs/APEX_MASTER_PLAN.md` §11 (R1), narrowed by the founder's R1 authorisation of 2026-11-14
- Branch: `Feature-base-removal`; commits `d041121` (R0 pass record), `31f8024`, `d90d8bb`, `f278878`, `2c6a774`, `770854c`, `9aa2140`
- Binding spec: `docs/implementation/R1_IDENTITY_CONTRACT.md`
- Phase result: **NOT PASSED. Implementation complete and externally verified; one mandatory acceptance criterion is open (§8).**

## 1. Scope

**Authorised by the founder:**
- shared identity
- reviewed account mappings
- organisation membership
- scoped roles
- gateway security
- private staging readiness

**Held, verified as still disabled:**

| Held item | How it stays disabled |
|---|---|
| Public registration | Core `ALLOW_REGISTRATION=false` in staging; legacy app sign-up returns 403 in `required` mode |
| Production consent screens | None built |
| Student-work publication | None built |
| Real external onboarding | Non-internal organisations refused unless `CORE_EXTERNAL_ORGS_ENABLED=true` (default false). Google sign-in is disabled without a client ID |
| Use Case 001 | Unresolved. Nothing was renamed or consolidated; "Slide World", Innovations and Showcase are untouched |

**Kept working:** existing employee access. Every app defaults to identity mode `off`, so local behaviour is unchanged until an operator switches modes. The two existing employees were mapped by the backfill to Staff plus their previous admin or learner standing.

**Out of R1, not started:** persona navigation (Use Case 011), onboarding (Use Case 007), consent (Use Case 008), export and erasure (Use Case 009), notification generalisation (Use Case 013).

## 2. Changes

| Commit | Area | Summary |
|---|---|---|
| `31f8024` | Core (`Inspironics Academia/apps/api`), `tools/identity`, `tools/discovery` | Migrations 008 and 009, backfill, `src/core/*` module (identity, roles, organisations, links, audit, Google, service assertions, routes), break-glass and rollback CLIs, the propose-links tool, `TRUST_PROXY`. 39 new Core tests |
| `d90d8bb` | Core web (`apps/web`) | People & access admin (people, roles, organisations, links, audit), My access card, demo-mode notice; `tools/e2e/core-access-ui.mjs` |
| `f278878` | Gateway (`apex/`) | Identity assertion signing, key store with rotation and prune, header stripping, Core resolve with cache, revocation, per-app upstream hosts, Google sign-in through Core, child-env isolation |
| `2c6a774` | Showcase API, SlidesVault API | Assertion verifiers (byte-identical copies of `apex/identity.mjs`, guarded by a test), `off`/`optional`/`required` modes, `core_user_id` migrations, Showcase Dockerfile |
| `770854c` | Staging | Gateway and Core images, `deploy/staging/*` (compose, secrets generator, smoke, tests), `.dockerignore`, CI jobs `core-postgres` and `staging-smoke`, `docs/operations/STAGING_RUNBOOK.md` |
| `9aa2140` | Docs | Contract, ADR 0002 revocation timings, Core README |

## 3. Migrations, compatibility, rollback

| Migration | Change | Compatibility | Rollback | Verified |
|---|---|---|---|---|
| Core `008_core_identity` | Six new constrained tables (FK, UNIQUE, CHECK, partial unique indexes) | Additive; no pre-R1 table altered. Pre-R1 code ignores the tables | `npm run core:rollback-identity -w @academy/api -- --yes` | Disposable SQLite (pre-R1 rows byte-identical after migrate and after rollback); Postgres 16 in CI (migrate twice, rollback drill, re-apply) |
| Core data `core_identity_backfill` | Inspironics organisation; memberships and roles per ADR 0004; one audit event per user | Idempotent; `users` untouched | Dropped with the tables | Same as above |
| Core `009_user_session_epochs` | One table (session cut-off for the gateway) | Additive | Included in `core:rollback-identity` | SQLite tests; Postgres 16 in CI |
| Showcase `002_core_user_id` | Nullable unique `users.core_user_id` | Additive, nullable | `node apps/api/src/db/migrate.js --rollback 002_core_user_id` | SQLite tests; Postgres 16 in CI (migrate, rollback, re-apply) |
| SlidesVault `005_core_user_id` | Nullable unique `app_user.core_user_id` | Additive, nullable | `npm run migrate -- --rollback 005_core_user_id` | SQLite tests; Postgres in the staging stack |

**Live-data note (incident).** During development, the Core agent accidentally applied migrations 008 and the backfill to the **local development** database `Inspironics Academia/apps/api/data/academy.db`. The R1 server would apply the same migrations on its next start anyway.
- **Verified from a snapshot copy:** every pre-existing count equals the R0 inventory, both user rows are unchanged, and only the R1 tables and the ADR 0004 role mapping were added.
- **Not rolled back,** to avoid a further change to that database without your decision. The rollback command is above.
- **Migration 009 has not been applied** to that database. It will be applied on the next server start.

## 4. Checks actually run

| Check | Where | Result |
|---|---|---|
| Gateway | `cd apex && npm test` | 39/39 |
| Discovery, identity and staging tools | `node --test` in `tools/discovery`, `tools/identity`, `deploy/staging` | 5/5, 4/4, 7/7 |
| Core API | `npm test` in `Inspironics Academia/apps/api` (run twice) | 285/285 both times |
| Showcase | shared, API, web build (with tests and checks) | 3/3, 73/73, 86/86 and build |
| SlidesVault | `npm test`, web build | 225/225, build |
| Academia and SlidesVault web builds | `vite build` | pass |
| Production dependency audit | `npm audit --omit=dev` ×3 | 0 vulnerabilities each (before the security fixes; dependencies unchanged since) |
| Admin UI end-to-end | headless Chrome against a disposable Core API (`tools/e2e/core-access-ui.mjs`) | 32/32 checks (agent run; screenshots outside the repository) |
| Account-link dry run on real data | `node tools/identity/propose-links.mjs` (snapshot copies; dry run) | 0 proposals; 1 conflict group (name differs) for manual review; live database fingerprints identical before and after |
| Independent security review | Separate reviewer, read-only, with probes on disposable databases | 0 Critical, 0 High; 2 Medium, 3 Low, all fixed (§5) |
| **Remote CI (externally verified)** | GitHub Actions run **43589545984** on `9aa2140` | **Success, 8/8 jobs** |
| — staging smoke, gateway | inside that run | **12/12** |
| — staging smoke, direct bypass | inside that run | **12/12 refused** |
| — Core on Postgres 16 | inside that run | 008, 009 and backfill applied twice; rollback drill (7 tables dropped, 3 records removed, users unchanged); re-apply |
| — Showcase on Postgres 16 | inside that run | 001, 002; rollback and re-apply of 002 |

## 5. Security review findings and fixes

| ID | Finding | Fix | Regression test |
|---|---|---|---|
| M1 | SlidesVault `required` mode: an upper-case `/API/…` path skipped the gate and fell back to a legacy cookie | Case-insensitive path checks; `required` mode never consults the legacy cookie | `slide vault/…/identity.test.js` "pre-existing legacy session is never honoured, on any path spelling" |
| M2 | An org_admin could enrol any user, read their profile, and restore app access a platform admin had removed | Adding members is platform_admin only | `coreAuthz.test.js` "org_admin cannot enrol users from elsewhere" |
| L1 | A Core password reset or session revocation did not end the Apex session | Migration 009; resolve returns `sessions_valid_after`; the gateway revokes older sessions | `coreService.test.js` and `gateway.test.mjs` (security review L1) |
| L2 | Child processes could inherit the gateway's whole key store | `childEnv()` strips gateway-only variables | `identity.test.mjs` (L2) |
| L3 | Registering with `BOOTSTRAP_ADMIN_EMAIL` granted admin (now also app admin) | Registration never grants admin by email | `authProduction.test.js` and `authFiles.test.js` (L3) |
| Minor | A legacy audience change does not move staff and intern roles | Not changed (no privilege impact); documented | — |

## 6. Founder conditions (DEC-008) — evidence

| Condition | Evidence |
|---|---|
| Signed, short-lived, per-app assertions | HMAC-SHA256 with a key ID, 60 s, `aud` per app (`apex/identity.mjs`); `apex/identity.test.mjs` |
| Verify signature, issuer, audience, expiry | App verifier tests (12+ cases each); Core `coreService.test.js`; CI bypass 12/12 |
| Key rotation | `identity-keys.mjs rotate`/`prune`; previous key ID verifies, pruned key ID fails (tests); container rotation via `generate-secrets.mjs` |
| Documented revocation | `docs/operations/IDENTITY_ASSERTION.md` and `STAGING_RUNBOOK.md`. Sign-out is immediate; disable or session cut-off ≤ 30 s; role change ≤ about 90 s worst case. CI: "sign-out revokes access" |
| Strip client identity headers | Gateway tests; CI "forged X-Apex-Identity / X-Apex-Service is stripped" |
| Prevent direct backend bypass | `required` mode, trusted-source check on the TCP peer, internal network; CI bypass 12/12 refused |
| Each app enforces scoped authorization | Per-request role mapping; `app_admin` of another app gives no admin (tests); existing object rules unchanged |

## 7. Traceability

| Domain | Epic ID | Scenario ID | Use Case ID | Acceptance criteria (master plan) | Implementation | Verification evidence | Status |
|---|---|---|---|---|---|---|---|
| Identity | Epic 002 | Scenario 003 | Use Case 003 | Sign-in works in all apps with one Core account; app user tables keyed by Core ID; existing tests pass | Core identity and resolve; gateway assertions; app verifiers and `core_user_id` | CI staging smoke 12/12 (one Core account into Core, Showcase and SlidesVault, identity `required`); all suites green | **Implemented, tested, externally verified** |
| Identity | Epic 002 | Scenario 003 | Use Case 004 | Every existing user maps to exactly one Core user; dry run and rollback verified | `identity_links` with reviewed confirm; propose-links tool; admin review UI | Dry run on real data (§4); rollback verified locally and on Postgres in CI. **The real accounts are not linked yet:** 1 conflict group awaits manual review (§8) | **Tooling done and tested; mandatory criterion OPEN** |
| Identity | Epic 003 | Scenario 004 | Use Case 005 | A user can hold ≥2 roles; each has scope and validity; changes audited | `role_assignments`; grant and revoke; audit in the same transaction | `coreIdentity` and `coreAuthz` tests; UI end-to-end; CI | **Implemented, tested, externally verified (CI suite)** |
| Identity | Epic 003 | Scenario 005 | Use Case 006 | Old role closed with an end date; prior records still visible | Atomic transition | Tests ("a failed transition changes nothing"; history kept); UI end-to-end (learner → student, history shown) | **Implemented, tested** |
| Organisations | Epic 005 | Scenario 008 | Use Case 010 | Organisation isolated by `organization_id`; cross-organisation access fails closed | Organisations and memberships; org_admin scoping; external organisations held | `coreAuthz` cross-org tests (404); M2 fix test | **Implemented, tested** (schema and internal UX; external onboarding held by the founder) |
| Platform | Epic 007 | Scenario 010 | Use Case 012 | Every listed action writes an AuditEvent; admin can filter | `audit_events`; audit API and UI | Core tests; UI end-to-end audit filter | **Implemented, tested** |
| Operations | Epic 018 | Scenario 036 | Use Case 039 (staging part) | Staging with Postgres, HTTPS, backups, monitoring (plan); founder-narrowed to *private staging readiness* | Images, compose, secrets, runbook, CI smoke | CI run 43589545984: images built, stack up on Postgres, smoke 12/12, bypass 12/12 | **Readiness externally verified; not deployed.** HTTPS termination, backups in operation and monitoring belong to a real deployment (DEC-010 open) |
| Identity | Epic 004 | Scenario 006 / 007 | Use Cases 007, 008, 009 | — | Not built | — | Held or not authorised for R1 |
| Navigation | Epic 006 | Scenario 009 | Use Case 011 | — | Not built | — | Not in the authorised R1 scope |
| Platform | Epic 007 | Scenario 011 | Use Case 013 | — | Not built | — | Deferred |

## 8. Exit gate

| Criterion | Result |
|---|---|
| Founder conditions for DEC-008 | Met (§6) |
| DEC-009: links only through explicit reviewed mappings; never by email; Google by provider and subject | Met (tests; dry run made 0 automatic links) |
| DEC-013: staff via membership + Staff role; no automatic privilege | Met (backfill; "staff and learners get 403 on every administrative endpoint") |
| Existing employee access keeps working | Met (mode `off` default; regression suites green) |
| Security review of authorization | Done; all findings fixed with tests |
| Migration dry run | Done (real-data snapshot) |
| Private staging readiness | Met, externally verified |
| **Use Case 004: every existing user maps to exactly one Core user** | **OPEN** |

Why Use Case 004 is open, and what closes it:
- The one person with accounts in all three apps has a name that differs between apps. So the tool correctly proposed nothing.
- An administrator must propose the links by hand, and a **different** administrator must confirm them (ADR 0003).
- There is exactly one platform administrator today, and that administrator is the person being linked.
- ADR 0003 item 4 (the account holder proves a link by signing in to the app account, "possession") is **not implemented in R1**. Only Google possession exists.

**Options for the founder:**
1. Nominate a second platform administrator: break-glass `core:grant-admin`, or invite and grant.
2. Authorise implementing app-account possession claims (ADR 0003 item 4) as a small R1 follow-up.
3. Explicitly accept the remaining Showcase and SlidesVault accounts as unlinked (they keep working in mode `off`), and redefine the criterion.

**R1 is not passed until one of these is decided and the criterion is resolved.**

## 9. Remaining blockers and decisions

1. Use Case 004 closure (above).
2. The local development database incident: keep the R1 tables (recommended; they are what the R1 server creates on start), or roll back with `core:rollback-identity`.
3. DEC-010 (hosting and data residency) before any real staging deployment. No deployment was made.
4. Google sign-in stays disabled until a client ID and policy exist. The Academia web Google button still points at a route that does not exist (pre-existing; the Core API path works).
5. Org-admin UI: org_admins can use the API, but the admin screens are gated to platform admins (AdminGuard).

## 10. Rollback (whole phase)

1. Set every app's `APEX_IDENTITY_MODE` to `off` (the default). The gateway then behaves as before R1, apart from stripping identity headers.
2. Revert commits `9aa2140`…`31f8024`.
3. For databases already migrated: back them up, then run
   - `npm run core:rollback-identity -w @academy/api -- --yes`
   - the Showcase `--rollback 002_core_user_id`
   - the SlidesVault `--rollback 005_core_user_id`

   Pre-R1 tables and rows are untouched by R1, so no data is lost.
