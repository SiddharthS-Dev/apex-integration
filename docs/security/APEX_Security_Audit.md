# APEX — Security Audit

| | |
|---|---|
| **Product** | APEX (Inspironics APEX platform) |
| **Revision** | 3, 2026-11-18. It re-assesses the product after the second round of remediation (summary table at the end). Revision 2 was earlier the same day; revision 1 was dated 2026-11-17. |
| **Repository** | `github.com/SiddharthS-Dev/apex-integration` |
| **Branch / commit** | `security/scanners-blocking` @ `64f5f7d` (pushed), on top of `feature-Ai-Assistant` @ `f530ee3`. The revision 2 remediation is committed and merged to `develop`. |
| **CI evidence** | The security scanners first ran on `develop` (run `44260126905`, 2026-11-18). The fixes for what they found are in `452c805`, but **CI has not run them yet**: the workflow triggers only on `main`, `develop`, `Feature-**` and `feature-**` (`.github/workflows/ci.yml:8-11`) or a pull request, and this branch name matches none of them. |
| **Method** | Inspection of source, configuration, Dockerfiles, Compose files, CI workflow, dependency manifests and documentation, plus local test runs. No database under any `apps/api/data/` folder was opened. No secret values appear here. |
| **Evidence convention** | Paths are relative to the repository root. Short forms: `Core` = `Inspironics Academia/apps/api/src`, `Showcase` = `inspironics-innovation-showcase/apps/api/src`, `Vault` = `slide vault/apps/api/src`. |

**Status legend:** *Implemented* means evidence in the repository covers the control. *Partially Implemented* means evidence exists but there are gaps, or the control is configured but has not yet run or is not yet enforced. *Not Implemented* means the control was searched for and is absent. *Not Verified* means the control would live outside the repository, so Infrastructure, DevOps or Security must confirm it.

**Scope.** APEX is one product made of five deployable parts:

| Component | Path | Role |
|---|---|---|
| APEX gateway | `apex/` | Single sign-on front door and reverse proxy. Signs identity assertions. |
| APEX Core / Inspironics Academia | `Inspironics Academia/` | Identity, roles and organisations for all apps (ADR 0001), plus the learning app |
| Innovation Showcase | `inspironics-innovation-showcase/` | Innovation gallery synced from Dropbox |
| SlidesVault | `slide vault/` | Presentation library synced from Dropbox |
| Enterprise Onboarding app | `onboarding/` and `Core/core/onboarding/` | Use Case 007 registration. Uncommitted, local only. |

`inspironics-innovation-showcase/legacy/nextjs-app` is retired code. It is not built, not in any image and not a workspace.

---

# SECTION 1: PROJECT INFORMATION

## 1. Project Overview

| Item | Finding | Evidence |
|---|---|---|
| Official Project Name | **APEX**, the Inspironics home dashboard: one address and one sign-in for Innovation Showcase, SlidesVault and Inspironics Academia | `README.md:1-14`, `AGENTS.md` |
| Project Description | A gateway in front of three web apps, with APEX Core as identity provider. **Core / Academia:** engineering academy with AI-generated courses, quizzes and certificates, and an AI video studio. **Showcase:** Dropbox-synced innovation material with AI categorisation. **SlidesVault:** Dropbox-backed presentation library with an AI Copilot. | `README.md`, `docs/architecture/APEX_FULL_AUDIT_REPORT.md` §B |
| Project Status | **Development.** R1 (identity, roles, gateway security, private staging readiness) is implemented and externally verified, but its exit gate is not passed. R2–R6 have not started. Private staging exists only as a CI test. **Not deployed; no production environment.** | `docs/implementation/APEX_IMPLEMENTATION_STATUS.md`, `docs/operations/STAGING_RUNBOOK.md` §9 |
| Business Criticality | **Not stated in the repository. Confirmation required from the business owner.** The assessor's indicative view is **High**: the Core is the identity and authorisation authority for every app and stores personal data. | — |
| Project Users | **Today:** Inspironics employees and administrators (`R0_DISCOVERY_REPORT.md` D4). **Planned:** students, learners, mentors, interns, alumni, assessors and external organisation users. These roles are modelled but external organisations are off (`CORE_EXTERNAL_ORGS_ENABLED=false`). | `Core/core/identity.js:7-19`, `deploy/staging/compose.yml:85-90` |

## 2. Application Architecture

| Item | Finding | Evidence |
|---|---|---|
| Application Type | **Web**: single-page apps plus REST APIs. SlidesVault's web app is a PWA. | `*/apps/web`, `*/apps/api` |
| Frontend Technology | React 18, Vite 5 and react-router 7 in all three apps. Academia adds Tailwind and Radix; Showcase adds three.js and jsPDF. The gateway's own pages are static HTML. | `*/apps/web/package.json`, `apex/public/` |
| Backend Technology | Node.js ≥ 22.5. The APIs use Express 4.21. The gateway uses Node's built-in `http` with no dependencies. Databases are reached through `node:sqlite` or `pg`. Container bases: `node:22-bookworm-slim` (gateway, Core), `node:22-alpine` (Showcase), `node:24-alpine` (SlidesVault). | `apex/package.json`, `*/apps/api/package.json`, Dockerfiles |
| Architecture Type | **Modular monoliths behind a gateway**: three monolithic API services, each with its own database, plus the gateway. | `deploy/staging/compose.yml` |
| API Type | **REST** (JSON over HTTP). | `Core/app.js`, `Showcase/app.js`, `Vault/app.js` |
| Authentication Mechanism | **Custom. Not JWT, and not OAuth 2.0 for user sign-in.** | See the list below the table |
| Authorization Mechanism | **Custom RBAC** with organisation scoping and row-level rules. Core `can()` is default-deny (`Core/core/identity.js:94-120`). | `packages/shared/src/rls.js` |

The authentication pieces are:

- **Gateway session:** an HMAC-SHA256-signed `apex_session` cookie with a revocation list (`apex/auth.mjs:60-113,419-458`).
- **App sessions:** opaque 32-byte tokens; only their SHA-256 is stored.
- **Passwords:** scrypt, now at N=2^17 in all three apps.
- **Gateway to apps:** 60-second HMAC-SHA256 identity assertions (`X-Apex-Identity`, `X-Apex-Service`; ADR 0002).
- **Google sign-in:** optional, using a Google ID token.

## 3. Database Security

| Item | Finding | Evidence |
|---|---|---|
| Database Type | **SQLite** through `node:sqlite` (development default). **PostgreSQL 16** in staging and CI. | `Core/db/index.js:9-19`, `Showcase/config.js:94-97`, `deploy/staging/compose.yml:36` |
| Database Hosting | **Development:** SQLite files on the developer's Windows machine. **Staging:** a self-managed `postgres:16` container, which exists only in CI runs. **Production:** none, and no hosting has been chosen (DEC-010). | `STAGING_RUNBOOK.md` §9 |
| Database Access | **Restricted in staging.** The internal `backend` network has no route out and no published port. Each app has its own role and database, with `REVOKE ALL ... FROM PUBLIC`. SlidesVault's standalone compose now publishes its API only on `127.0.0.1`. | `deploy/staging/compose.yml:259-270`, `deploy/staging/postgres/init-databases.sh`, `slide vault/docker-compose.yml:30` |
| Database Encryption at Rest | **Not implemented at database level.** OAuth refresh tokens are encrypted with AES-256-GCM. **Backups are now encrypted** with AES-256-GCM (`deploy/staging/backup.mjs`). Database files and volumes are plaintext; disk encryption is not verified. Postgres TLS is not configured by default; `pg` honours `sslmode` in `DATABASE_URL`. | `Core/lib/crypto.js`, `Showcase/lib/crypto.js:47-62`, `Vault/crypto/tokenCipher.js` |
| Database Backup Frequency and Retention | **The backup tool is implemented; no schedule is installed.** See below. | `deploy/staging/backup.mjs`, `deploy/staging/staging.test.mjs`, `.github/workflows/ci.yml` (staging-smoke backup step), `STAGING_RUNBOOK.md` §7 |

**Backups.**

- **What the tool backs up:** `deploy/staging/backup.mjs` dumps all three databases and the roles, and archives the `core-data` and `gateway-state` volumes.
- **Encryption:** every file is encrypted while it streams.
- **Integrity:** each run writes a manifest with a SHA-256 for every file.
- **Retention:** 14 days by default; the newest 3 sets are always kept.
- **Verify and restore:** the tool can `verify` a set and `decrypt` a file for restore.
- **Tested in CI:** the CI staging job runs a backup, verifies it, and checks that the decrypted Core dump is readable by `pg_restore`.
- **Still open:**
  - The host scheduler must run the tool. The runbook gives cron and Task Scheduler lines, and suggests daily.
  - No off-site copy.
  - No RPO or RTO.
  - Local SQLite databases are not covered.

**Safeguards.**

- The CLIs and the test runner refuse the live `data/` folders (`*/db/safety.js`).
- Every migration runs on both SQLite and Postgres, and CI rehearses its rollback.
- **Remaining gap:** the Showcase server still migrates on every start (`Showcase/services.js:40`).

## 4. Cloud & Infrastructure

| Item | Finding | Evidence |
|---|---|---|
| Cloud Provider | **None selected** (DEC-010 open). There is no AWS, Azure or GCP configuration. **Confirmation required from Infrastructure.** | `STAGING_RUNBOOK.md` §9 |
| Compute Services | **Docker:** four images orchestrated with Docker Compose. **Development:** Node processes started by `start.bat` on Windows. | `deploy/gateway/Dockerfile`, `*/apps/api/Dockerfile`, `deploy/staging/compose.yml` |
| Operating System | Containers: Debian bookworm-slim and Alpine. Development host: Windows 11. Production OS: not applicable. | Dockerfiles |
| Deployment Environment | **Development** (local) and **Staging** (private, ephemeral in CI, `127.0.0.1` only). **No production.** | `ci.yml` staging-smoke job |
| Storage Services | Local disk and Docker volumes: content-addressed object stores, Core media, gateway state, and encrypted backup sets (default folder gitignored). Dropbox is the external content source. | `Vault/services/storage/ObjectStore.js`, `Showcase/storage/objectStore.js` |
| Secrets Management Solution | **Environment variables. No vault.** See below. | `deploy/staging/generate-secrets.mjs`, `.gitignore`, `.dockerignore` |

**Secrets handling.**

- **Kept out of git and images:** `.env` files, gateway secrets, `.env.staging` and backups are gitignored and dockerignored.
- **Staging generation:** `generate-secrets.mjs` writes random secrets, now including `BACKUP_ENCRYPTION_KEY`, to a file with mode 0600. Its new `--add-missing` flag adds variables introduced later.
- **Gateway secrets** are files with mode 0600, on a volume with mode 0700.
- **Production start-up checks** in all three apps, plus secret scanning in CI (see Section 2).

## 5. Network Security

| Item | Finding | Evidence |
|---|---|---|
| Network Architecture | Browser → APEX gateway (single port) → three APIs; the gateway also serves the web bundles. Staging has an `edge` network and an internal `backend` network. | `deploy/staging/compose.yml:11-16,259-270` |
| Network Segmentation | **Implemented in every environment the repository defines:** see the list below. **Production segmentation is not designed**, because there is no host. | — |
| Firewall Implementation | **Not found in the repository. Confirmation required from Infrastructure.** | — |
| Open Ports and Protocols | See the table below. All are **plain HTTP**. | `start.bat`, `apex/projects.mjs`, compose files |
| Internet Exposure | **None today.** In development the gateway binds to loopback; staging publishes `127.0.0.1:4173` only. | `apex/server.mjs`, `deploy/gateway/Dockerfile:69` |
| VPN / SSH / RDP / Bastion Access | **None found. Confirmation required** for any future host. | — |
| Web Application Firewall (WAF) | **Not implemented.** | — |
| IDS / IPS Availability | **Not implemented.** | — |

Segmentation controls:

- **Internal backend network:** staging's `backend` network is `internal: true`.
- **Trusted source only:** apps accept assertions only from the gateway's fixed IP. The CI bypass test refuses 12 of 12 attempts.
- **SlidesVault compose:** now publishes on `127.0.0.1` only (`slide vault/docker-compose.yml:30`).
- **Gateway Host allow-list:** requests with an unknown `Host` get **421** (DNS-rebinding defence) (`apex/server.mjs:145-178`, `:926`, `:1036`).

Ports in use:

| Port | Service | Bound to |
|---|---|---|
| 5173 (development) / 4173 (production) | Gateway | loopback by default; `0.0.0.0` in the container |
| 4175 / 4176 / 4177 | SlidesVault / Showcase / Core APIs | loopback in development; internal network in staging |
| 5174–5176 | Vite development servers | loopback |
| 5180 | Onboarding app | loopback |
| 4000 | SlidesVault standalone compose | now `127.0.0.1` |
| 5432 | Postgres | CI service only |

## 6. Identity & Access Management

| Item | Finding | Evidence |
|---|---|---|
| User Roles | See the role list below. | — |
| Role-Based Permissions | Core `can()` is default-deny. Organisation management is limited to platform admins or the admin of that organisation. Nobody can grant themselves platform admin. Showcase and SlidesVault have per-route gates and last-admin protection. See the remaining gaps below. | `Core/core/identity.js:94-120`, `Showcase/middleware/auth.js:65-81`, `Vault/http/auth.js:106-127` |
| Multi-Factor Authentication (MFA) | **Not implemented.** | — |
| Single Sign-On (SSO) | **Partial.** Gateway single sign-on works across all apps. Optional Google sign-in links only by (provider, subject), never by email. No SAML or OIDC federation with a corporate identity provider. Identity mode still defaults to `off` for local development. | `apex/server.mjs`, `Core/core/google.js:126-161` |
| Service Accounts | Gateway → Core `X-Apex-Service` HMAC credential, accepted only from trusted sources. One Postgres role per app. The bootstrap admin password must now be at least 12 characters for a non-local production start (`Core/startupChecks.js`). | `Core/core/service.js` |
| Privileged Access Management | Break-glass `grant-admin` CLI: requires `--reason`, writes an audit row, and refuses the live database without a flag. Platform-admin approval is required for registrations. No PAM tool, just-in-time elevation, or MFA on privileged roles. | `Core/core/roles.js:260-282` |
| Session Management and Timeout | See the session details below. | — |

**Roles.**

- **Core roles:** `platform_admin`, `org_admin`, `staff`, `assessor`, `app_admin`, `learner`, `mentor`, `student`, `intern`, `alumni`.
- **Legacy Academia role:** `admin` or `user`.
- **Showcase:** `admin`, `viewer`, `guest`.
- **SlidesVault:** `admin`, `user`.

**Row-level rules (fixed in revision 3).** A missing rule, a non-object rule, an unknown key (such as `user_id` without the `data.` prefix), or `$or` mixed with other keys now **denies** (`Inspironics Academia/packages/shared/src/rls.js:28-44`). Only the explicit `{}` means "every signed-in user". A test checks that all 25 entities define all four actions in the known grammar (`Inspironics Academia/apps/api/test/rlsDefaultDeny.test.js`).

**Remaining permission gap.** Two admin models in Academia: most Academia admin routes check the legacy `users.role` admin.

**Session details.**

- **Absolute lifetime:** 12 hours everywhere.
- **No idle timeout and no rotation.**
- **Cookies:** HttpOnly and `SameSite=Lax`. A non-Secure session cookie is now **fatal at production start-up** for a non-loopback public URL in all three apps (`Core/startupChecks.js`; `Vault/config/index.js:367`; `Showcase/config.js:209-229`).
- **Revocation:** a password change or reset, or disabling a user, destroys that user's sessions and revokes gateway sessions. The gateway revocation file is local to one instance.

## 7. Data Security

| Item | Finding | Evidence |
|---|---|---|
| Data Classification | **No formal scheme found. Confirmation required.** Suggested: personal and credential data *Confidential*, content *Internal*, certificate verification *Public*. | — |
| Sensitive Data Handled | See the field list below. | migrations in each API |
| Data Encryption at Rest | **Partial:** OAuth refresh tokens and backup sets are encrypted; databases and object stores are not. | §3 |
| Data Encryption in Transit | **Inbound: no TLS yet**, because a TLS-terminating proxy does not exist (see below). **Outbound:** HTTPS to every provider. **Database:** Postgres TLS is not configured by default. | `apex/server.mjs:103-130` |
| Key Management | **Every key can now be rotated.** Identity-assertion keys use a `kid` store with a rotation CLI. The four data-encryption keys each accept retired keys in `<NAME>_PREVIOUS`: encryption uses the current key, decryption falls back through the previous ones, and the envelope format is unchanged. Rewrap CLIs re-encrypt stored tokens. Malformed keys are rejected at start-up. The schedule and steps are in the runbook. Keys live in environment variables or files, not in a KMS. | See the key list below the table |
| Data Retention Period | See the retention details below. | — |
| Secure Data Deletion | **Core:** deleting a user now also removes their `login_history` and `email_outbox` rows (`Core/repo/users.js:71-90`); `audit_events` is kept deliberately. **Showcase and SlidesVault:** still no user-delete or export endpoint. No secure wipe of volumes. | — |

**Keys and how each is rotated.**

| Key | Previous-key variable | Rewrap or retirement | Evidence |
|---|---|---|---|
| Core `TOKEN_ENCRYPTION_KEY` | `TOKEN_ENCRYPTION_KEY_PREVIOUS` | `npm run rewrap-secrets` | `Core/config.js:76`, `Core/lib/crypto.js`, `Core/db/rewrap-cli.js`, `test/keyRotation.test.js` |
| Showcase `ENCRYPTION_KEY` | `ENCRYPTION_KEY_PREVIOUS` | `npm run rewrap-secrets -w @inspironics/api` | `Showcase/config.js:108`, `Showcase/lib/crypto.js`, `Showcase/db/rewrap.js`, `test/keyRotation.test.mjs` |
| SlidesVault `DROPBOX_TOKEN_ENCRYPTION_KEY` | `DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS` | `npm run rewrap-tokens` | `Vault/config/index.js:169,296-341`, `Vault/crypto/tokenCipher.js`, `tests/integration/keyRotation.test.js` |
| `BACKUP_ENCRYPTION_KEY` | `BACKUP_ENCRYPTION_KEY_PREVIOUS` | Old sets age out of retention; `verify` and `decrypt` try previous keys | `deploy/staging/backup.mjs:23,56-57` |
| Identity-assertion keys | `kid` store (current and previous) | Rotation CLI | `docs/operations/IDENTITY_ASSERTION.md` |

- **Rotating a key:** `generate-secrets.mjs --rotate <NAME>` moves the current key to `_PREVIOUS` and writes a fresh one with file mode 0600.
- **Schedule:** every 12 months, and immediately on suspected exposure (`docs/operations/STAGING_RUNBOOK.md:72`).
- **Limits of the evidence:** the rewrap CLIs refuse the default `data/` folder. They were tested on disposable SQLite databases only, not yet on Postgres.

**Sensitive data stored.**

- **Personal data:** email, name, avatar, IP address, user agent, login history, onboarding applicant details and consent records.
- **Credentials:** scrypt password hashes, hashes of session and reset tokens, encrypted refresh tokens.
- **Business content:** synced from Dropbox. Part of it is sent to AI providers when AI is enabled.
- **Financial data:** none.

**Why there is no inbound TLS yet, and what is now enforced.**

- **No TLS proxy exists yet.** That is what keeps inbound traffic unencrypted.
- **Start-up refuses to run without Secure cookies:** all three apps now refuse to start in production with non-Secure cookies behind a non-loopback URL.
- **HSTS is sent automatically:** the gateway now sends HSTS whenever `APEX_PUBLIC_URL` is https.

**Retention.**

- **Opt-in purges added:**
  - Core: `LOGIN_HISTORY_RETENTION_DAYS`
  - Showcase: `LOGIN_HISTORY_RETENTION_DAYS`, `PLATE_EVENTS_RETENTION_DAYS`
  - SlidesVault: `RETENTION_LOGIN_HISTORY_DAYS`
- **Unset means keep**, which is the current behaviour.
- **SlidesVault:** sync logs are kept 90 days and audit logs 365 days.
- **Sessions and caches:** purged automatically.
- **Reset and invite links:** blanked in the outbox by the hourly sweep once sent (`Core/core/onboarding/service.js:575-582`).
- **Backups:** kept 14 days.
- **Business retention periods are not defined. Confirmation required.**

## 8. API & Integration Security

| Item | Finding | Evidence |
|---|---|---|
| External API Integrations | See the table below. **No webhooks.** | — |
| API Authentication | See the details below. | — |
| API Authorization | Per-route gates; Core default-deny `can()`. In `required` mode, Showcase answers 401 for every non-public path. Core `/media/:key` is open to any signed-in user and protected only by an unguessable content hash. | — |
| API Rate Limiting and Throttling | See the details below. | — |
| Third-Party Dependencies | No dependencies in the gateway. The APIs use Express 4.21, cookie-parser, jszip, pg, nodemailer, `@anthropic-ai/sdk`, ffmpeg-static, `@resvg/resvg-js`, and `pdf-parse 1.1.1` (old) in the Core. Lockfiles are committed. Dependabot is now configured (`.github/dependabot.yml`). | `*/package.json` |

**External integrations.**

| Service | Used by | Purpose |
|---|---|---|
| Dropbox | all apps | OAuth and content sync |
| Google | gateway, Core | ID-token sign-in |
| Anthropic | Showcase, SlidesVault | classification and Copilot |
| Gemini, Ollama, Google TTS, ElevenLabs, Piper | Core | AI content and voice |
| Resend, SMTP, EmailJS | Core | account and onboarding mail, through an outbox |

**API authentication.**

- **Session cookies:** each app uses its own session cookie.
- **Gateway assertions:** when identity mode is on, the apps verify the gateway's HMAC assertion with these checks:
  - constant-time signature comparison
  - issuer and audience
  - lifetime of at most 120 seconds
  - source address taken from the TCP socket, never from `X-Forwarded-For`
- **Gateway header stripping:** the gateway strips client-supplied identity and forwarding headers (`apex/server.mjs:238-272`).
- **New origin checks against cross-site request forgery (CSRF):**
  - **Core:** a write that carries a session cookie must send a matching Origin or Referer. An origin derived from the Host header is trusted only for loopback hosts (`Core/http/middleware.js:36-64`).
  - **SlidesVault:** a new `originGuard` does the same (`Vault/http/security.js:86`, `Vault/app.js:59`).
  - **Showcase:** already had this check.
- **Remaining gap:** no replay cache for assertions.

**Rate limiting and throttling.**

- **Gateway:** failed sign-ins are limited per IP. **New:** request bodies are capped by `APEX_MAX_BODY_MB` (default 64), returning 413.
- **Core:** per-route limits plus a lockout.
- **Showcase:** an API-wide limit, auth limits and a lockout.
- **SlidesVault:** general, admin, login and Copilot limits.
- **Remaining gap:** all limiters are **in memory and per process**.

## 9. DevSecOps & Compliance

| Item | Finding | Evidence |
|---|---|---|
| Source Code Repository | GitHub `github.com/SiddharthS-Dev/apex-integration`. Branch protection and required reviews are **not verified**. `SECURITY.md` now gives the disclosure policy. | `SECURITY.md` |
| CI/CD Pipeline | **GitHub Actions** `.github/workflows/ci.yml` on push and pull requests: tests, builds, Postgres migrations, staging smoke and bypass tests, and now the security scanners below. **No CD:** nothing deploys. | `ci.yml` |
| SAST Implementation | **Blocking, but no passing run yet.** CI job `sast` (`ci.yml:63`) runs Semgrep packs `p/javascript`, `p/nodejs`, `p/react` and `p/owasp-top-ten`, fails on ERROR severity, and keeps a SARIF report. **First run (`develop`):** the job **never scanned**, because the pack `p/express` does not exist (HTTP 404). It was replaced in `452c805`, which CI has not run yet. | `ci.yml:63-78`, `.semgrepignore` |
| DAST Implementation | **Blocking, but no passing run yet.** An OWASP ZAP baseline (passive, unauthenticated) runs against the gateway in the staging-smoke job (`ci.yml:291`). It fails on the rules marked FAIL in `deploy/staging/zap-rules.tsv` (missing anti-framing, nosniff or CSP; cookies without HttpOnly or SameSite; wildcard CORS; error disclosure). **First run:** it **never ran**, because the image name `zaproxy/zaproxy` does not exist; it is now `zaproxy/zap-stable:2.15.0`. Forged-header and bypass smoke tests also run (they passed). | `ci.yml:291-305`, `deploy/staging/zap-rules.tsv` |
| Software Composition Analysis (SCA) | `npm audit --omit=dev --audit-level=high` **blocks** CI for all three apps, and passed on the first run. A report-only audit of all dependencies at critical level also runs. Weekly Dependabot updates cover npm, GitHub Actions and Docker base images (enablement in repository settings is not verified). | `ci.yml`, `.github/dependabot.yml` |
| Container Security | See the details below the table. | Dockerfiles, `deploy/staging/compose.yml:26-33`, `ci.yml:280` |
| Infrastructure as Code (IaC) Security | IaC is Dockerfiles and Compose files. CI job `iac-scan` (`ci.yml:79`) runs Trivy `config` for HIGH and CRITICAL findings, and is blocking. **First run:** one CRITICAL, AVD-DS-0031 in `deploy/gateway/Dockerfile:68-73`. This is a **false positive**: the flagged variables hold secret file paths, and the secrets themselves are generated inside the container at first start (`apex/auth.mjs:60-90`). It is accepted, scoped to that file, in `.trivyignore.yaml`. A compose-consistency unit test also runs. | `ci.yml:79-87`, `.trivyignore.yaml` |
| Deployment Process | **Manual, and not performed.** Deploying requires founder authorisation. | `AGENTS.md` |
| Security Code Review Process | Binding rules are in `AGENTS.md`, the R1 contract and the ADRs. Internal audit reports and this audit exist. Blocking scanners are in CI. `SECURITY.md:23-90` sets triage, fix timelines and accepted-risk rules. No CODEOWNERS file or required-review gate is verified. | `SECURITY.md` |
| ISO 27001 Applicability | **Applicable.** No certification or ISMS evidence. **Confirmation required.** | — |
| NIST CSF Applicability | **Applicable** as a reference framework. No mapping exists. | — |
| CIS Controls Applicability | **Applicable**, in particular Controls 3, 4, 5, 6, 7, 11 and 16. | — |
| OWASP Top 10 Applicability | **Directly applicable.** See the status below. | — |
| GDPR / Privacy Requirements Applicability | **Applicable.** The product stores names, emails, IP addresses and login history. Onboarding records consent and is switched off in production without an approved notice. Deletion has improved in the Core. Still missing: export, and deletion in Showcase and SlidesVault. **The jurisdiction (GDPR, India DPDP Act or other) needs confirmation from Legal.** | `Core/core/onboarding/config.js:114-125` |

**Container security details.**

- **Non-root, minimal images:** every image runs as `USER node`, with multi-stage builds and production dependencies only.
- **Read-only application code:** SlidesVault's `/app` is root-owned and read-only to the process; only `/data` is writable.
- **Staging runtime hardening:** `read_only`, `cap_drop: [ALL]`, `no-new-privileges`.
- **Image scan:** Trivy checks all four images for fixable HIGH and CRITICAL issues, and is now blocking (`ci.yml:280`).
  - **First run:** no OS findings. 10 HIGH npm-package findings in each of gateway, core and showcase-api, and 6 in slidesvault-api: `brace-expansion`, `ip-address`, `pacote`, `undici`.
  - **Source:** none of those packages is in any app lockfile. They are the npm CLI bundled with the Node base image.
  - **Fix (`452c805`):** npm, npx, corepack and yarn are deleted from every runtime stage (`deploy/gateway/Dockerfile:88`, `Inspironics Academia/apps/api/Dockerfile:40`, `inspironics-innovation-showcase/apps/api/Dockerfile:42`, `slide vault/apps/api/Dockerfile:48`). The runtimes and health checks call only `node`.
  - **Defect in that fix:** the `RUN rm -rf` line contains a literal `\n` instead of a line continuation, in all four files. It still removes every target (the shell turns `\n` into a harmless extra argument `n`), but it should be corrected.
- **Not yet done:** base images are pinned by tag, not digest.

**OWASP Top 10 status.**

| Category | What is in place | What remains |
|---|---|---|
| A01 Broken Access Control | Default-deny `can()`, default-deny row-level rules, per-route gates, and CSRF origin checks in all apps | Two admin models in Academia |
| A02 Cryptographic Failures | scrypt at N=2^17, AES-256-GCM | No TLS proxy yet |
| A03 Injection | Parameterised queries throughout | — |
| A04 Insecure Design | Gateway Host allow-list | — |
| A05 Security Misconfiguration | Baseline security headers and fail-closed production start-up | Limited CSP |
| A07 Authentication Failures | Atomic reset tokens, rehash on login | No MFA |
| A08 Software and Data Integrity | Zip-bomb and file-signature checks | — |

---

# SECTION 2: SECURITY TOOLS & IMPLEMENTATIONS

The Estimated Cost column says **Not Available** wherever the repository records no cost. No costs are invented. Every tool added in this revision is free or open source. It runs inside GitHub Actions, whose minutes are free on public repositories and within plan quotas on private ones; **confirm the repository's visibility and plan**.

## 2.1 Network Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Network | Firewall | None in repository | Yes | Not Verified | Not Applicable | Not Available | High | No host firewall, security group or ACL configuration exists. Loopback binds are not a firewall. **Confirm with Infrastructure** before any hosted deployment. |
| Network | Web Application Firewall (WAF) | None | Yes | Not Implemented | Not Applicable | Not Available | High | Needs a hosting decision (DEC-010). Then use a cloud WAF or an OWASP CRS-based proxy in front of the gateway. Cannot be done in code. |
| Network | IDS / IPS | None | Yes | Not Implemented | Not Applicable | Not Available | Medium | Depends on the host. **Confirm with Infrastructure or Security.** |
| Network | VPN | None | Yes (for administrative access to hosts) | Not Implemented | Not Applicable | Not Available | Medium | There is no hosted environment to reach. Administrative and database access paths must be defined with the hosting choice. |
| Network | Network Segmentation | Docker internal network; per-app Postgres roles; trusted-source pinning; loopback-only port publishing; gateway Host allow-list | Yes | Implemented | Open Source | Not Available | High | Covers every environment the repository defines. Staging has `internal: true` and a CI bypass test (12/12 refused). SlidesVault compose is now on `127.0.0.1` (`slide vault/docker-compose.yml:30`). The gateway answers 421 to an unknown Host (`apex/server.mjs:145-178`). **Production network segmentation must be designed with the hosting choice.** |

## 2.2 Identity Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Identity | Identity and Access Management (IAM) | APEX Core (in-house) | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | See the notes below the table. |
| Identity | Multi-Factor Authentication (MFA) | None | Yes | Not Implemented | Not Applicable | Not Available | **Critical** | Not done in this revision. Sign-in is fanned out from the gateway to every app (`apex/auth.mjs:278-286`), and the R1 identity contract is binding, so MFA needs a design decision before code: where the second factor is checked, recovery, and enrolment of existing admins. **This is the top remaining item.** |
| Identity | Single Sign-On (SSO) | APEX gateway (custom); optional Google Sign-In | Yes | Partially Implemented | Not Applicable (in-house); Google Free | Not Available | Medium | One sign-in for all apps works and is tested. **Gaps:** identity mode defaults to `off` for local development, there is no assertion replay cache, and there is no enterprise identity-provider federation. |
| Identity | Privileged Access Management (PAM) | `grant-admin` CLI with audit; platform-admin approval | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | **Missing:** a PAM tool, just-in-time elevation, MFA on privileged roles, and access reviews. The Academia invite API still returns a one-time temporary password to the inviting admin (`Core/auth/routes.js:168`). |

**IAM notes.**

- **Strengths:**
  - default-deny `can()` and organisation scoping
  - no self-grant of platform admin
  - no merging of accounts by email
  - session revocation through epochs
  - append-only audit
- **This revision:**
  - password reset is now atomic and single-use (`Core/auth/routes.js:138-152`; tested with three concurrent attempts)
  - scrypt raised to N=2^17 with rehash on login in Core (`Core/auth/passwords.js`) and SlidesVault (`Vault/db/repositories/userRepository.js:22,75`); Showcase already used it
  - open registration now defaults to **off in production** in all three apps (`Core/config.js:58-59`, `Showcase/config.js:114-115`, `Vault/config/index.js:135`)
- **Revision 3:** row-level rules are now default-deny for missing, malformed or misspelled rules (`Inspironics Academia/packages/shared/src/rls.js:28-44`, `test/rlsDefaultDeny.test.js`).
- **Gaps (why this stays Partially Implemented):**
  - no MFA (separate row)
  - Use Case 004 is open: existing accounts are not linked
  - Academia has two admin models
  - the password policy is length-based only

## 2.3 Data Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Data | Encryption at Rest | Node `crypto` AES-256-GCM (tokens, backup sets) | Yes | Partially Implemented | Open Source | Not Available | High | **New:** backups are encrypted (`deploy/staging/backup.mjs`), and a test checks no plaintext appears in the output (`staging.test.mjs`). **Gap:** database files, Postgres volumes and object stores are plaintext. Disk or volume encryption must come from the host. **Confirm with Infrastructure.** |
| Data | Encryption in Transit | Outbound HTTPS; HSTS and fail-closed production start-up | Yes | Partially Implemented | Not Applicable | Not Available | **Critical** | **New:** HSTS is sent when `APEX_PUBLIC_URL` is https. All three apps now refuse to start in production with non-Secure cookies behind a non-loopback URL (`Core/startupChecks.js`, `Vault/config/index.js:367`, `Showcase/config.js:209-229`). **Gap:** no TLS-terminating proxy exists, and Postgres TLS is not configured. Both arrive with hosting (`STAGING_RUNBOOK.md` §9). |
| Data | Key Management | `kid` store and rotation CLI for identity keys; `<NAME>_PREVIOUS` key rings, rewrap CLIs and `generate-secrets.mjs --rotate` for the four data-encryption keys | Yes | **Implemented** | Not Applicable (in-house) | Not Available | Medium | **Revision 3:** every key is now rotatable without losing data. The repository evidence covers generation (random, 32 bytes), storage (file mode 0600, gitignored), per-audience distribution, start-up validation, rotation, re-encryption, retirement, and a schedule (key table in Section 1 §7; `STAGING_RUNBOOK.md:72`). Tests: Core 343/343, Showcase 89/89, SlidesVault 269/269, staging tools 13/13 (local). **Recommended improvements:** a KMS or HSM once hosted; test the rewrap CLIs on Postgres. |
| Data | Secrets Management | Environment variables, gitignored files, `generate-secrets.mjs` (with `--rotate`), gitleaks in CI | Yes | Partially Implemented | Open Source | Not Available | High | **Revision 2:** in production, reset and invite links are not written to logs unless `EMAIL_LOG_SECRETS=true` (`Core/notify/mailer.js:105-125`), and they are blanked in the outbox once sent. The bootstrap admin password needs at least 12 characters in production. **Revision 3:** secrets can be rotated. **Gaps:** no secrets vault or Docker secrets (depends on hosting); a delivered link stays in the outbox for up to an hour; gitleaks reports one unresolved finding (DevSecOps section). |

## 2.4 Application Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Application | Web Application Firewall | None | Yes | Not Implemented | Not Applicable | Not Available | High | Same as the Network WAF row; the template lists it twice. In-application substitutes: origin checks, Host allow-list, body caps, rate limits. |
| Application | Static Application Security Testing (SAST) | Semgrep OSS (`semgrep/semgrep:1.95.0`) | Yes | Partially Implemented | Open Source | Not Available | High | Blocking job `sast` (`ci.yml:63-78`) with packs `p/javascript`, `p/nodejs`, `p/react` and `p/owasp-top-ten`, and a SARIF report. **No scan has completed:** the first run failed on a nonexistent pack (`p/express`, HTTP 404). The fix is in `452c805` and has not run yet (see the CI evidence row in the header). **Becomes Implemented** when a run passes, or when its findings are fixed or accepted under `SECURITY.md`. |
| Application | Dynamic Application Security Testing (DAST) | OWASP ZAP baseline (`zaproxy/zap-stable:2.15.0`); staging smoke and bypass tests | Yes | Partially Implemented | Open Source | Not Available | Medium | Blocking, against the gateway, with FAIL rules in `deploy/staging/zap-rules.tsv` and the report as an artifact (`ci.yml:291-305`). **No scan has completed:** the first run used an image name that does not exist, now corrected. Passive and unauthenticated. **Becomes Implemented** when a run passes. **Recommended:** an authenticated ZAP scan. |
| Application | Software Composition Analysis (SCA) | `npm audit` in CI; Dependabot | Yes | Implemented | Free | Not Available | High | The production audit at high severity **blocks** CI for all three apps and passed on the first `develop` run. A report-only audit of all dependencies at critical level also runs. Dependabot is configured (`.github/dependabot.yml`); enablement in repository settings is **not verified**. **Remaining:** no SBOM; `pdf-parse 1.1.1` is old. |
| Application | API Security | In-house middleware: authentication and RBAC, HMAC assertions, header stripping, CORS allow-lists, CSRF origin checks, Host allow-list, rate limits, body caps, security headers, parameterised SQL, zip limits | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | See the changes and remaining gaps below the table. |

**API Security: new in this revision.**

1. **Origin checks against cross-site request forgery (CSRF):**
   - **Core:** writes that carry a cookie need a matching Origin or Referer. Host-derived origins are trusted only on loopback.
   - **SlidesVault:** a new `originGuard`, which trusts no Host-derived origin.
   - **Tests:** `Inspironics Academia/apps/api/test/securityAudit.test.js` and `slide vault/apps/api/tests/integration/csrf.test.js` (9 tests).
2. **Gateway security headers:**
   - Every response the gateway serves gets nosniff, `Referrer-Policy` and `X-Frame-Options`.
   - HSTS is added when the public URL is https.
   - HTML pages get a default CSP: `object-src 'none'; base-uri 'self'; frame-ancestors 'self'`.
   - Proxied API responses get nosniff and HSTS only where the app did not set them.
   - Code: `apex/server.mjs:103-130`.
3. **Gateway Host allow-list:** requests with an unknown Host get 421 (`APEX_ALLOWED_HOSTS`).
4. **Gateway body cap:** `APEX_MAX_BODY_MB`, returning 413.
5. **SlidesVault PPTX extraction:**
   - Before decompressing, the archive's directory is inspected and refused if it has too many entries, too large a declared size, or ZIP64 (`Vault/services/content-extraction/pptx.js:73`).
   - Decompression streams against a shared byte budget (`:123`).
   - The file signature (magic bytes) is checked before parsing (`ContentExtractionService.js:38`).
   - Tests: `tests/unit/zipLimits.test.js` (9 tests).
6. **Showcase SPA HTML** now carries a CSP when the API serves it.

**API Security: remaining gaps.**

- No assertion replay cache.
- Rate limits are in memory and per process.
- The app bundles have no strict `script-src` CSP. Adding one needs per-app testing.
- Core returns `err.message` on 4xx responses.

## 2.5 Cloud Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Cloud | Cloud Security Posture Management (CSPM) | None | Yes (once a cloud provider is chosen) | Not Implemented | Not Applicable | Not Available | Medium | There is no cloud account (DEC-010). It cannot be done in code. Plan it with the hosting decision. |
| Cloud | Cloud Workload Protection | Container runtime hardening; Trivy image scan | Yes | Partially Implemented | Open Source | Not Available | Medium | **Hardening:** `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, tmpfs, non-root user. **New:** SlidesVault code is root-owned and read-only to the process; images are scanned in CI. **Gap:** no runtime threat detection (Falco, Defender, GuardDuty), which needs a host. |
| Cloud | Cloud Audit Logging | None at cloud level; application audit tables | Yes | Not Implemented | Not Applicable | Not Available | High | There is no cloud and no SIEM. The application-level trails (Core `audit_events`, SlidesVault `audit_log`, `login_history`) are unchanged. Showcase still does not audit admin role changes (that would need a schema change). |

## 2.6 DevSecOps

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| DevSecOps | Container Image Scanning | Trivy (`aquasec/trivy:0.57.1`) | Yes | Partially Implemented | Open Source | Not Available | High | Blocking scan of all four images for fixable HIGH and CRITICAL issues (`ci.yml:280`). **First run:** 36 HIGH findings, all in the npm CLI bundled with the Node base image. They were fixed in `452c805` by removing npm from the runtime images (container security details, Section 1 §9). **The fix has not been re-scanned yet.** Base images are not pinned by digest. **Becomes Implemented** when a run passes. |
| DevSecOps | Infrastructure as Code Scanning | Trivy `config` | Yes | Partially Implemented | Open Source | Not Available | Low | Blocking job `iac-scan` (`ci.yml:79-87`) over every Dockerfile and Compose file, skipping the retired `legacy/`. **First run:** one false positive (AVD-DS-0031), now accepted, scoped to its file, in `.trivyignore.yaml`. **Has not been re-run since.** **Becomes Implemented** when a run passes. |
| DevSecOps | Secret Scanning | gitleaks (`ghcr.io/gitleaks/gitleaks:v8.21.2`), full history | Yes | Partially Implemented | Open Source | Not Available | High | See the notes below the table. |

**Secret Scanning notes.**

- **What runs:** blocking job `secret-scan` (`ci.yml:47-62`) scans full git history with gitleaks' default rules. It prints findings with values redacted and keeps a SARIF report.
- **Allow-list:** `.gitleaks.toml` allows only fake test fixtures, placeholders in example files, and two documented throwaway CI values.
- **First run (`develop`):** `leaks found: 1`. The job did not yet print which file or rule; the next run will.
  - A manual search of history for common credential formats found no match: Anthropic, Google, GitHub, Slack, AWS, Resend, Dropbox and private keys.
  - The finding is therefore **unresolved and unidentified**.
  - **Handle it as Critical under `SECURITY.md`:** if it is real, rotate the secret first.
- **Becomes Implemented** when the finding is resolved and a run passes.
- **Also recommended:** turn on GitHub secret scanning and push protection in repository settings. **Confirm.**

## 2.7 Incident Response

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Incident Response | Vulnerability Management | `SECURITY.md` (policy and process); CI scanners; `npm audit`; Dependabot; GitHub security advisories and `security` issues | Yes | **Implemented** | Free / Open Source | Not Available | High | See the notes below the table. |
| Incident Response | Backup and Disaster Recovery | `deploy/staging/backup.mjs` (encrypted, verified, retention); runbook restore drill; image rollback; identity rollback CLI | Yes | Partially Implemented | Open Source | Not Available | **Critical** | See the details below the table. |

**Vulnerability Management notes.**

- **Intake:** private reporting through GitHub, with acknowledgement within 2 working days and assessment within 5 (`SECURITY.md:3-21`).
- **Sources:** every finding source is listed: reports, the five CI scanners, `npm audit`, Dependabot, audits and penetration tests (`SECURITY.md:25-38`).
- **Fix timelines:**

  | Severity | Fix within |
  |---|---|
  | Critical | 2 days |
  | High | 7 days |
  | Medium | 30 days |
  | Low | 90 days |

  Severity goes up one level for anything touching identity, authorisation or personal data. A leaked secret is always Critical, and is rotated first (`SECURITY.md:40-54`).
- **Tracking:** private advisories for exploitable issues, `security`-labelled issues otherwise, and a commit reference for each fix (`SECURITY.md:56-64`).
- **Accepted risks:** only in the four ignore files, narrowly scoped and with a reason. A real vulnerability is never accepted to make CI green (`SECURITY.md:66-82`).
- **Review cadence:** monthly review, plus a penetration test before the R6 pilot and yearly after that (`SECURITY.md:84-89`).
- **Evidence it is working:** the first scanner run on `develop` was triaged under this process (see the DevSecOps rows).
- **Not verified:** whether private vulnerability reporting is enabled in GitHub settings. The timelines are set in the repository and should be **confirmed by the Security owner**.
- **Recommended:** commission the first penetration test.

**Backup and Disaster Recovery details.**

- **New:**
  - the automated encrypted backup tool, with manifest and SHA-256 per file
  - `verify` and `decrypt` commands
  - 14-day retention that never drops the newest 3 sets
  - unit tests: `staging.test.mjs`, 10 of 10 pass
  - a CI step that backs up the live staging stack, verifies the set, and checks that the decrypted dump is readable by `pg_restore`
  - a runbook section with scheduling commands (`STAGING_RUNBOOK.md` §7)
- **Gaps:**
  - no schedule is installed on any host, because there is no host
  - no off-site copy
  - no RPO or RTO
  - local SQLite databases are not covered (they hold live data; backing them up needs authorisation)

---

# Security Assessment Summary

| Metric | Revision 1 (2026-11-17) | Revision 2 | **Revision 3 (now)** |
|---|---|---|---|
| **Total Security Controls Identified** | 26 | 26 | **26** |
| **Fully Implemented Controls** | 0 | 2 | **4:** Network Segmentation, SCA, Key Management, Vulnerability Management |
| **Partially Implemented Controls** | 13 | 16 | **14:** IAM, SSO, PAM, Encryption at Rest, Encryption in Transit, Secrets Management, SAST, DAST, API Security, Cloud Workload Protection, Container Image Scanning, IaC Scanning, Secret Scanning, Backup and DR |
| **Not Implemented Controls** | 12 | 7 | **7:** WAF (Network), IDS/IPS, VPN, MFA, WAF (Application), CSPM, Cloud Audit Logging |
| **Not Verified Controls** | 1 | 1 | **1:** Firewall |

**Five rows wait only on a CI run:** SAST, DAST, Container Image Scanning, IaC Scanning and Secret Scanning.

- **What's done:** each is configured and blocking, and its first-run findings were triaged and fixed in `452c805`.
- **What's missing:** no run has passed with those fixes. This branch does not trigger the workflow (see the header).
- **Effect:** if a run passes, and the gitleaks finding is resolved, the count becomes **9 Implemented / 9 Partially Implemented / 7 Not Implemented / 1 Not Verified**.

**The other nine Partial rows need decisions outside the repository:**

| Rows | What they need |
|---|---|
| IAM, SSO, PAM | MFA, which needs a design decision under the binding R1 identity contract |
| Encryption at Rest, Encryption in Transit, Secrets Management, Cloud Workload Protection, Backup and DR | A hosting provider (DEC-010) |
| API Security | Shared infrastructure for rate limits, and an ADR for an assertion replay cache |

Six of the seven Not Implemented controls also need hosting; the seventh is MFA.

## Remediated

**Revision 3**

| Gap | Fix | Evidence |
|---|---|---|
| Data-encryption keys could not be rotated without losing data | `<NAME>_PREVIOUS` key rings, rewrap CLIs, `--rotate`, runbook schedule | Section 1 §7 key table; `STAGING_RUNBOOK.md:72` |
| No remediation timelines, tracking or accepted-risk rules | Vulnerability-management process | `SECURITY.md:23-90` |
| Scanners were non-blocking; Semgrep and ZAP never ran (bad pack, bad image) | All blocking; configs corrected; SARIF and ZAP reports kept | `ci.yml:47-87,280-305` |
| HIGH findings in all images, from the npm CLI bundled with Node | npm, npx, corepack and yarn removed from runtime images | the four Dockerfiles (Section 1 §9) |
| Trivy config false positive | Path-scoped acceptance with a reason | `.trivyignore.yaml` |
| Missing, malformed or misspelled row-level rules allowed everyone | Default deny | `rls.js:28-44`; `test/rlsDefaultDeny.test.js` |
| Gateway session secret could be overwritten by a parallel start (caused a random CI test failure) | Exclusive create; the loser adopts the winner's secret | `apex/auth.mjs:60-90` |

**Revisions 1 → 2**

| Gap | Fix |
|---|---|
| Password-reset token race | Atomic claim before the password changes |
| Reset and invite links in logs and the outbox | Withheld from production logs; blanked once sent |
| CSRF gaps in the Core and SlidesVault | Origin or Referer checks on writes that carry a cookie |
| No gateway security headers or Host checks | Baseline headers, HSTS, CSP, Host allow-list, body cap |
| SlidesVault zip bomb; no file-signature check | Directory pre-check, streaming budget, signature check |
| SlidesVault API exposed; writable `/app` | Loopback-only publish; root-owned code |
| Insecure production configurations could start | Fail-closed start-up checks |
| Open registration by default | Off in production |
| Low scrypt cost | N=2^17 with rehash on login |
| Retention and deletion gaps | Retention purges; Core user deletion |
| No backup tool | Encrypted, verified backups with retention |

Full revision 2 evidence is in git history (`b9f5dae`).

**Local verification on 2026-11-18**

| Suite | Result |
|---|---|
| Core API | 343 / 343 pass, including key rotation and row-level rules |
| Showcase API | 89 / 89 pass |
| SlidesVault | 269 / 269 pass |
| Staging tooling | 13 / 13 pass |
| Gateway | 53 / 53 pass, three consecutive runs from a clean state |

- **Not run locally:** Docker image builds and the CI scanners. Docker cannot start because drive C: is full, and downloading scanner binaries was not permitted.
- **CI evidence:** the first-run results above come from GitHub Actions run `44260126905`.

## Critical Security Gaps (remaining)

1. **No TLS in front of the product.** Production start-up fails closed and HSTS is ready, but a TLS-terminating proxy and Postgres TLS depend on hosting.
2. **No MFA**, including for `platform_admin`.
3. **One unresolved gitleaks finding in git history.** It is unidentified so far. Treat it as Critical until it is shown to be a false positive; if real, rotate the secret first.
4. **No scheduled or off-site backups, and no RPO or RTO.** The tool exists; a host and scheduler do not. Databases are not encrypted at rest.

## High-priority gaps (remaining)

5. **The scanner fixes have not passed CI yet.** Run them (push to a `feature-**` branch or open a pull request), then resolve what they report.
6. **In-memory rate limits and local revocation:** these do not hold across replicas.
7. **No assertion replay cache.** Adding one changes the identity contract, so it needs an ADR.
8. **No strict `script-src` CSP** for the app bundles.
9. **Incomplete privacy controls:** Showcase and SlidesVault have no deletion or export; no data classification or retention policy exists.
10. **No enterprise identity-provider federation, PAM tooling or access reviews.**

## Recommended Improvements

| # | Recommendation | Priority |
|---|---|---|
| 1 | Run CI on the scanner fixes and identify the gitleaks finding (rotate first if real). Fix the literal `\n` in the four Dockerfiles' `RUN rm -rf` line. Add `security/**` to the workflow's branch triggers, or use pull requests. | Critical |
| 2 | Decide hosting (DEC-010). Then add a TLS proxy (https `APEX_PUBLIC_URL`, `APEX_TRUST_PROXY`, Secure flags), Postgres `sslmode=require`, host firewall or security groups, a WAF, volume encryption, and a KMS for the data-encryption keys. | Critical |
| 3 | Design and build MFA (TOTP or WebAuthn) in the Core, mandatory for privileged roles. Record it in an ADR. | Critical |
| 4 | Schedule `backup.mjs` daily, copy sets off-host, keep the backup key separately, set an RPO and RTO, and run the restore drill monthly. | Critical |
| 5 | Enable Dependabot, secret scanning, push protection and private vulnerability reporting in GitHub settings. Add branch protection and CODEOWNERS. | High |
| 6 | Move rate limits, lockouts and gateway revocation to a shared store before scaling out. Add an assertion `jti` replay cache through an ADR. | High |
| 7 | Add a strict CSP per app bundle. Pin base images and Actions by digest or SHA. Add an authenticated ZAP scan. | High |
| 8 | Add user deletion and export to Showcase and SlidesVault. Define data classification and retention, then set the retention variables. | High |
| 9 | Retire the legacy Academia admin model; add an idle session timeout; strengthen the password policy. Test the rewrap CLIs on Postgres. | Medium |
| 10 | Commission a penetration test before the R6 pilot. Remove `legacy/nextjs-app`. | Medium |

## Information Requiring Confirmation

| Topic | Owner |
|---|---|
| Business criticality rating | Business owner / Security |
| Hosting and cloud provider, and production OS, compute and storage (DEC-010) | Infrastructure / Founder |
| Firewall, WAF, IDS/IPS, VPN or bastion for future hosts | Infrastructure / Security |
| Disk and volume encryption on the development machine and future hosts | Infrastructure / IT |
| Backup schedule, off-site location, RPO and RTO | DevOps / Business owner |
| The gitleaks finding: what it is, and whether a real secret needs rotating | Security / Repository owner |
| GitHub settings: visibility, branch protection, required reviews, secret scanning, push protection, Dependabot, private vulnerability reporting | DevOps / Repository owner |
| Approval of the fix timelines in `SECURITY.md` | Security owner |
| Data classification scheme and retention periods | Data Protection / Security |
| Applicable privacy law and the approved consent notice | Legal / DPO |
| ISO 27001, NIST CSF or CIS programme status | Security / Compliance |
| Costs for any paid tooling chosen later (WAF, CSPM, KMS, GitHub Advanced Security) | Security / Finance |
| Whether the uncommitted onboarding module is in release scope | Product owner |
