# APEX implementation status

Baseline: `docs/APEX_MASTER_PLAN.md`. Updated: 2026-11-14.

## Phases

| Phase | Status | Exit gate | Report |
|---|---|---|---|
| Pre-R0 remediation (security, broken features, CI) | **Done and externally verified.** Commits `8e11ccb`…`4add53f`; CI run 43420040675, 6/6 jobs green | — | `docs/APEX_BROCHURE_INPUT_PACK.md` §13 update; `docs/architecture/APEX_FULL_AUDIT_REPORT.md` |
| **R0 Discovery** | **Deliverables complete; exit gate not passed** | Founder sign-off on the decision log and ADRs 0001–0003: **pending** | `docs/implementation/R0_PHASE_REPORT.md` |
| R1 Identity, roles, shared data, navigation | Not started (blocked by R0 gate: DEC-007/008/009/013) | — | — |
| R2 Academy and student journey | Not started | — | — |
| R3 Projects, mentoring, governed publication | Not started | — | — |
| R4 Alumni and industry | Not started | — | — |
| R5 Executive reporting and public Showcase | Not started | — | — |
| R6 Pilot, hardening, operations | Not started | — | — |

## Use cases

| Use Case | Status | Evidence |
|---|---|---|
| Use Case 001: confirm named areas | Blocked: founder input (DEC-001, DEC-002) | `docs/discovery/R0_DISCOVERY_REPORT.md` §2, §6 |
| Use Case 002: cross-app user overlap report | Implemented, tested, executed locally | `tools/discovery/user-overlap.mjs`; R0 report §4 |
| Use Cases 003–041 | Not started | — |

## Open decisions (founder)

DEC-001 to DEC-013. See `docs/discovery/R0_DISCOVERY_REPORT.md` §6.

## Known discrepancies with the master plan

D1–D8 in `docs/discovery/R0_DISCOVERY_REPORT.md` §1. The most consequential:
- **D4:** current users are Inspironics employees, who are not among the five personas.
- **D2:** SlidesVault on Postgres and its Docker build are now externally verified; Academia/Core on Postgres is not.
