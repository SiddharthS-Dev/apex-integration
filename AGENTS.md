# Working rules for this repository (people and AI agents)

APEX is a gateway (`apex/`) in front of three apps:
- `Inspironics Academia/`, which is also the **APEX Core**: identity, roles, organisations (ADR 0001)
- `inspironics-innovation-showcase/`
- `slide vault/`

Plans and decisions:
- `docs/APEX_MASTER_PLAN.md`
- `docs/adr/`
- `docs/implementation/` (status, phase reports, contracts)

## Databases — never target real data

- **Never open, migrate or write a database under any `*/apps/api/data/` folder** unless the task is explicitly a live-data operation the founder authorised.
  - This includes `academy.db`, `app.db` and `slidesvault.db`.
  - See `docs/implementation/INCIDENT_2026-11-14_LOCAL_DB_MIGRATION.md`.
- **Tests use disposable databases only:** the suites' harnesses, or an explicit temp `SQLITE_PATH` / `DATABASE_URL`. Under the Node test runner, the database openers refuse the default `data/` directories.
- **CLIs (migrate, rollback, grant-admin):** they refuse the default `data/` directory unless `--allow-default-db` is given. Do not pass it without authorisation.
- **To inspect real data,** copy the db file plus its `-wal` and `-shm` files to a temp folder and open the **copy** read-only. Record SHA-256 fingerprints of the live files before and after.
- **Personal data** (emails, names) from real databases never goes into the repository. Tools write such detail only to folders outside it.

## Changes

- Identity and authorization rules are binding:
  - `docs/implementation/R1_IDENTITY_CONTRACT.md` and `R1_LINKING_ADDENDUM.md`
  - ADRs 0002–0004
- Server-side, default deny. Never merge or link accounts by email or name.
- Every schema change needs a migration that runs on SQLite and Postgres (no semicolons inside a statement), a compatibility note, a tested rollback, and tests.
- Do not rename or consolidate "Slide World", Innovations or Showcase (Use Case 001 is open).
- Do not deploy, push, publish, or onboard external users or organisations without explicit founder authorisation.

## Running checks (Windows dev machine)

Drive C: is nearly full. Before npm or node commands:

```
export TMP="E:\apex-review-tmp\ttmp" TEMP="E:\apex-review-tmp\ttmp" npm_config_cache="E:\apex-review-tmp\npm-cache"
```

| Suite | Command |
|---|---|
| Gateway | `cd apex && npm test` |
| Core | `cd "Inspironics Academia/apps/api" && npm test` |
| Showcase | `npm test -w @inspironics/shared`, `npm test -w @inspironics/api`, `npm run build -w @inspironics/web` |
| SlidesVault | `cd "slide vault" && npm test` |
| Tools | `node --test` on the test file in `tools/discovery`, `tools/identity` and `deploy/staging` (name the file; folders fail on Windows) |

CI: `.github/workflows/ci.yml`, which includes Postgres and the private staging smoke test.
