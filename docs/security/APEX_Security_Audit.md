# APEX — Security Audit

| | |
|---|---|
| **Product** | APEX (Inspironics APEX platform) |
| **Audit date** | 2026-11-17 |
| **Repository** | `github.com/SiddharthS-Dev/apex-integration` |
| **Branch / commit** | `Feature-base-removal` @ `2aee3b0`, plus uncommitted working-tree changes (the onboarding module, `onboarding/`, CI edits) |
| **Method** | Read-only inspection of source, configuration, Dockerfiles, Compose files, CI workflow, dependency manifests and project documentation. No code or configuration was changed. No database was opened. No secret values are reproduced here. |
| **Evidence convention** | Paths are relative to the repository root. `Core` = `Inspironics Academia/apps/api/src`, `Showcase` = `inspironics-innovation-showcase/apps/api/src`, `Vault` = `slide vault/apps/api/src`. |

**Status legend:** *Implemented* means evidence was found in the repository and it covers the control. *Partially Implemented* means evidence was found but there are gaps. *Not Implemented* means the control was searched for and is absent. *Not Verified* means the control would live outside the repository, so infrastructure, DevOps or Security must confirm it.

**Scope.** APEX is one product made of five deployable parts:

| Component | Path | Role |
|---|---|---|
| APEX gateway | `apex/` | Single sign-on front door and reverse proxy. Signs identity assertions. |
| APEX Core / Inspironics Academia | `Inspironics Academia/` | Identity, roles and organisations for all apps (ADR 0001), plus the Academia learning app |
| Innovation Showcase | `inspironics-innovation-showcase/` | Innovation gallery synced from Dropbox |
| SlidesVault | `slide vault/` | Presentation library synced from Dropbox |
| Enterprise Onboarding app | `onboarding/` + `Core/core/onboarding/` | Use Case 007 stakeholder registration. **Uncommitted, local only.** |

`inspironics-innovation-showcase/legacy/nextjs-app` is retired code. It is not built, not in any image and not a workspace. It was reviewed only for latent risk.

---

# SECTION 1: PROJECT INFORMATION

## 1. Project Overview

| Item | Finding | Evidence |
|---|---|---|
| Official Project Name | **APEX** (the "Inspironics home dashboard"): one address and one sign-in for Innovation Showcase, SlidesVault and Inspironics Academia | `README.md:1-14`, `AGENTS.md` |
| Project Description | A gateway in front of three web apps, with APEX Core acting as identity provider. **Core / Academia:** engineering academy with AI-generated courses, quizzes, certificates and an AI content and video studio. **Showcase:** innovation material synced from Dropbox, with AI categorisation and analytics. **SlidesVault:** Dropbox-backed presentation library with an AI Copilot. | `README.md`, `docs/architecture/APEX_FULL_AUDIT_REPORT.md` §B, `docs/APEX_MASTER_PLAN.md` |
| Project Status | **Development.** Phase R1 (identity, roles, gateway security, private staging readiness) is "implemented and externally verified; exit gate NOT passed". R2–R6 have not started. Private staging is verified in CI only and is **not deployed**. There is no production environment. | `docs/implementation/APEX_IMPLEMENTATION_STATUS.md`, `docs/operations/STAGING_RUNBOOK.md` §9 |
| Business Criticality | **Not stated in the repository. Confirmation required from the business owner.** Assessor's indicative view: **High**, because the Core is the identity and authorisation authority for every app and stores personal data of employees and, per the plan, students and external users. | — |
| Project Users | **Current:** Inspironics employees and administrators (`R0_DISCOVERY_REPORT.md` discrepancy D4). **Planned:** students, learners, mentors, interns, alumni, assessors and external organisation users. These roles are modelled but external organisations are switched off (`CORE_EXTERNAL_ORGS_ENABLED=false`). Public registration is held in R1. | `Core/core/identity.js:7-19`, `deploy/staging/compose.yml:85-90` |

## 2. Application Architecture

| Item | Finding | Evidence |
|---|---|---|
| Application Type | **Web**: single-page apps plus REST APIs. SlidesVault's web app is a PWA. No mobile, desktop or IoT client. | `*/apps/web`, `*/apps/api` |
| Frontend Technology | React 18, Vite 5 and react-router 7 in all three apps. Academia adds Tailwind and Radix. Showcase adds three.js and jsPDF. The gateway's own login and dashboard pages are static HTML. | `*/apps/web/package.json`, `apex/public/` |
| Backend Technology | Node.js ≥ 22.5. The APIs use Express 4.21. The gateway uses only Node's built-in `http`, with no dependencies (`apex/package.json`). Data access uses built-in `node:sqlite` or `pg`. Container bases: `node:22-bookworm-slim` (gateway, Core), `node:22-alpine` (Showcase), `node:24-alpine` (SlidesVault). | `apex/package.json:6`, `*/apps/api/package.json`, Dockerfiles |
| Architecture Type | **Modular monoliths behind a gateway.** There are three independent monolithic API services plus one gateway, each with its own database. It is not serverless, and not microservices in the fine-grained sense. | `deploy/staging/compose.yml`, `README.md` |
| API Type | **REST** (JSON over HTTP). No GraphQL, SOAP or MQTT found. | `Core/app.js`, `Showcase/app.js`, `Vault/app.js` |
| Authentication Mechanism | **Custom. Not JWT, and not OAuth 2.0 for user sign-in.** The parts are listed below. | See below |
| Authorization Mechanism | **Custom RBAC** with organisation scoping and row-level rules. Core `can()` ends in `default: return false` (`Core/core/identity.js:94-120`). Apps map assertion roles to admin or member per request. | `Core/core/identity.js`, `packages/shared/src/rls.js` |

The authentication parts are:

- **Gateway session:** an HMAC-SHA256-signed `apex_session` cookie (`apex/auth.mjs:60-113`) with a persisted revocation list.
- **App sessions:** opaque 32-byte random tokens. Only their SHA-256 is stored. Core: `Core/auth/sessions.js:9-18`. Showcase: `Showcase/repos/auth.js:113-135`. Vault: `Vault/db/repositories/userRepository.js:65,239`.
- **Passwords:** scrypt.
- **Gateway to apps:** HMAC-SHA256 identity assertions (`X-Apex-Identity`, `X-Apex-Service`) with a 60 s lifetime (ADR 0002, `docs/operations/IDENTITY_ASSERTION.md`).
- **Optional Google sign-in:** a Google ID token checked against Google's tokeninfo endpoint.

## 3. Database Security

| Item | Finding | Evidence |
|---|---|---|
| Database Type | **SQLite** through built-in `node:sqlite` (development and local default: `academy.db`, `app.db`, `slidesvault.db`). **PostgreSQL 16** in staging and CI. | `Core/db/index.js:9-19`, `Showcase/config.js:94-97`, `Vault/db/sqliteDriver.js`, `deploy/staging/compose.yml:36` |
| Database Hosting | **Development:** SQLite files on the developer's Windows machine. **Staging:** a self-managed `postgres:16` container on an internal Docker network, which exists only in CI runs. **Production:** none, and no hosting has been chosen (DEC-010 open). No managed or cloud database. | `STAGING_RUNBOOK.md` §9 |
| Database Access | **Restricted in staging.** Postgres is on the `backend` network with `internal: true`, so it has no route out and no published port. There is one login role and one database per app. Each database is owned by its own role, with `REVOKE ALL ... FROM PUBLIC`. **Gap:** `slide vault/docker-compose.yml` has an empty fallback for `POSTGRES_PASSWORD`; the image refuses to start without one. | `deploy/staging/compose.yml:259-270`, `deploy/staging/postgres/init-databases.sh` |
| Database Encryption at Rest | **Not implemented at database level.** Only OAuth refresh tokens are encrypted, with AES-256-GCM: Dropbox in all apps (`Core/lib/crypto.js`, `Showcase/lib/crypto.js:47-62`, `Vault/crypto/tokenCipher.js`). Disk or volume encryption is not verified. Postgres client TLS is not configured in any driver (`Showcase/db/postgres.js:33`, `Vault/db/postgresDriver.js`). | — |
| Database Backup Frequency and Retention | **Not defined. Manual only.** The staging runbook documents `pg_dump` per database, archiving of volumes, a restore drill into a scratch database, and a single-database restore. There is no schedule, no retention period, no automation, and none for local SQLite. The runbook states: "No automated backups or monitoring. §7 is manual." | `docs/operations/STAGING_RUNBOOK.md` §7, §9 |

Safeguards that are in place:

- **Openers refuse the real data folder under tests:** the database openers refuse the default `data/` directory when running under the test runner.
- **CLIs need an explicit flag:** the migrate, rollback and grant-admin CLIs require `--allow-default-db` (`Core/db/safety.js:82-106`, `Showcase/db/safety.js:30-45`, `Vault/db/safety.js`).
- **Migrations are tested on both engines:** they run on SQLite and Postgres, and CI rehearses migrate twice, rollback, then migrate again (`.github/workflows/ci.yml:145-205`).
- **Gap:** the Showcase server migrates on every start (`Showcase/services.js:40`) without the CLI's default-database refusal.

## 4. Cloud & Infrastructure

| Item | Finding | Evidence |
|---|---|---|
| Cloud Provider | **None. No hosting is selected** (DEC-010 open; "No real deployment, registry push or hosting choice"). No AWS, Azure or GCP configuration exists in the repository. **Confirmation required** from Infrastructure when a provider is chosen. | `STAGING_RUNBOOK.md` §9 |
| Compute Services | **Docker:** four images (gateway, Core, Showcase API, SlidesVault API) orchestrated with Docker Compose. No Kubernetes, VM templates or serverless functions. **Development:** Node processes started by `start.bat` on a Windows workstation. | `deploy/gateway/Dockerfile`, `*/apps/api/Dockerfile`, `deploy/staging/compose.yml`, `start.bat` |
| Operating System | **Containers:** Debian bookworm-slim (gateway, Core) and Alpine (Showcase, SlidesVault). **Development host:** Windows 11. **Production OS:** not applicable or not verified. | Dockerfiles |
| Deployment Environment | **Development** (local). **Staging** (private, ephemeral in CI, published only on `127.0.0.1`). **No production.** | `deploy/staging/compose.yml:1-2`, `ci.yml:207-240` |
| Storage Services | Local disk and Docker volumes: content-addressed object stores at `OBJECT_STORE_DIR` (SHA-256 keys), Core media in the `core-data` volume, gateway state in `gateway-state`. Dropbox is the external **source** of content for all three apps. No S3 or Blob storage. | `Showcase/storage/objectStore.js:14-19`, `Vault/services/storage/ObjectStore.js:39-56`, `Core/files/objectStore.js` |
| Secrets Management Solution | **Environment variables** with no secrets vault. `.env` files are gitignored and dockerignored (`.gitignore:42-44`, `.dockerignore:11-13`). `deploy/staging/generate-secrets.mjs` writes random secrets to a gitignored `.env.staging`. The gateway session secret and identity keys are files created with mode 0600, on a volume directory with mode 0700 (`apex/auth.mjs:60-85`, `deploy/gateway/Dockerfile:85`). No Docker secrets, HashiCorp Vault or cloud KMS. | — |

## 5. Network Security

| Item | Finding | Evidence |
|---|---|---|
| Network Architecture | Browser → APEX gateway (single port) → three APIs, plus static web bundles served by the gateway. Staging has an `edge` network (gateway only) and an internal `backend` network (Postgres, Core, Showcase, SlidesVault, and the gateway at a fixed IP). | `deploy/staging/compose.yml:11-16,259-270` |
| Network Segmentation | **Partially implemented, in staging only.** The `backend` network is `internal: true`, with no egress and no ingress. Apps accept identity assertions only from the gateway's fixed IP (`APEX_IDENTITY_TRUSTED_SOURCES`). CI runs a "direct backend bypass" test from a container on the backend network (`ci.yml:226-232`). **Gap:** `slide vault/docker-compose.yml:25-26` publishes the API on **all host interfaces** (`${PORT:-4000}:4000`) with identity assertion unset, so its mode is `off`. | — |
| Firewall Implementation | **Not found in the repository.** No host firewall, security group or ACL configuration. Development binds to loopback. **Confirmation required** from Infrastructure. | `projects.mjs:21` |
| Open Ports and Protocols | See the table below. All are **plain HTTP**. | `start.bat:11-26`, `apex/projects.mjs`, compose files |
| Internet Exposure | **None today.** The development gateway binds to `127.0.0.1` and `::1`, and staging publishes only `127.0.0.1:4173`. The gateway image sets `APEX_HOST=0.0.0.0` inside the container, so exposure depends on how a future host publishes it. | `apex/server.mjs:970-977`, `deploy/gateway/Dockerfile:69` |
| VPN / SSH / RDP / Bastion Access | **None found.** No VPN, bastion or SSH configuration in the repository. **Confirmation required** for any future host. | — |
| Web Application Firewall (WAF) | **Not implemented.** | — |
| IDS / IPS Availability | **Not implemented** (none found). | — |

Ports in use:

| Port | Service | Bound to |
|---|---|---|
| 5173 (development) / 4173 (production) | APEX gateway | `127.0.0.1` by default; `0.0.0.0` in the container |
| 4175 / 4176 / 4177 | SlidesVault / Showcase / Core APIs | `127.0.0.1` in development; internal network in staging |
| 5174–5176 | Vite development servers | loopback, development only |
| 5180 | Onboarding app (uncommitted) | `127.0.0.1` by default (`onboarding/server.mjs:46`) |
| 4000 | SlidesVault standalone compose | **all host interfaces** |
| 5432 | Postgres | CI service only |

## 6. Identity & Access Management

| Item | Finding | Evidence |
|---|---|---|
| User Roles | See the role list below. | — |
| Role-Based Permissions | Core `can()` is default-deny (`identity.js:94-120`). Organisation management is limited to platform admins or the admin of that organisation (`:105`). Nobody can grant or revoke their own `platform_admin` (`:112`). Showcase uses `requireAuth`, `requireAdmin` and `requireMember` (`Showcase/middleware/auth.js:65-81`). Vault uses `requireAuth` and `requireAdmin` (`Vault/http/auth.js:106-127`). Both apps protect the last admin. See the gaps below. | — |
| Multi-Factor Authentication (MFA) | **Not implemented** in any component (searched; not found). | — |
| Single Sign-On (SSO) | **Partial.** The APEX gateway is the single sign-on for the three apps: one `/login`, then a signed `X-Apex-Identity` assertion on each request. `required` mode turns off app-local sign-in. Optional Google sign-in links only to an existing Core user by (provider, subject), never by email (`Core/core/google.js:126-161`). No SAML or OIDC federation with a corporate identity provider (Entra ID, Okta). | `apex/server.mjs:861-871`, ADR 0002/0003 |
| Service Accounts | Gateway → Core: an `X-Apex-Service` HMAC credential, audience `core`, accepted only from trusted source IPs (`Core/core/service.js:5-29,85-109`). One Postgres login role per app. A bootstrap admin is created from `BOOTSTRAP_ADMIN_*` environment variables. Keys are scoped per audience: each app holds only its own key, and only the gateway holds the full store (`compose.yml:17-19`). | — |
| Privileged Access Management | Break-glass `core/cli/grant-admin.js` (`--email --reason`) writes an audit row with `granted_via='cli'` and refuses the live database without `--allow-default-db` (`Core/core/roles.js:260-282`). Platform admin is required to approve onboarding registrations, with `confirm:true` and a role allow-list (`Core/core/onboarding/admin.js`). There is no PAM tool, just-in-time elevation or session recording. | — |
| Session Management and Timeout | See the session details below. | — |

**Roles.**

- **Core roles:** `platform_admin`, `org_admin`, `staff`, `assessor`, `app_admin` (scoped to `showcase` or `slidesvault`), `learner`, `mentor`, `student`, `intern`, `alumni` (`Core/core/identity.js:7-19`).
- **Legacy Academia role** `users.role`: `admin` or `user`.
- **Showcase:** `admin`, `viewer`, `guest` (`inspironics-innovation-showcase/packages/shared/src/roles.js:5-9`).
- **SlidesVault:** `admin`, `user` (`Vault/http/auth.js:12`).

**Permission gaps.**

- **Two admin models in Academia.** Most Academia admin routes check the legacy `users.role === 'admin'` (`Core/auth/sessions.js:69-73`), and it is kept in sync with Core only through `setLegacyRole` (`Core/core/roles.js:236-257`).
- **Latent default-allow in row-level rules.** An empty or missing rule allows access (`Inspironics Academia/packages/shared/src/rls.js:25`). It is verified in code; today every entity defines its rules.
- **Per-route gates in `off`/`optional` mode.** In those modes, Showcase and SlidesVault authorisation depends on each route attaching a gate. There is no global gate.

**Session details.**

- **Absolute lifetime:** 12 h everywhere (`APEX_SESSION_HOURS`, `SESSION_TTL_HOURS`). No idle timeout and no session rotation were found.
- **Cookies:** HttpOnly and `SameSite=Lax`. `Secure` is set only when the public URL is https or production is set (`apex/auth.mjs:50-51,340`, `Core/auth/sessions.js:12-14`, `Showcase/middleware/auth.js:13-21`, `Vault/http/auth.js:130-138`).
- **Logout and revocation:** logout deletes the server-side session. A password change or reset, or disabling a user, destroys all of that user's sessions and bumps `user_session_epochs`, which also revokes gateway sessions (`Core/auth/sessions.js:32-40`). The gateway keeps a revocation file (`apex/auth.mjs:419-458`), which is local to one instance.

## 7. Data Security

| Item | Finding | Evidence |
|---|---|---|
| Data Classification | **No formal data-classification scheme found** in code or documents. **Confirmation required** from Security or Data Protection. Assessor's suggestion: personal and credential data is *Confidential*. Course and innovation content is *Internal*. Certificate verification output is *Public*. | — |
| Sensitive Data Handled | See the field list below. | `Core/db/migrations.js`, `Showcase/db/migrations.js:12-160`, `Vault/db/repositories/userRepository.js:286-291` |
| Data Encryption at Rest | **Partial:** OAuth refresh tokens only (AES-256-GCM). Database files and object stores are plaintext. | §3 |
| Data Encryption in Transit | **Inbound: not implemented.** Every component serves plain HTTP. TLS must come from a reverse proxy that does not yet exist. Shipped staging sets `COOKIE_SECURE=false` and `SESSION_COOKIE_SECURE=false` (`compose.yml:78,143,190`). HSTS is emitted by the APIs in production only. The gateway sends no HSTS. **Outbound:** HTTPS to Dropbox, Google, Anthropic, Gemini and the email providers. **Database:** no Postgres TLS. The Showcase API refuses to start in production with a non-https public URL and non-Secure cookies on a non-local host (`Showcase/config.js:209-229`). | `apex/server.mjs:801` |
| Key Management | Identity-assertion keys use a `{kid: base64}` store with current and previous keys, at least 32 bytes each, rotated with `node apex/identity-keys.mjs rotate`. Each service gets only its own audience's keys, and keys are read at start-up. A runbook covers rotation and pruning (`STAGING_RUNBOOK.md` §6). Token-encryption keys must be 32 bytes. A missing or malformed key is fatal at start-up in SlidesVault and Showcase. Keys are stored in environment variables or files, not in a KMS or HSM. | `docs/operations/IDENTITY_ASSERTION.md` |
| Data Retention Period | **SlidesVault:** sync logs 90 days, audit 365 days (`Vault/container.js:192-198`). **Expired sessions:** purged hourly in all apps. **Cached objects:** expire by TTL (SlidesVault 14 days). **Onboarding:** `ONBOARDING_RETENTION_DAYS` is unset by default, so records are kept. **No retention** for `login_history` (all apps), Core `audit_events`, `email_outbox`, or Showcase `plate_events`. **Business retention policy not defined:** confirmation required. | — |
| Secure Data Deletion | **Core:** an admin can hard-delete a user, which also deletes sessions and cascades Core rows (`Core/repo/users.js:72`), but `login_history` and `email_outbox` rows survive. **Showcase and SlidesVault:** no user-delete or export endpoint. Admins can only disable an account or change its role. No secure wipe of files or volumes. No data-subject export. | — |

**Sensitive data stored.**

- **Personal data:** `users.email`, `full_name`, `avatar_url`, `last_login_at`. Session IP address and user agent. `login_history` (email, IP, user agent). `audit_events.ip`.
- **Onboarding applicants:** `registration_requests` stores email, name, claimed organisation, interests, preferences, consent records, adult confirmation, and decision notes.
- **Credentials:** scrypt password hashes, SHA-256 hashes of session and reset tokens, and encrypted Dropbox refresh tokens.
- **Business content:** courses, playbooks, innovation material and presentations synced from Dropbox. Some of it is sent to AI providers when AI is enabled.
- **Usage analytics:** per-user view events.
- **Financial data:** none found.

## 8. API & Integration Security

| Item | Finding | Evidence |
|---|---|---|
| External API Integrations | See the integrations table below. **Webhooks:** none. | `FINAL_PRODUCTION_READINESS_REPORT.md`; `compose.yml` disables all of them in staging |
| API Authentication | Session cookie per app. In identity mode, the gateway's HMAC assertion is verified: constant-time compare, `iss=apex-gateway`, fixed audience, lifetime ≤ 120 s, iat skew ≤ 30 s, and the TCP peer must be in the trusted sources, never `X-Forwarded-For` (`Showcase/lib/apexIdentity.js:110-167`, `Vault/http/apexIdentity.js`). The gateway **strips client-supplied** `X-Apex-Identity`, `X-Apex-Service`, `Forwarded` and `X-Forwarded-*` headers on every request and upgrade, then rebuilds them (`apex/server.mjs:238-272,802,900`). **Gap:** no replay cache (no jti or nonce). Assertions are reusable within their lifetime from a trusted source. | — |
| API Authorization | Per-route `requireAuth` and `requireAdmin` gates. Core default-deny `can()`. In `required` mode, Showcase answers 401 for every non-public path (`Showcase/middleware/auth.js:44-50`). Unknown API routes return 404. Media in Core (`/media/:key`) is available to any signed-in user and protected only by an unguessable content hash (`Core/files/routes.js:78-82`). | — |
| API Rate Limiting and Throttling | See the rate-limit details below. | — |
| Third-Party Dependencies | See the dependency notes below. | `*/package.json`, `*/package-lock.json` |

**External integrations.**

| Service | Used by | Purpose |
|---|---|---|
| Dropbox API | all apps | OAuth, content sync, video output |
| Google | gateway, Core; also Showcase and Vault in legacy mode | ID-token sign-in through tokeninfo |
| Anthropic API | Showcase, SlidesVault | classification, titles, Copilot |
| Google Gemini, Ollama | Core | AI course and studio content |
| Google TTS, ElevenLabs, Piper | Core | voice |
| Email: Resend, SMTP (nodemailer), EmailJS REST | Core | account and onboarding mail, through an outbox with retry (`Core/notify/mailer.js`, `Core/notify/outbox.js`) |
| Optional browser error endpoint | Showcase web | `VITE_ERROR_ENDPOINT` |

**Rate limiting and throttling.** All limiters are in memory and per process, with no shared store, so they reset on restart and are not shared across replicas.

- **Gateway:** failed sign-ins only, 10 per 15 min per IP (`apex/auth.mjs:469-486`). Sign-in body capped at 8 KB. No general limiter, and proxied bodies are not size-capped at the gateway.
- **Core:**
  - Login: 10 per 15 min per IP+email.
  - Register, reset and change-password: 5 per 15 min.
  - Google sign-in: 30 per 15 min.
  - Onboarding: per IP and per email (`Core/http/rateLimit.js`, `Core/auth/routes.js:23-24`, `Core/core/onboarding/routes.js:21-24`).
  - Lockout after 10 failures (`Core/auth/lockout.js`).
- **Showcase:**
  - Whole API: 1200 per min per IP.
  - Auth routes: 30 per 15 min.
  - AI: 30 per min.
  - Per-email lockout (`Showcase/app.js:32`, `Showcase/routes/auth.js:42-85`).
- **SlidesVault:**
  - General: 300 per min.
  - Admin: 120 per min.
  - Login: 10 per 15 min.
  - Copilot: 10 per min per user (`Vault/http/rateLimit.js`, `Vault/config/index.js:190,221-225`).
- **JSON body limits:** Core 5 MB, Showcase 256 KB, SlidesVault 256 KB.

**Third-party dependencies.**

- **Gateway:** none; it uses Node built-ins only.
- **APIs:** Express 4.21, cookie-parser, jszip, pg, nodemailer, `@anthropic-ai/sdk`, ffmpeg-static, `@resvg/resvg-js`, and `pdf-parse 1.1.1`, an old pinned version in Core.
- **Web apps:** React 18, react-router 7, react-markdown 9, jsPDF 4, three.js.
- **Hand-written controls:** no helmet, CORS library or validation library. Security headers, CORS, rate limiting and validation are hand-written.
- **Lockfiles:** committed for each app.

## 9. DevSecOps & Compliance

| Item | Finding | Evidence |
|---|---|---|
| Source Code Repository | GitHub: `github.com/SiddharthS-Dev/apex-integration` (`git remote -v`). Branch protection, required reviews and CODEOWNERS are **not verified**: no CODEOWNERS file exists, and branch settings live outside the repository. | — |
| CI/CD Pipeline | **GitHub Actions** `.github/workflows/ci.yml` runs on push to `main` and `Feature-**` branches and on pull requests. The `inspironics-innovation-showcase/.github/workflows/ci.yml` file never runs, because GitHub only runs root workflows (noted at `ci.yml:3-5`). **No CD:** nothing deploys. | See the job list below |
| SAST Implementation | **Not implemented.** No CodeQL, Semgrep, ESLint security rules or SonarQube found. | — |
| DAST Implementation | **Not implemented.** No OWASP ZAP, Burp or other scanner. The closest control is the staging smoke test (`deploy/staging/smoke.mjs`): it tests sign-in, assertions, **forged identity headers**, sign-out and direct backend bypass, with 12 of 12 bypasses refused. This is a scripted security regression test, not DAST. | `ci.yml:224-232` |
| Software Composition Analysis (SCA) | **Partial.** `npm audit --omit=dev --audit-level=high` runs in CI for Academia, Showcase and SlidesVault (`ci.yml:58-59,89-90,108-109`). Development dependencies are not audited. No Dependabot, Renovate, Snyk or SBOM. The gateway has no dependencies. | — |
| Container Security | **Hardening present; scanning absent.** All images run as `USER node` and use multi-stage builds with `npm ci --omit=dev`. The gateway code is root-owned and read-only to the process. **Gap:** SlidesVault `chown`s `/app` to the `node` user, so the process can rewrite its own code (`slide vault/apps/api/Dockerfile:41,46`). Staging Compose adds `read_only: true`, `cap_drop: [ALL]`, `no-new-privileges` and tmpfs `/tmp` (`compose.yml:26-33`). Base images are pinned by tag, not digest. No image scanning (Trivy, Grype, Docker Scout). | — |
| Infrastructure as Code (IaC) Security | IaC is limited to Dockerfiles and Compose files; there is no Terraform, Kubernetes or CloudFormation. A compose consistency test exists (`deploy/staging/staging.test.mjs`). **No IaC scanning** (Checkov, tfsec, KICS). | — |
| Deployment Process | **Manual, and not performed.** The staging stack is started by hand following the runbook, and in CI only as an ephemeral test. Deploying, pushing or publishing requires founder authorisation (`AGENTS.md`). | — |
| Security Code Review Process | Rules are documented in `AGENTS.md`: binding identity contract, ADRs 0002–0004, default deny, no account merge by email, a migration and rollback for every schema change. Internal audit reports exist: `docs/architecture/APEX_FULL_AUDIT_REPORT.md` (26 issues, findings F-001 to F-026) and `FINAL_PRODUCTION_READINESS_REPORT.md`. **No enforced review gate** (CODEOWNERS or required reviewers) was verified. | — |
| ISO 27001 Applicability | **Applicable** as a framework for an identity provider holding personal data. No certification or ISMS evidence in the repository. **Confirmation required.** | — |
| NIST CSF Applicability | **Applicable** as a reference framework. No mapping exists in the repository. | — |
| CIS Controls Applicability | **Applicable**, especially Controls 3 (data protection), 4 (secure configuration), 5 and 6 (account and access management), 7 (vulnerability management), 11 (data recovery) and 16 (application security). No benchmark evidence. | — |
| OWASP Top 10 Applicability | **Directly applicable** to all three web apps and the gateway. Several items are addressed in code: A01 access control, A02 crypto (scrypt, AES-GCM), A03 injection (parameterised `?` placeholders throughout), A07 authentication. Gaps remain under A01, A02, A05, A07 and A08 (see §Summary). | — |
| GDPR / Privacy Requirements Applicability | **Applicable.** The product stores names, emails, IP addresses and login history. Onboarding records consent (`consent_*`) and adult confirmation, and it is switched off in production without an approved consent notice (`Core/core/onboarding/config.js:114-125`). The applicable jurisdiction (GDPR, India DPDP Act or other) **needs confirmation from Legal**. Gaps: no data-subject export, incomplete deletion, and no retention policy for login history. | — |

**CI jobs.**

- `gateway`: syntax check and unit tests.
- `academia`, `showcase`, `slidesvault`: tests, builds, and `npm audit`.
- `slidesvault-image`: Docker build.
- `postgres`: SlidesVault migrations. Marked `continue-on-error`.
- `core-postgres`: Core and Showcase migrations on Postgres 16, plus the identity rollback drill.
- `staging-smoke`: builds the four images, starts the stack with throwaway secrets, runs the smoke test through the gateway, runs the direct-bypass test, then tears down.
- Actions are pinned to major tags (`@v4`), not commit SHAs.

---

# SECTION 2: SECURITY TOOLS & IMPLEMENTATIONS

The Estimated Cost column says **Not Available** wherever the repository gives no cost. No costs have been invented. Free/Paid describes the tool that is in use today; where nothing is in use it is *Not Applicable*.

## 2.1 Network Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Network | Firewall | None found in repository | Yes | Not Verified | Not Applicable | Not Available | High | No host firewall, security group or ACL configuration. Development binds to loopback (`apex/projects.mjs:21`) and staging publishes only on `127.0.0.1` (`compose.yml:246-247`). Those are bind settings, not a firewall. **Confirm with Infrastructure** before any hosted deployment. |
| Network | Web Application Firewall (WAF) | None | Yes | Not Implemented | Not Applicable | Not Available | High | No WAF or edge protection in front of the gateway. Recommended once public hosting is chosen (DEC-010), for example a cloud WAF or an OWASP CRS-based proxy. |
| Network | IDS / IPS | None | Yes | Not Implemented | Not Applicable | Not Available | Medium | None in the repository. Depends on the hosting choice. **Confirm with Infrastructure or Security.** |
| Network | VPN | None | Yes (for administrative access to hosts) | Not Implemented | Not Applicable | Not Available | Medium | No VPN, bastion, SSH or RDP configuration exists, because there is no hosted environment. Administrative and database access paths for a future host must be defined. |
| Network | Network Segmentation | Docker Compose networks (`edge` / internal `backend`); per-app Postgres roles and databases | Yes | Partially Implemented | Open Source | Not Available | High | **Implemented in staging:** `backend` is `internal: true`; the gateway sits at a fixed IP, and apps trust assertions only from it; the bypass test runs in CI (`compose.yml:259-270`, `ci.yml:226-232`). **Gaps:** `slide vault/docker-compose.yml` publishes port 4000 on all interfaces with identity `off` and open self-registration. Segmentation for production has not been designed. |

## 2.2 Identity Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Identity | Identity and Access Management (IAM) | APEX Core (custom): users, organisations, memberships, role assignments, identity links, audit events | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | **Strengths:** default-deny `can()`; organisation scoping; no self-grant of platform admin; no email-based account merging (ADR 0003, `Core/core/google.js:161`); scrypt hashing; hashed session tokens; revocation through session epochs; append-only audit. R1 has been externally verified. **Gaps:** the R1 exit gate is open (Use Case 004: existing accounts not linked); Academia has two admin models (legacy `users.role` and Core roles); the row-level rule allows when empty (`rls.js:25`); open registration defaults to on in Core (`ALLOW_REGISTRATION=true`, `config.js:241`) and in Showcase and SlidesVault; the password policy is length-only, at least 8 characters; SlidesVault and Core use scrypt N=2^14. |
| Identity | Multi-Factor Authentication (MFA) | None | Yes | Not Implemented | Not Applicable | Not Available | **Critical** | No TOTP, WebAuthn or email OTP for sign-in in any component. The highest priority is MFA for `platform_admin`, `org_admin` and `app_admin`, because the Core authorises every app. |
| Identity | Single Sign-On (SSO) | APEX gateway (custom HMAC session + `X-Apex-Identity` assertions); optional Google Sign-In | Yes | Partially Implemented | Not Applicable (in-house); Google Sign-In Free | Not Available | Medium | One sign-in for all apps works and is tested (`apex/*.test.mjs`, staging smoke). **Gaps:** identity mode defaults to `off` (`README.md` settings table; `Vault/config/index.js:240-254`), so apps keep their own sign-ins unless it is set to `required`. The gateway fans the password out to every app's login (`apex/auth.mjs:278-286`). There is no assertion replay cache, and no enterprise identity-provider federation (SAML or OIDC). |
| Identity | Privileged Access Management (PAM) | `grant-admin` break-glass CLI with audit; platform-admin approval flow for onboarding | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | **In place:** a CLI grant requires `--reason` and writes an audit row, and it refuses the live database without a flag (`Core/core/roles.js:260-282`, `Core/db/safety.js:82-106`). **Missing:** a PAM tool, just-in-time elevation, MFA on privileged roles, and periodic access review. Academia admin invite returns a temporary password in the API response (`Core/auth/routes.js:168`). |

## 2.3 Data Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Data | Encryption at Rest | Node `crypto` AES-256-GCM for OAuth refresh tokens only | Yes | Partially Implemented | Open Source | Not Available | High | Tokens: `Core/lib/crypto.js`, `Showcase/lib/crypto.js:47-62` (with AAD), `Vault/crypto/tokenCipher.js`. Database files, Postgres volumes and object stores are **not encrypted**. Volume or disk encryption is not verified and must be confirmed with Infrastructure. |
| Data | Encryption in Transit | None for inbound traffic; HTTPS for outbound API calls | Yes | Partially Implemented | Not Applicable | Not Available | **Critical** | Every server is plain `http` (`apex/server.mjs:801`), and TLS is expected from a reverse proxy that does not yet exist. Staging sets `Secure`-cookie flags to false (`compose.yml:78,143,190`). The gateway has no HSTS. The Postgres drivers set no TLS. Outbound calls to Dropbox, Google, Anthropic and the email providers use HTTPS. The Showcase API refuses a non-https public URL in production. **Required before any non-local deployment:** a TLS-terminating proxy, an https `APEX_PUBLIC_URL`, `APEX_TRUST_PROXY`, and Secure flags set to true (`STAGING_RUNBOOK.md` §9). |
| Data | Key Management | File- or env-based key store with `kid` rotation (`apex/identity-keys.mjs`); per-audience key distribution | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | Medium | **Strengths:** keys of at least 32 bytes are enforced, current and previous keys are supported for rotation, each app receives only its own key, and a rotation runbook exists (`docs/operations/IDENTITY_ASSERTION.md`, `STAGING_RUNBOOK.md` §6). **Gaps:** no KMS or HSM; keys sit in environment variables or files; the gateway revocation list is local to one instance; there is no documented rotation schedule for `TOKEN_ENCRYPTION_KEY` or `ENCRYPTION_KEY`. |
| Data | Secrets Management | Environment variables and gitignored `.env` files; `deploy/staging/generate-secrets.mjs`; gateway secret files with 0600/0700 permissions | Yes | Partially Implemented | Open Source | Not Available | High | **Verified:** no real `.env`, key or database file is tracked in git, and a pattern scan for API-key and private-key formats found only a fake key inside a redaction test. Compose refuses to start without required secrets (`${VAR:?}`). Logs redact credential-shaped keys. **Gaps:** no secrets vault and no Docker secrets. Core has no central start-up refusal of weak or default secrets, and the bootstrap admin password only needs 8 characters. Reset and invite links are kept **in plaintext** in `email_outbox.text_body`, and with `EMAIL_PROVIDER=log` (allowed in production) they are written to stdout. Only onboarding mail kinds are withheld (`Core/notify/mailer.js:105-117`). |

## 2.4 Application Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Application | Web Application Firewall | None | Yes | Not Implemented | Not Applicable | Not Available | High | Same gap as the Network WAF row; listed again because the Security Team's template asks for it in both places. The application-level substitutes are origin checks, rate limits and body limits. |
| Application | Static Application Security Testing (SAST) | None | Yes | Not Implemented | Not Applicable | Not Available | High | No CodeQL, Semgrep or security lint in CI. Showcase's `lint:arch` and `typecheck` are quality checks, not SAST. The internal audit reports are manual reviews. CodeQL is free for public repositories; it needs GitHub Advanced Security on private ones. **Confirm the repository's visibility and licence.** |
| Application | Dynamic Application Security Testing (DAST) | None (scripted smoke and bypass tests only) | Yes | Not Implemented | Not Applicable | Not Available | Medium | `deploy/staging/smoke.mjs` tests forged headers, the backend bypass and sign-out in CI. That is valuable, but it is not a DAST scan. Recommended: an OWASP ZAP baseline scan against the ephemeral staging stack in the `staging-smoke` job. |
| Application | Software Composition Analysis (SCA) | `npm audit --omit=dev --audit-level=high` in CI | Yes | Partially Implemented | Free | Not Available | High | Runs for Academia, Showcase and SlidesVault (`ci.yml:58-59,89-90,108-109`). **Gaps:** development and build dependencies are excluded; there is no Dependabot or Renovate and no SBOM. Core pins `pdf-parse 1.1.1`, which is old. The retired `legacy/nextjs-app` declares `next ^15.0.0` without a lockfile; it is not built or deployed. Earlier critical and high advisories (jsPDF, body-parser) were recorded as fixed in `da776b6` (`APEX_FULL_AUDIT_REPORT.md` §K). |
| Application | API Security | Hand-written middleware: authentication and RBAC gates, HMAC identity assertions, header stripping at the gateway, CORS allow-lists, origin checks, rate limits, body limits, security headers, parameterised SQL | Yes | Partially Implemented | Not Applicable (in-house) | Not Available | High | See the strengths and gaps below the table. |

**API Security strengths.**

- **Gateway header handling:** the gateway strips client identity and forwarding headers (`apex/server.mjs:238-272`).
- **Assertion checks:** assertions are verified in constant time, with iss, aud and lifetime checks and the source IP taken from the socket.
- **SQL:** parameterised `?` placeholders throughout. Spot checks found no injection; interpolated identifiers come from allow-lists.
- **Open redirects:** blocked by `safeNext` (`apex/auth.mjs:500-510`).
- **Account enumeration and timing:** prevented with dummy-hash timing and decoy onboarding responses.
- **Synced HTML:** served with a sandbox CSP.
- **Archives:** Showcase limits zip-bomb inputs (`Showcase/config.js:150-153`).

**API Security gaps.**

1. **Core password-reset race.** The reset token is marked used without an `AND used_at IS NULL` condition and outside a transaction (`Core/auth/routes.js:138-148`), so concurrent replays can succeed.
2. **CSRF gaps.**
   - **Core:** the origin check passes requests with no Origin header and trusts an origin derived from the Host header (`Core/http/middleware.js:36-43`).
   - **SlidesVault:** no origin check at all; it relies on SameSite=Lax.
   - **Gateway:** adds `http://<Host>` to its allowed origins with no Host allow-list, which allows DNS rebinding.
3. **Missing CSP and baseline headers.** The gateway sends no HSTS, nosniff or X-Frame-Options, and no CSP on the SPA bundles. CSP exists only on `login.html` and `link.html` (`apex/server.mjs:646,736`). Core and the Showcase SPA have no CSP.
4. **SlidesVault PPTX zip bomb.** `JSZip.loadAsync` runs with no limit on total uncompressed size (`Vault/services/content-extraction/pptx.js:65-71`). Synced files get no magic-byte check and no malware scan.
5. **No assertion replay cache.**
6. **Error detail leaks.** Core returns `err.message` on 4xx responses and in non-production modes.
7. **Unlimited proxied bodies.** The gateway does not cap the size of proxied request bodies.

## 2.5 Cloud Security

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Cloud | Cloud Security Posture Management (CSPM) | None | Yes (once a cloud provider is chosen) | Not Implemented | Not Applicable | Not Available | Medium | No cloud account or hosting exists yet (DEC-010 open). Plan CSPM alongside the hosting decision. **Confirm with Infrastructure.** |
| Cloud | Cloud Workload Protection | Container runtime hardening in staging Compose; no CWPP agent | Yes | Partially Implemented | Open Source | Not Available | Medium | **Hardening:** `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, tmpfs `/tmp`, non-root user, and restart policies (`compose.yml:26-33`). **No runtime threat detection** (Falco, Defender, GuardDuty). SlidesVault's image lets the runtime user write to `/app`. |
| Cloud | Cloud Audit Logging | None at cloud level; application audit tables exist | Yes | Not Implemented | Not Applicable | Not Available | High | **No cloud logging:** there is no cloud and no central log shipping or SIEM. **Application-level audit trails:** Core keeps an append-only `audit_events` table (`Core/core/audit.js`). SlidesVault keeps `audit_log`, retained 365 days. Every app keeps `login_history`. Logs are structured JSON to stdout with redaction. **Gaps:** Showcase does not audit admin role or disable changes. Logs contain email addresses. Staging has no monitoring (`STAGING_RUNBOOK.md` §9). |

## 2.6 DevSecOps

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| DevSecOps | Container Image Scanning | None | Yes | Not Implemented | Not Applicable | Not Available | High | CI builds all four images (`ci.yml:111-119,222-223`) but scans none of them. Base images are tag-pinned (`node:22-bookworm-slim`, `node:22-alpine`, `node:24-alpine`, `postgres:16`), not digest-pinned. Recommended: Trivy or Grype in the `staging-smoke` job. |
| DevSecOps | Infrastructure as Code Scanning | None | Yes | Not Implemented | Not Applicable | Not Available | Low | The IaC surface is small: four Dockerfiles and two Compose files. A compose-consistency unit test exists (`deploy/staging/staging.test.mjs`), but no Checkov, KICS or Hadolint. Raise the priority when cloud IaC is introduced. |
| DevSecOps | Secret Scanning | None automated | Yes | Not Implemented | Not Applicable | Not Available | High | No gitleaks or trufflehog, and GitHub secret scanning is not verified. Manual history checks are recorded in `FINAL_PRODUCTION_READINESS_REPORT.md` §4. Ignore files exclude `.env`, gateway secrets and `.env.staging`. **Confirm whether GitHub secret scanning and push protection are on** for the repository. |

## 2.7 Incident Response

| Security Domain | Security Solution / Control | Existing Tool / Service | Required | Current Status | Free / Paid | Estimated Cost | Implementation Priority | Remarks |
|---|---|---|---|---|---|---|---|---|
| Incident Response | Vulnerability Management | `npm audit` in CI; internal audit reports with a findings register (F-001 to F-026); incident record | Yes | Partially Implemented | Free | Not Available | High | Evidence: `docs/architecture/APEX_FULL_AUDIT_REPORT.md` (26 issues; P2–P4 hardening items open in §J) and `docs/implementation/INCIDENT_2026-11-14_LOCAL_DB_MIGRATION.md`. **Gaps:** no scheduled scanning, no remediation SLA, no vulnerability tracker or SECURITY.md disclosure policy, and no penetration test. |
| Incident Response | Backup and Disaster Recovery | Manual `pg_dump`, volume archive and restore runbook (`STAGING_RUNBOOK.md` §7–8); image tag rollback; tested identity rollback CLI | Yes | Partially Implemented | Open Source | Not Available | **Critical** | **Strengths:** documented backup and restore drill and image rollback; CI rehearses the identity rollback on Postgres. **Gaps:** no automated or scheduled backups and no retention period. No off-site or encrypted backup storage. No RPO or RTO. The runbook states the drill has not been run against a staging volume. Local SQLite databases have no backup. |

---

# Security Assessment Summary

| Metric | Count |
|---|---|
| **Total Security Controls Identified** | **26.** That is the Security Team's template list; WAF appears under both Network and Application. |
| **Fully Implemented Controls** | **0** |
| **Partially Implemented Controls** | **13:** Network Segmentation, IAM, SSO, PAM, Encryption at Rest, Encryption in Transit, Key Management, Secrets Management, SCA, API Security, Cloud Workload Protection, Vulnerability Management, Backup and DR |
| **Not Implemented Controls** | **12:** WAF (Network), IDS/IPS, VPN, MFA, WAF (Application), SAST, DAST, CSPM, Cloud Audit Logging, Container Image Scanning, IaC Scanning, Secret Scanning |
| **Not Verified Controls** | **1:** Firewall |

No control is rated *Implemented*. The application-level identity work (R1) is substantial and tested, but every domain has at least one evidenced gap, and the product has no hosted environment where infrastructure controls could exist. Most "Not Implemented" network and cloud controls follow from the product being pre-deployment, not from a decision against them.

## Critical Security Gaps

1. **No TLS anywhere; Secure cookies off in shipped configurations.** All servers are plain HTTP, staging sets Secure flags to false, the gateway sends no HSTS, and Postgres runs without TLS. Any exposure beyond loopback would carry session cookies and passwords in clear text.
2. **No MFA**, including for `platform_admin`, which controls authorisation for every app.
3. **Password-reset and invite token handling in Core.**
   - Reset links are reusable under a race (`Core/auth/routes.js:138-148`).
   - Live reset and invite links are kept in plaintext in `email_outbox`.
   - With the `log` email provider they are printed to stdout.
   - The admin-invite API returns a temporary password.
4. **No automated backups or disaster-recovery objectives.** There is no encryption at rest for databases or object stores.
5. **SlidesVault standalone deployment path.** `slide vault/docker-compose.yml` publishes the API on all interfaces with identity `off` and open self-registration. Anyone who reaches it can create an active account.

## High-priority gaps

6. **CSRF defence gaps:**
   - Core's origin check passes requests with no Origin header.
   - SlidesVault has no origin check.
   - The gateway's allowed origins come from the Host header, with no Host allow-list.
7. **Missing security headers and CSP** on gateway-served pages and the SPA bundles.
8. **No SAST, secret scanning or container image scanning** in CI. SCA covers only production dependencies.
9. **In-memory, per-process rate limits and lockouts.** The gateway's revocation list is local to one instance, so none of this works across replicas or survives a restart for the limiters.
10. **Zip-bomb exposure** in SlidesVault PPTX extraction. No malware scanning of synced files.
11. **Retention and deletion gaps.** No retention for `login_history` or `audit_events`. User deletion in Core is incomplete. Showcase and SlidesVault have no deletion or export.
12. **Open registration defaults to true in all apps.** The password policy is length-only, and scrypt cost is N=2^14 in Core and SlidesVault.

## Recommended Improvements

These are recommendations, not existing implementations.

| # | Recommendation | Addresses | Priority |
|---|---|---|---|
| 1 | Put a TLS-terminating reverse proxy in front of the gateway. Set an https `APEX_PUBLIC_URL`, Secure cookies, HSTS and `APEX_TRUST_PROXY`, and enable `sslmode=require` for Postgres. Make start-up fail closed when production runs without TLS settings, in every app (Showcase already does this). | Gap 1 | Critical |
| 2 | Add MFA (TOTP or WebAuthn) in the Core, mandatory for privileged roles. | Gap 2 | Critical |
| 3 | Make reset-token consumption atomic (`UPDATE ... WHERE used_at IS NULL`, checking the affected rows). Withhold or blank secret-bearing outbox bodies after send for all mail kinds. Stop returning temporary passwords in API responses. | Gap 3 | Critical |
| 4 | Automate encrypted, off-site backups with a defined frequency and retention. Set an RPO and RTO and run the restore drill on a schedule. Decide on volume or disk encryption with the hosting choice. | Gap 4 | Critical |
| 5 | Bind SlidesVault's standalone compose to `127.0.0.1`, or retire it. Default `ALLOW_REGISTRATION` to false. Default `APEX_IDENTITY_MODE` to `required` for deployed builds. | Gap 5, 12 | Critical |
| 6 | Add CodeQL or Semgrep, gitleaks, Trivy image scans, Dependabot or Renovate, and an OWASP ZAP baseline scan against the ephemeral staging stack. Pin base images and Actions by digest or SHA. | Gap 8 | High |
| 7 | Add a global security-headers layer at the gateway: CSP, HSTS, nosniff, frame-ancestors. Add a Host allow-list. Require Origin on cookie-bearing writes in the Core, and add an origin check to SlidesVault. | Gaps 6, 7 | High |
| 8 | Move rate limits, lockouts and gateway revocation to a shared store before running more than one replica. Add an assertion `jti` replay cache. | Gap 9 | High |
| 9 | Cap total uncompressed size in SlidesVault PPTX extraction, add magic-byte checks, and consider malware scanning of synced files. | Gap 10 | High |
| 10 | Define data classification and a retention policy. Purge `login_history` and the outbox. Implement complete user deletion and data-subject export in all apps. | Gap 11 | High |
| 11 | Raise password policy and scrypt cost (N ≥ 2^17, as in Showcase). Add an idle session timeout. Retire the legacy Academia admin model in favour of Core roles. Make empty row-level rules deny. | Gap 12 | Medium |
| 12 | Add CODEOWNERS and branch protection with required reviews for identity and authorisation code. Add a SECURITY.md disclosure policy. Commission a penetration test before R6 pilot. | Review gate, vulnerability management | Medium |
| 13 | Remove `inspironics-innovation-showcase/legacy/nextjs-app`, which has open CORS and unpinned dependencies, or move it to an archive repository. | Latent risk | Low |

## Information Requiring Confirmation

| Topic | Owner | Why it is needed |
|---|---|---|
| Business criticality rating | Business owner / Security | Not stated in the repository |
| Hosting and cloud provider, OS, compute and storage for production (DEC-010) | Infrastructure / Founder | No production environment exists |
| Host firewall, security groups, WAF, IDS/IPS, VPN or bastion for any future host | Infrastructure / Security | Not in the repository |
| Disk and volume encryption on the development machine and future hosts | Infrastructure / IT | Not verifiable from code |
| Backup schedule, retention, off-site location, RPO and RTO | DevOps / Business owner | The runbook is manual and undated |
| GitHub settings: repository visibility, branch protection, required reviews, secret scanning and push protection, Dependabot alerts | DevOps / Repository owner | Configured outside the repository |
| Data classification scheme and retention periods | Data Protection / Security | No policy found |
| Applicable privacy law (GDPR, India DPDP Act, other) and the approved consent notice | Legal / DPO | Onboarding requires an approved consent notice before it runs in production |
| ISO 27001, NIST CSF or CIS programme status and any certifications | Security / Compliance | No evidence in the repository; none is claimed here |
| Licence costs for any recommended paid tooling (WAF, CSPM, GitHub Advanced Security) | Security / Finance | No costs are recorded in the repository |
| Whether the uncommitted onboarding module and onboarding app (`onboarding/`) are in scope for release | Product owner | Implemented locally and not committed (`APEX_IMPLEMENTATION_STATUS.md`, Use Case 007) |
