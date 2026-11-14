# APEX implementation status

Baseline: `docs/APEX_MASTER_PLAN.md`. Updated: 2026-11-14.

## Phases

| Phase | Status | Exit gate | Report |
|---|---|---|---|
| Pre-R0 remediation (security, broken features, CI) | **Done and externally verified.** Commits `8e11ccb`…`4add53f`; CI run 43420040675, 6/6 jobs green | — | `docs/APEX_BROCHURE_INPUT_PACK.md` §13 update; `docs/architecture/APEX_FULL_AUDIT_REPORT.md` |
| **R0 Discovery** | **Passed 2026-11-14** | Founder approved DEC-007/008/009/013; CI run 43582855263 green (6/6 jobs; discovery 5/5); other decisions documented as non-blocking | `docs/implementation/R0_PHASE_REPORT.md` |
| R1 Identity, roles, organisation membership, gateway security, private staging readiness | **Implemented and externally verified; exit gate NOT passed.** Commits `31f8024`…`9aa2140`. CI run 43589545984: 8/8 jobs; staging smoke 12/12; bypass 12/12 refused; Core and Showcase migrations on Postgres 16 | Open: Use Case 004 (existing accounts not yet linked; needs a second platform admin, possession claims, or a founder decision) | `docs/implementation/R1_PHASE_REPORT.md` |
| R2 Academy and student journey | Not started | — | — |
| R3 Projects, mentoring, governed publication | Not started | — | — |
| R4 Alumni and industry | Not started | — | — |
| R5 Executive reporting and public Showcase | Not started | — | — |
| R6 Pilot, hardening, operations | Not started | — | — |

## Use cases

| Use Case | Status | Evidence |
|---|---|---|
| Use Case 001: confirm named areas | **Deliberately unresolved** by founder instruction; non-blocking for R1 | `docs/discovery/R0_DISCOVERY_REPORT.md` §2, §6 |
| Use Case 002: cross-app user overlap report | Implemented, tested, executed locally | `tools/discovery/user-overlap.mjs`; R0 report §4 |
| Use Case 003: Core identity across apps | Implemented, tested, externally verified | R1 report §7 |
| Use Case 004: map existing users | Tooling done and tested; **real accounts not linked (open)** | R1 report §8 |
| Use Cases 005, 006, 010, 012 | Implemented, tested | R1 report §7 |
| Use Case 039 (staging part) | Private staging readiness externally verified; not deployed | R1 report §4 |
| Use Cases 007, 008, 009, 011, 013 | Held or outside the authorised R1 scope | R1 report §1 |
| Use Cases 014–041 | Not started | — |

## Open decisions (founder)

DEC-001 to DEC-013. See `docs/discovery/R0_DISCOVERY_REPORT.md` §6.

## Known discrepancies with the master plan

D1–D8 in `docs/discovery/R0_DISCOVERY_REPORT.md` §1. The most consequential:
- **D4:** current users are Inspironics employees, who are not among the five personas.
- **D2:** SlidesVault on Postgres and its Docker build are now externally verified; Academia/Core on Postgres is not.
