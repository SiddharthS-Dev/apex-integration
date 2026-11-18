# Incident — accidental migration of the local Academia (Core) database

- Date: 2026-11-14 (event at 10:19:44Z; recorded and resolved the same day)
- Severity: low. Development database only, additive change, no privilege change, no data loss.
- Status: **resolved; changes retained by founder decision** ("retain the additive changes after recording a backup and verifying the exact schema and role changes")

## What happened

During R1 implementation, a helper agent checked an import by running `node -e "import('./src/db/migrate-cli.js')"` inside `Inspironics Academia/apps/api`. `SQLITE_PATH` was not set, so the CLI opened the default database `apps/api/data/academy.db` and applied the pending migrations:
- `008_core_identity`
- the data migration `core_identity_backfill`

The agent had been instructed never to touch that database. It reported the event itself.

## Impact

All checks below ran on a byte-identical backup, never on the live file.

| Check | Result |
|---|---|
| Pre-existing data | Every count equals the R0 inventory: courses 11, lessons 714, questions 2,523, flashcards 1,340, certificates 0, users 2 (and the rest) |
| User rows | Unchanged; latest `updated_date` is still 2026-11-12 |
| Schema added | Exactly the six `008_core_identity` tables, with the specified columns and NOT NULL constraints. Migrations `009` and `010` were **not** applied |
| Organisation | 1: `inspironics`, internal, active |
| Memberships | 2 (both employees), open-ended |
| Role assignments | 4, all `granted_via = migration`. Admin account: `staff`, `platform_admin`. Other employee: `staff`, `learner` |
| Privileges | **The only privileged assignment is `platform_admin`, held by the account that already had `users.role = admin`. No `org_admin`, `app_admin` or `assessor` was granted. No unintended privilege** |
| Links and external identities | 0 and 0 |
| Audit | 3 system events: `organization.created` ×1, `user.backfilled` ×2 |

This is exactly the state the R1 server creates on its own first start (ADR 0004).

## Backup and recovery

- **Backup (outside Git):** `E:\apex-review-tmp\backups\2026-11-14-academy-pre-r1-followup\academy.db`.
  - SHA-256 `18e9be981c58a084737cfa076303140ff882efdd251bbe8c9062522c64e2212e`, identical to the live file at backup time.
  - `PRAGMA integrity_check` = ok.
  - No WAL or SHM files were present (the database was checkpointed), and no Apex process was running.
- **Recovery options:**
  1. **Undo R1 identity only:** stop Apex, then run `npm run core:rollback-identity -w @academy/api -- --yes --allow-default-db`. This drops the R1 tables and removes their migration records; pre-R1 data is untouched.
  2. **Restore the exact file:** stop Apex and copy the backup over `apps/api/data/academy.db`. Delete any `-wal` / `-shm` beside it first.
- **Decision:** retained (founder, 2026-11-14).

## Safeguards added

| Safeguard | Where |
|---|---|
| The Node test runner refuses to open a SQLite file in an app's default `data/` directory | Core (Academia API), Showcase API, SlidesVault API database openers (R1 follow-up) |
| Migration and maintenance CLIs refuse the default `data/` directory unless `--allow-default-db` or `APEX_ALLOW_DEFAULT_DB=1` is given, and print the resolved target first | Core `migrate-cli.js` and `src/core/cli/*`; Showcase and SlidesVault migrate scripts |
| Repository rules for people and agents | `AGENTS.md`, "Databases" section |
| Read-only discovery and linking tools work on snapshot copies only | `tools/discovery`, `tools/identity` |
| Verification evidence: fingerprints of live database files before and after any tool run | Phase reports R0/R1 |

The server start (`src/server.js`) still migrates its configured database. That is the intended upgrade path and is unaffected.
