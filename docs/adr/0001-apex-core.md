# 1. Promote the Academia API to the APEX Core (modular monolith)

- Status: accepted — founder approved DEC-007 on 2026-11-14: "Academia's API becomes APEX Core within one modular codebase. Use constrained identity and authorization tables, preserving existing content and functionality."
- Date: 2026-11-14
- Phase: R0 Discovery (Use Case 001 decision log)

## Context

APEX today is a gateway (`apex/`) in front of three separate applications, each with its own Express
API, SQLite/Postgres database, user table, roles and sessions (`apex/projects.mjs`, `PROJECTS`). The
master plan (`docs/APEX_MASTER_PLAN.md` §7, §13) needs one place for identity, scoped roles,
organisations, consent, audit and the new Projects, Innovation and Publication domains.

Evidence gathered in R0 (`docs/discovery/R0_DISCOVERY_REPORT.md`):

- **Scale is tiny.** The local databases hold 2 Academia users, 1 Showcase user and 1 SlidesVault user
  (2 distinct emails). There is no production deployment. Nothing argues for distributing the system.
- **Academia is the richest base.** It has:
  - a declarative entity layer with row-level rules and per-field rules (`packages/shared/src/entities.js`, `apps/api/src/entities/routes.js`)
  - 25 entity types
  - a job queue, schedulers and notifications with an email outbox
  - 246 API tests
  - migrations that already run on SQLite and are written for Postgres (`apps/api/src/db/migrations.js`)
- **Entity tables lack database constraints.** Generic entity tables (`e_*`) have no foreign keys or
  unique constraints (audit F-023). Integrity relies on application checks. That is acceptable for
  learning content, but not for identity or authorization data.
- **Postgres is now proven only for SlidesVault.** Its migrations passed on Postgres 16 in CI
  (GitHub Actions run 43420040675, job "Postgres mode"). The Academia layer has not yet run on Postgres.

## Options considered

| Option | For | Against |
|---|---|---|
| **A. Promote the Academia API to Core** (recommended) | Reuses auth, sessions, row rules, jobs, notifications, migrations and tests; one deployable; the smallest change | Mixes learning and platform concerns in one codebase unless module boundaries are enforced |
| B. New Core service; Academia becomes a client | Clean separation from day one | A fourth API to build, secure and run; identity duplicated again during transition; more effort for a tiny user base |
| C. Make the gateway the identity store | The gateway already does sign-in | The gateway is deliberately dependency-free and stateless (`apex/server.mjs`); adding a database and domain logic contradicts its design |
| D. Microservices per domain | Independent scaling | No scale evidence; much higher operational load for a five-person team |

## Decision

Option A.

1. The Academia API (`Inspironics Academia/apps/api`) becomes the APEX Core.
2. New platform domains are added as **logical modules**: identity, organisations, consent, audit, projects, innovation and publication. Each lives in its own folder under `apps/api/src/`, has its own routes, and depends on other modules only through exported functions.
3. **Identity and authorization data use core tables with real constraints, not generic entities.** This covers users, identity links, role assignments, organisations, memberships, consent and audit. The tables are added by versioned migrations with unique keys and foreign keys, as `users` and `sessions` already are.
4. The Showcase and SlidesVault stay separate deployables behind the gateway. They will consume Core identity (ADR 0002) instead of authenticating users themselves.
5. The gateway stays dependency-free.

## Consequences

- R1 work lands in one codebase with an existing test harness. The `academia` CI job covers it.
- Module boundaries must be enforced by review (and later by a lint rule like the Showcase's
  `lint:arch`), or the Core becomes a tangle.
- The Academia API must run on Postgres before production. Add a CI job mirroring the SlidesVault one
  (master plan, next action 5).
- Renaming the package or folder from "Academia" to "Core" is cosmetic and deferred. It is not required
  for this decision.
- Reversal cost is low until R1 migrations ship. After that, extracting the identity module into its own
  service remains possible, because it will be a self-contained folder with its own tables.
