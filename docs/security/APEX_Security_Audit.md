# APEX — Security Audit

| | |
|---|---|
| **Product** | APEX (Inspironics APEX platform) |
| **Revision** | 2, 2026-11-18. It re-assesses the product after the remediation work (summary table at the end). Revision 1 was dated 2026-11-17. |
| **Repository** | `github.com/SiddharthS-Dev/apex-integration` |
| **Branch / commit** | `Feature-base-removal` @ `2aee3b0`, plus **uncommitted** working-tree changes: the remediation in this revision, the onboarding module and `onboarding/`. Nothing has been pushed, so the new CI jobs have **not run yet**. |
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

**Remaining permission gaps.**

- **Two admin models in Academia:** most Academia admin routes check the legacy `users.role` admin.
- **Latent default-allow:** an empty row-level rule allows access (`rls.js:25`).

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
| Key Management | Identity-assertion keys: `kid` store with current and previous keys, at least 32 bytes each, rotated with a CLI and a runbook. Each service holds only its own audience's keys. Token-encryption keys must be 32 bytes and are validated at start-up (the Core now also validates `TOKEN_ENCRYPTION_KEY` at start-up). Keys live in environment variables or files, not in a KMS. | `docs/operations/IDENTITY_ASSERTION.md`, `Core/startupChecks.js` |
| Data Retention Period | See the retention details below. | — |
| Secure Data Deletion | **Core:** deleting a user now also removes their `login_history` and `email_outbox` rows (`Core/repo/users.js:71-90`); `audit_events` is kept deliberately. **Showcase and SlidesVault:** still no user-delete or export endpoint. No secure wipe of volumes. | — |

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
| SAST Implementation | **Configured, not yet run.** CI job `sast` runs Semgrep OSS rule packs (`p/javascript`, `p/nodejs`, `p/express`, `p/react`), failing on ERROR severity. It is non-blocking (`continue-on-error`) until the first run is triaged. Exclusions are in `.semgrepignore`. | `ci.yml` job `sast` |
| DAST Implementation | **Configured, not yet run.** An OWASP ZAP baseline scan (passive, unauthenticated) runs against the gateway in the staging-smoke job and keeps the report as a CI artifact for 14 days. It is non-blocking. The existing forged-header and bypass smoke tests also run. | `ci.yml` staging-smoke job |
| Software Composition Analysis (SCA) | `npm audit --omit=dev --audit-level=high` blocks CI for all three apps. **New:** a report-only audit of all dependencies at critical level, and weekly Dependabot updates for npm, GitHub Actions and Docker base images. Dependabot starts once the file is pushed and enabled. | `ci.yml`, `.github/dependabot.yml` |
| Container Security | Every image runs as `USER node`, with multi-stage builds and production dependencies only. SlidesVault's `/app` is now **root-owned and read-only to the process**, with only `/data` writable (`slide vault/apps/api/Dockerfile:44`). Staging adds `read_only`, `cap_drop: [ALL]` and `no-new-privileges`. **New:** a Trivy scan of all four images for fixable HIGH and CRITICAL issues (non-blocking). Base images are pinned by tag, not digest. | Dockerfiles, `compose.yml:26-33`, `ci.yml` |
| Infrastructure as Code (IaC) Security | IaC is Dockerfiles and Compose files. **New:** CI job `iac-scan` runs Trivy `config` for HIGH and CRITICAL findings (non-blocking). A compose-consistency unit test also runs. | `ci.yml` job `iac-scan`, `deploy/staging/staging.test.mjs` |
| Deployment Process | **Manual, and not performed.** Deploying requires founder authorisation. | `AGENTS.md` |
| Security Code Review Process | Binding rules are in `AGENTS.md`, the R1 contract and the ADRs. Internal audit reports and this audit exist. Automated scanners are now in CI. No CODEOWNERS file or required-review gate is verified. | — |
| ISO 27001 Applicability | **Applicable.** No certification or ISMS evidence. **Confirmation required.** | — |
| NIST CSF Applicability | **Applicable** as a reference framework. No mapping exists. | — |
| CIS Controls Applicability | **Applicable**, in particular Controls 3, 4, 5, 6, 7, 11 and 16. | — |
| OWASP Top 10 Applicability | **Directly applicable.** See the status below. | — |
| GDPR / Privacy Requirements Applicability | **Applicable.** The product stores names, emails, IP addresses and login history. Onboarding records consent and is switched off in production without an approved notice. Deletion has improved in the Core. Still missing: export, and deletion in Showcase and SlidesVault. **The jurisdiction (GDPR, India DPDP Act or other) needs confirmation from Legal.** | `Core/core/onboarding/config.js:114-125` |

**OWASP Top 10 status.**

| Category | What is in place | What remains |
|---|---|---|
| A01 Broken Access Control | Default-deny `can()`, per-route gates, and CSRF origin checks in all apps | Two admin models in Academia; empty row-level rules allow |
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
- **Gaps:**
  - Use Case 004 is open: existing accounts are not linked
  - Academia has two admin models
  - an empty row-level rule allows access
  - the password policy is length-based only

## 2.3 Data Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Data | Encryption at Rest | Node `crypto` AES-256-GCM (tokens, backup sets) | Yes | Partially Implemented | Open Source | Not Available | High | **New:** backups are encrypted (`deploy/staging/backup.mjs`), and a test checks no plaintext appears in the output (`staging.test.mjs`). **Gap:** database files, Postgres volumes and object stores are plaintext. Disk or volume encryption must come from the host. **Confirm with Infrastructure.** |
| Data | Encryption in Transit | Outbound HTTPS; HSTS and fail-closed production start-up | Yes | Partially Implemented | Not Applicable | Not Available | **Critical** | **New:** HSTS is sent when `APEX_PUBLIC_URL` is https. All three apps now refuse to start in production with non-Secure cookies behind a non-loopback URL (`Core/startupChecks.js`, `Vault/config/index.js:367`, `Showcase/config.js:209-229`). **Gap:** no TLS-terminating proxy exists, and Postgres TLS is not configured. Both arrive with hosting (`STAGING_RUNBOOK.md` §9). |
| Data | Key Management | `kid` key store with rotation CLI; per-audience distribution; start-up validation | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | Medium | **New:** the Core validates `TOKEN_ENCRYPTION_KEY` at start-up. The backup key is generated with the other staging secrets. **Gaps:** no KMS or HSM; no rotation schedule for the token-encryption or backup keys; the gateway revocation list is local to one instance. |
| Data | Secrets Management | Environment variables, gitignored files, `generate-secrets.mjs`, gitleaks in CI | Yes | Partially Implemented | Open Source | Not Available | High | **New:** in production, reset and invite links are no longer written to the log by the log mail transport unless `EMAIL_LOG_SECRETS=true` (`Core/notify/mailer.js:105-125`). They are blanked in the outbox by the hourly sweep once sent. The bootstrap admin password needs at least 12 characters in production. Secret scanning is configured in CI. **Gap:** no secrets vault or Docker secrets; a delivered link stays in the outbox for up to an hour. |

## 2.4 Application Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Application | Web Application Firewall | None | Yes | Not Implemented | Not Applicable | Not Available | High | Same as the Network WAF row; the template lists it twice. In-application substitutes: origin checks, Host allow-list, body caps, rate limits. |
| Application | Static Application Security Testing (SAST) | Semgrep OSS (`semgrep/semgrep:1.95.0`) | Yes | Partially Implemented | Open Source | Not Available | High | Configured in the `sast` job. It has **not run yet**, because nothing has been pushed. It is non-blocking until the first results are triaged; then remove `continue-on-error`. |
| Application | Dynamic Application Security Testing (DAST) | OWASP ZAP baseline (`zaproxy/zaproxy:2.15.0`); staging smoke and bypass tests | Yes | Partially Implemented | Open Source | Not Available | Medium | Configured in staging-smoke, against the gateway's `/login`, with the report as an artifact. **Not run yet.** Passive and unauthenticated. **Next:** an authenticated ZAP scan, then make it blocking. |
| Application | Software Composition Analysis (SCA) | `npm audit` in CI; Dependabot | Yes | Implemented | Free | Not Available | High | The production audit at high severity **blocks** CI for all three apps. **New:** a report-only audit of all dependencies at critical, and Dependabot (`.github/dependabot.yml`), active after push and when enabled in repository settings. **Remaining:** no SBOM; `pdf-parse 1.1.1` is old. |
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
| DevSecOps | Container Image Scanning | Trivy (`aquasec/trivy:0.57.1`) | Yes | Partially Implemented | Open Source | Not Available | High | The staging-smoke job scans gateway, core, showcase-api and slidesvault-api for fixable HIGH and CRITICAL issues. **Not run yet**, and non-blocking. Base images are not yet pinned by digest; Dependabot's docker ecosystem will propose updates. |
| DevSecOps | Infrastructure as Code Scanning | Trivy `config` | Yes | Partially Implemented | Open Source | Not Available | Low | The `iac-scan` job covers every Dockerfile and Compose file, skipping the retired `legacy/`. **Not run yet**, and non-blocking. |
| DevSecOps | Secret Scanning | gitleaks (`ghcr.io/gitleaks/gitleaks:v8.21.2`), full history | Yes | Partially Implemented | Open Source | Not Available | High | The `secret-scan` job scans full history with default rules. `.gitleaks.toml` allow-lists only fake test fixtures, placeholders in example files, and two documented throwaway CI values. **Not run yet**, and non-blocking. **Also recommended:** turn on GitHub secret scanning and push protection in repository settings. **Confirm.** |

## 2.7 Incident Response

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Incident Response | Vulnerability Management | `SECURITY.md`; CI scanners; `npm audit`; Dependabot; audit reports | Yes | Partially Implemented | Free / Open Source | Not Available | High | **New:** a disclosure policy (`SECURITY.md`) that points to GitHub private vulnerability reporting, which must be switched on in settings, plus automated scanners in CI. **Gaps:** no remediation timelines (SLA), no tracker, no penetration test. |
| Incident Response | Backup and Disaster Recovery | `deploy/staging/backup.mjs` (encrypted, verified, retention); runbook restore drill; image rollback; identity rollback CLI | Yes | Partially Implemented | Open Source | Not Available | **Critical** | See the details below the table. |

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

| Metric | Revision 1 (2026-11-17) | **Revision 2 (now)** |
|---|---|---|
| **Total Security Controls Identified** | 26 | **26** |
| **Fully Implemented Controls** | 0 | **2:** Network Segmentation, SCA |
| **Partially Implemented Controls** | 13 | **16:** IAM, SSO, PAM, Encryption at Rest, Encryption in Transit, Key Management, Secrets Management, SAST, DAST, API Security, Cloud Workload Protection, Container Image Scanning, IaC Scanning, Secret Scanning, Vulnerability Management, Backup and DR |
| **Not Implemented Controls** | 12 | **7:** WAF (Network), IDS/IPS, VPN, MFA, WAF (Application), CSPM, Cloud Audit Logging |
| **Not Verified Controls** | 1 | **1:** Firewall |

Six of the seven controls still Not Implemented need a hosting or cloud decision (DEC-010), so they cannot be built in the repository. The seventh, MFA, needs a design decision first. SAST, DAST, image scanning, IaC scanning and secret scanning are rated *Partially Implemented* only because their CI jobs have not run yet and are deliberately non-blocking. They become *Implemented* once the branch is pushed, the first results are triaged, and `continue-on-error` is removed.

## Remediated in this revision

| Gap (revision 1) | Fix | Evidence |
|---|---|---|
| Password-reset token reusable under a race | Atomic claim before the password changes; the weak-password check happens first | `Core/auth/routes.js:138-152`; `test/securityAudit.test.js` |
| Reset and invite links in logs and the outbox | Withheld from production logs (opt-in `EMAIL_LOG_SECRETS`); blanked by the hourly sweep once sent | `Core/notify/mailer.js:105-125`; `Core/core/onboarding/service.js:575-582` |
| CSRF gaps in the Core and SlidesVault | Origin or Referer required on writes that carry a cookie; Host-derived origin trusted only on loopback (Core) or never (Vault) | `Core/http/middleware.js:36-64`; `Vault/http/security.js:86` |
| No security headers or Host checks at the gateway | Baseline headers, HSTS on https, default CSP on HTML, Host allow-list (421), body cap (413) | `apex/server.mjs:103-178`; `apex/gateway.test.mjs` (+5 tests) |
| SlidesVault zip bomb; no file-signature check | Directory pre-check, streaming byte budget, signature check | `Vault/services/content-extraction/pptx.js:73,123`; `ContentExtractionService.js:38` |
| SlidesVault API exposed on all interfaces; writable `/app` | Loopback-only publish; root-owned code | `slide vault/docker-compose.yml:30`; `slide vault/apps/api/Dockerfile:44` |
| Insecure production configurations could start | Non-Secure cookies on a public URL, a malformed key, or a short bootstrap password are fatal in production | `Core/startupChecks.js`; `Vault/config/index.js:367` |
| Open registration by default | Off in production in all three apps | `Core/config.js:58-59`; `Showcase/config.js:114-115`; `Vault/config/index.js:135` |
| Low scrypt cost (Core, Vault) | N=2^17 with transparent rehash on login | `Core/auth/passwords.js`; `Vault/db/repositories/userRepository.js:22,75` |
| Retention and deletion gaps | Opt-in login-history purges in all apps (plus `plate_events` in Showcase); Core user deletion removes login history and outbox rows | `Core/repo/users.js:71-90`; `Showcase/services.js`; `Vault/container.js:200` |
| No backup tool | Encrypted, verified backups with retention; CI restore check; runbook | `deploy/staging/backup.mjs`; `ci.yml`; `STAGING_RUNBOOK.md` §7 |
| No SAST, DAST, secret, image or IaC scanning | Semgrep, ZAP baseline, gitleaks, and Trivy (image and config) in CI; Dependabot; `SECURITY.md` | `ci.yml`; `.gitleaks.toml`; `.semgrepignore`; `.github/dependabot.yml` |

**Local verification on 2026-11-18:**

| Suite | Result |
|---|---|
| Core API | 334 / 334 pass |
| SlidesVault | 264 / 264 pass; web build OK |
| Showcase API | 84 / 84 pass |
| Showcase shared | 3 / 3 pass |
| Showcase web | build OK, including its tests and bundle budget |
| Staging tooling | 10 / 10 pass |
| Gateway | 52 / 53 pass |

The one gateway failure (`link.test.mjs`, CSP hash) is **pre-existing**: the committed code fails it the same way on this Windows machine, because `apex/public/link.html` is checked out with CRLF line endings. It is expected to pass on Linux CI. The new CI jobs and the Docker image builds were not run locally, because drive C: is full and Docker cannot start.

## Critical Security Gaps (remaining)

1. **No TLS in front of the product yet.** Production start-up now fails closed and HSTS is ready, but a TLS-terminating proxy and Postgres TLS are needed before any non-local exposure. Both depend on hosting.
2. **No MFA**, including for `platform_admin`. It needs a design decision under the binding R1 identity contract.
3. **No scheduled or off-site backups, and no RPO or RTO.** The tool exists; a host and scheduler do not. Databases are not encrypted at rest.

## High-priority gaps (remaining)

4. **New CI scanners have not run.** Push (with authorisation), triage the first results, then make them blocking.
5. **In-memory rate limits and local revocation:** these do not hold across replicas. Fixing them needs shared infrastructure such as Redis.
6. **No assertion replay cache.** Adding one changes the identity contract, so it needs an ADR.
7. **No strict `script-src` CSP** for the app bundles.
8. **Incomplete privacy controls:** Showcase and SlidesVault have no deletion or export; no data-classification or retention policy exists.
9. **No enterprise identity-provider federation, PAM tooling or access reviews.**

## Recommended Improvements

| # | Recommendation | Priority |
|---|---|---|
| 1 | Decide hosting (DEC-010). Then add a TLS proxy (https `APEX_PUBLIC_URL`, `APEX_TRUST_PROXY`, Secure flags), Postgres `sslmode=require`, host firewall or security groups, a WAF, and volume encryption. | Critical |
| 2 | Design and build MFA (TOTP or WebAuthn) in the Core, mandatory for privileged roles. Record it in an ADR. | Critical |
| 3 | Schedule `backup.mjs` daily, copy sets off-host, keep the backup key separately, set an RPO and RTO, and run the restore drill monthly. | Critical |
| 4 | Push the branch (with authorisation). Triage the Semgrep, gitleaks, Trivy and ZAP results, then remove `continue-on-error`. Enable Dependabot, secret scanning, push protection and private vulnerability reporting in GitHub settings. Add branch protection and CODEOWNERS. | High |
| 5 | Move rate limits, lockouts and gateway revocation to a shared store before scaling out. Add an assertion `jti` replay cache through an ADR. | High |
| 6 | Add a strict CSP per app bundle, tested in each app. Pin base images and Actions by digest or SHA. | High |
| 7 | Add user deletion and export to Showcase and SlidesVault. Define data classification and retention, then set the opt-in retention variables. | High |
| 8 | Retire the legacy Academia admin model; make empty row-level rules deny; add an idle session timeout; strengthen the password policy. | Medium |
| 9 | Commission a penetration test before the R6 pilot. Add an authenticated ZAP scan. Remove `legacy/nextjs-app`. | Medium |

## Information Requiring Confirmation

| Topic | Owner |
|---|---|
| Business criticality rating | Business owner / Security |
| Hosting and cloud provider, and production OS, compute and storage (DEC-010) | Infrastructure / Founder |
| Firewall, WAF, IDS/IPS, VPN or bastion for future hosts | Infrastructure / Security |
| Disk and volume encryption on the development machine and future hosts | Infrastructure / IT |
| Backup schedule, off-site location, RPO and RTO | DevOps / Business owner |
| GitHub settings: visibility, branch protection, required reviews, secret scanning, push protection, Dependabot, private vulnerability reporting | DevOps / Repository owner |
| Authorisation to push this branch so the new CI jobs run | Founder |
| Data classification scheme and retention periods (to set the new retention variables) | Data Protection / Security |
| Applicable privacy law and the approved consent notice | Legal / DPO |
| ISO 27001, NIST CSF or CIS programme status | Security / Compliance |
| Costs for any paid tooling chosen later (WAF, CSPM, GitHub Advanced Security) | Security / Finance |
| Whether the uncommitted onboarding module is in release scope | Product owner |
