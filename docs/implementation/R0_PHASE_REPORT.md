# Phase report — R0 Current-state discovery and scope validation

- Date: 2026-11-14
- Baseline: `docs/APEX_MASTER_PLAN.md` §11 (R0)
- Branch: `Feature-base-removal`; starting HEAD `4add53f` (clean working tree except the untracked master plan and the stray root file `ync handling"`, both preserved)
- Phase result: see §9 (evaluated after the founder's 2026-11-14 decisions)

## 1. Scope

From the master plan, R0 covers:
- **Use Case 001:** confirm the named areas.
- **Use Case 002:** cross-app user overlap report.
- Decision log, ADRs for the Core approach and identity assertion, and a validated persona matrix.

Out of scope and **not started**: any R1 work (identity tables, role assignments, gateway changes, UI).

## 2. Changes

| File | Kind | Purpose |
|---|---|---|
| `tools/discovery/user-overlap.mjs` | New tool (read-only) | Use Case 002 report: snapshot copies, per-app column maps, conflict classification, aggregate summary without personal data, detail written only outside the repository |
| `tools/discovery/user-overlap.test.mjs` | New tests | 5 tests on disposable fixture databases: classification, read-only (source hashes unchanged), no personal data in summary, missing database, within-app duplicates, refusal to write inside the repository |
| `.github/workflows/ci.yml` | CI | Gateway job also runs the discovery tests |
| `docs/adr/0001-apex-core.md` | ADR (proposed) | Promote the Academia API to Core; modular monolith; constrained core tables for identity |
| `docs/adr/0002-identity-assertion.md` | ADR (proposed) | Gateway asserts a signed, per-app, short-lived identity header |
| `docs/adr/0003-identity-mapping-no-email-merge.md` | ADR (proposed) | Explicit reviewed identity links; never merge on email alone |
| `docs/discovery/R0_DISCOVERY_REPORT.md` | Report | Discrepancies, overlap results, preservation inventory, persona validation, decision log, legal inputs |
| `docs/implementation/R0_PHASE_REPORT.md` | Report | This file |
| `docs/implementation/APEX_IMPLEMENTATION_STATUS.md` | Status | Running status across phases |
| `docs/APEX_MASTER_PLAN.md` | Baseline (previously untracked) | Unchanged in R0; discrepancies are recorded in the discovery report, not silently edited |

**No application code, schema, migration or data was changed.**

## 3. Migrations

None. R0 is read-only. Compatibility impact: none. Rollback: delete the new files listed above. Nothing in any application references them.

## 4. Checks actually run

| Check | Command | Result |
|---|---|---|
| Discovery tool tests | `cd tools/discovery && node --test user-overlap.test.mjs` | 5 / 5 pass |
| Gateway regression | `cd apex && npm test` | 13 / 13 pass |
| CI workflow syntax | PyYAML `safe_load` of `.github/workflows/ci.yml` | Parses; gateway job has the new step |
| Overlap report on local data | `node tools/discovery/user-overlap.mjs --summary-json … --detail-dir E:/apex-review-tmp/r0 --work-dir E:/apex-review-tmp/r0/snap` | Ran; summary in the discovery report §3 |
| Live databases unchanged | SHA-256 over all live `*.db*` files before and after the run | Identical (`68b244641d41a2a7`) |
| Preservation inventory | Read-only row counts on a snapshot copy of `academy.db`; snapshot deleted afterwards | Discovery report §4 |
| Remote CI for the starting commit | `gh run view 43420040675` | 6 / 6 jobs succeeded (externally verified, GitHub Actions) |

Not run: the CI workflow with the new step has not run remotely (not pushed). App suites were not re-run, because no app code changed.

## 5. Traceability

| Domain | Epic ID | Scenario ID | Use Case ID | Acceptance criteria (master plan) | Implementation | Verification evidence | Status |
|---|---|---|---|---|---|---|---|
| Discovery | Epic 001 | Scenario 001 | Use Case 001 | Written decision recorded as an ADR | Decision log DEC-001…013 (`docs/discovery/R0_DISCOVERY_REPORT.md` §6); ADRs 0001–0003 drafted as *proposed* | Documents exist; **no founder decision recorded** | **Blocked: founder input** |
| Discovery | Epic 001 | Scenario 002 | Use Case 002 | Report lists counts and conflicts; no data modified | `tools/discovery/user-overlap.mjs` | 5 fixture tests pass; real run summary (report §3); live database hashes identical before and after | **Implemented, tested, executed locally** |
| Discovery (R0 deliverable) | — | — | — | Validated persona matrix | Discovery report §5 | Cross-checked against schema and data (snapshot) | Done. One gap (D4, DEC-013) raised for the founder |

## 6. Status by category

| Category | Items |
|---|---|
| Implemented | Use Case 002 tool; ADRs 0001–0003 (proposed); discovery report; status documents; CI step |
| Tested (locally) | Discovery tool (5 tests); gateway regression (13) |
| Externally verified | Starting commit's CI (run 43420040675, 6/6). The new CI step is **not yet** externally verified |
| Blocked | Use Case 001 and the R0 exit gate: founder sign-off on DEC-001…013, in particular DEC-007/008/009/013, which R1 depends on |

## 7. Remaining blockers

1. Founder decisions DEC-001 to DEC-013 (`docs/discovery/R0_DISCOVERY_REPORT.md` §6).
2. Legal inputs (report §7) before any R1 onboarding or consent screens ship.
3. Push of this branch, so the new CI step runs remotely. A push is an outward-facing action, so it was not performed.

## 8. Rollback

`git rm -r tools/discovery docs/adr docs/discovery docs/implementation`, and revert the 3-line CI addition. The per-account detail file outside the repository (`E:\apex-review-tmp\r0\user-overlap-detail-2026-11-14.csv`) contains personal data. Delete it when no longer needed for review.

## 9. Founder decisions and R0 exit evaluation (2026-11-14)

Founder instruction, recorded verbatim:

> - DEC-007 — Approved: Academia's API becomes APEX Core within one modular codebase. Use constrained identity and authorization tables, preserving existing content and functionality.
> - DEC-008 — Approved with conditions: Use signed, short-lived, per-application identity assertions. Verify signature, issuer, audience and expiry; support key rotation and documented revocation. Strip client-supplied identity headers and prevent direct backend bypass. Each application must still enforce scoped authorization.
> - DEC-009 — Approved: Link accounts only through explicit, reviewed mappings. Never merge on email alone. Preserve passwordless Google sign-in through verified provider-and-subject mappings.
> - DEC-013 — Approved: Represent employees through an Inspironics organisation membership plus an explicit Staff role. Staff may also hold learner, mentor, assessor or administrator assignments. Employment must not automatically grant privileged access.

Recorded in:
- `docs/discovery/R0_DISCOVERY_REPORT.md` §6
- ADRs 0001–0003, now *accepted*; DEC-008's conditions are written into ADR 0002
- new ADR `docs/adr/0004-staff-representation.md`

**Diff review before commit**
- **Secrets:** pattern scan for keys, tokens, passwords and private keys found none.
- **Emails:** only fixture addresses at the reserved `example.com` domain, in the test file.
- **Files:** no CSV, database, `.env` or key files in the diff. The per-account CSV stays outside Git.
- **Unrelated changes excluded:** the stray root file `ync handling"`.

Exit criteria E1–E7: `docs/discovery/R0_DISCOVERY_REPORT.md` §9. The verdict is recorded below after the remote CI run.
