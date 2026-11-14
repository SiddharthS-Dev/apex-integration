# R1 identity contract (binding for all R1 work streams)

- Status: in force for R1
- Date: 2026-11-14
- Decisions: ADR 0001–0004; founder approval of DEC-007/008/009/013

**Authorised R1 scope**
- shared identity
- reviewed account mappings
- organisation membership
- scoped roles
- gateway security
- private staging readiness

**Held (must stay disabled or absent)**
- public registration
- production consent screens
- student-work publication
- real external onboarding (no non-internal organisations unless `CORE_EXTERNAL_ORGS_ENABLED=true`, default false)
- any renaming or consolidation of "Slide World", Innovations or Showcase (Use Case 001 unresolved)

Existing employee access must keep working. The default configuration behaves exactly as before R1.

---

## 1. Core data (Academia API = APEX Core)

**One new migration, `008_core_identity`,** in `Inspironics Academia/apps/api/src/db/migrations.js`.
- Core tables use real constraints: FK, UNIQUE, CHECK and partial unique indexes. They are **not** generic entities.
- The SQL must run on SQLite and Postgres. Statements are split on `;`, so no triggers or semicolons inside a statement.
- All IDs are TEXT UUIDs; timestamps are ISO TEXT, as in `users`.

| Table | Columns (constraints) |
|---|---|
| `organizations` | `id` PK; `slug` UNIQUE NOT NULL; `name` NOT NULL; `kind` NOT NULL CHECK in (`internal`,`partner`,`institution`); `status` NOT NULL DEFAULT `active` CHECK in (`active`,`suspended`); `created_at`, `updated_at` |
| `organization_memberships` | `id` PK; `organization_id` NOT NULL FK→organizations; `user_id` NOT NULL FK→users; `title`; `valid_from` NOT NULL; `valid_to` NULL; `created_by` FK→users NULL; `created_at`; partial UNIQUE (`organization_id`,`user_id`) WHERE `valid_to IS NULL` |
| `role_assignments` | `id` PK; `user_id` NOT NULL FK→users; `role` NOT NULL CHECK in catalogue (§2); `scope_type` NOT NULL CHECK in (`platform`,`organization`,`app`); `scope_id` NOT NULL DEFAULT `''` (empty only for platform); `valid_from` NOT NULL; `valid_to` NULL; `granted_by` FK→users NULL; `granted_via` NOT NULL CHECK in (`api`,`migration`,`cli`); `revoked_by` FK→users NULL; `reason`; `created_at`; partial UNIQUE (`user_id`,`role`,`scope_type`,`scope_id`) WHERE `valid_to IS NULL` |
| `identity_links` | `id` PK; `core_user_id` NOT NULL FK→users; `app` NOT NULL CHECK in (`showcase`,`slidesvault`); `app_user_id` NOT NULL; `status` NOT NULL CHECK in (`proposed`,`confirmed`,`rejected`); `evidence` NOT NULL CHECK in (`admin_review`,`import_consistent`,`possession`); `proposed_by` FK→users NULL (NULL = CLI/import); `proposed_at` NOT NULL; `reviewed_by` FK→users NULL; `reviewed_at`; `note`; partial UNIQUE (`app`,`app_user_id`) WHERE `status <> 'rejected'`; partial UNIQUE (`core_user_id`,`app`) WHERE `status = 'confirmed'` |
| `external_identities` | `id` PK; `user_id` NOT NULL FK→users; `provider` NOT NULL CHECK in (`google`); `subject` NOT NULL; `verified_at` NOT NULL; `created_at`; UNIQUE (`provider`,`subject`) |
| `audit_events` | `id` PK; `at` NOT NULL; `actor_user_id` NULL; `actor_kind` NOT NULL CHECK in (`user`,`gateway`,`system`,`cli`); `action` NOT NULL; `target_type`; `target_id`; `organization_id` NULL; `detail` TEXT (JSON); `ip`. Append-only: no update or delete code path |

**Data migration `core_identity_backfill`** (ADR 0004). It is idempotent and recorded like the existing data migrations.
1. Create the organisation `inspironics` (kind `internal`).
2. For every existing user:
   - audience `employee` or `leadership` → membership + `staff` (organization, inspironics)
   - audience `intern` → membership (title `Intern`) + `intern` (organization, inspironics), and **no** `staff`
   - role `admin` → `platform_admin` (platform)
   - role `user` → `learner` (platform)
3. `granted_via = 'migration'`, with an audit event per user.

**Compatibility**
- `users.role` stays authoritative for every existing Academia route (`requireAdmin`).
- Granting or revoking `platform_admin` keeps `users.role` in sync (`admin` while an active `platform_admin` exists, otherwise `user`) in the same transaction.
- Existing user-admin paths that change `users.role` must also open or close the assignment.
- `users.audience` is untouched.

**Rollback**
- Down-migration script (documented and tested on a disposable database) drops the R1 tables and removes their `schema_migrations` / data-migration records. The R1 tables are the six from `008_core_identity`, plus `user_session_epochs` from `009_user_session_epochs`, which was added after the security review, finding L1.
- No existing table is altered, so rollback cannot lose pre-R1 data.

## 2. Role catalogue and scope rules

| Role | Allowed scope types | Grantable by |
|---|---|---|
| `platform_admin` | platform | platform_admin (never self) or CLI break-glass |
| `org_admin` | organization | platform_admin |
| `staff` | organization | platform_admin |
| `assessor` | platform, organization | platform_admin |
| `app_admin` | app (`showcase`, `slidesvault`) | platform_admin |
| `learner`, `mentor` | platform, organization | platform_admin; org_admin within own org |
| `student`, `intern`, `alumni` | platform, organization | platform_admin (persona roles; no onboarding UI in R1) |

**Authorization rules (server-side, default deny)**
- Membership and `staff` grant **no** administrative permission.
- An `org_admin` acts only inside organisations where they hold an active `org_admin` assignment. Every query filters by that organisation ID (cross-organisation isolation).
- An assignment is active when `valid_from <= now` and (`valid_to IS NULL` or `valid_to > now`), the user is not disabled, and (for organisation scope) the user holds an active membership in that organisation.
- Role transition (Use Case 006) closes the old assignment (`valid_to = now`) and opens the new one in **one transaction**. History stays queryable.

## 3. Core endpoints (`/api/core`, JSON, behind `loadSession`)

| Method and path | Who | Notes |
|---|---|---|
| `GET /api/core/me` | signed-in | user, active roles, active memberships, confirmed links |
| `GET /api/core/users?q=` | platform_admin | search by email or name |
| `GET /api/core/users/:id` | platform_admin; org_admin if the user is a member of their org (org-scoped data only) | roles, memberships, links, external identities (provider only) |
| `GET /api/core/organizations` | platform_admin all; others their own | |
| `POST /api/core/organizations` | platform_admin | kind ≠ `internal` refused unless `CORE_EXTERNAL_ORGS_ENABLED=true` |
| `GET /api/core/organizations/:id/members` | platform_admin; org_admin of that org | |
| `POST /api/core/organizations/:id/members` | **platform_admin only.** This is tightened after the security review, finding M2: an org_admin who could enrol any user could pull people across organisations | `{ user_id, title }` |
| `POST /api/core/memberships/:id/end` | same | also ends that user's org-scoped role assignments in that org |
| `POST /api/core/role-assignments` | per §2 | `{ user_id, role, scope_type, scope_id, reason }` |
| `POST /api/core/role-assignments/:id/revoke` | per §2 | `{ reason }` |
| `POST /api/core/role-assignments/:id/transition` | per §2 | `{ to_role, reason }`; atomic |
| `GET /api/core/identity-links?status=` | platform_admin | |
| `POST /api/core/identity-links` | platform_admin | proposes (`evidence: admin_review`) |
| `POST /api/core/identity-links/:id/confirm` | platform_admin, **not** the proposer (CLI proposals have no proposer) | Links grant no roles |
| `POST /api/core/identity-links/:id/reject` | platform_admin | `{ note }` required |
| `GET /api/core/audit-events?action=&target_id=&limit=&offset=` | platform_admin | |
| `POST /api/core/auth/google` | anonymous | Disabled (404) unless `GOOGLE_CLIENT_ID` is set. Verifies the ID token (audience = client ID, `email_verified` irrelevant). Signs in **only** via `external_identities (google, sub)`; **never** by email. Unknown subject → 401 with no account hint |
| `POST /api/core/external-identities/google` | signed-in | Links a verified Google credential to the current user (possession). 409 if the subject is linked elsewhere |
| `POST /api/core/identity/resolve` | gateway service only (§4.3) | `{ sub }` → `{ active, user {id,email,full_name}, roles [{role,scope_type,scope_id}], links {showcase, slidesvault} }`. `active:false` if the user is disabled or missing |

Every mutating endpoint writes an `audit_events` row in the same transaction.

**Break-glass CLI**
- `npm run core:grant-admin -- --email <e> --reason <r>` grants `platform_admin` with `granted_via='cli'` and audits with `actor_kind='cli'`.
- This is the only way past the "never self" rule when a second admin does not exist.

**Link-proposal CLI**
- `tools/identity/propose-links.mjs` reads app database **snapshots** (reusing `tools/discovery/user-overlap.mjs`, extended to return app user IDs).
- It is a dry run by default. `--apply` inserts `proposed` links (`evidence: import_consistent`, `proposed_by NULL`) **only** for `multi-app-consistent` groups whose email matches exactly one Core user.
- Conflicts are printed for manual admin handling.
- It never confirms anything.

## 4. Gateway identity assertion (ADR 0002 and founder conditions)

### 4.1 Keys

- File: `apex/.identity-keys.json` (gitignored, mode 0600): `{ "current": "<kid>", "keys": { "<kid>": { "core": "<b64>", "showcase": "<b64>", "slidesvault": "<b64>" } } }`. Each value is 32 random bytes.
- `node apex/identity-keys.mjs rotate` adds a new `kid` as current and keeps the previous `kid` for overlap. `prune` drops non-current keys.
- `apex/run.mjs` gives each child **only its own audience's** keys (current and previous) as `APEX_IDENTITY_KEYS` (JSON `{kid: b64}`). It also passes `APEX_IDENTITY_ISSUER=apex-gateway`, `APEX_IDENTITY_AUDIENCE=<app id>` and `APEX_IDENTITY_MODE`.

### 4.2 Assertion header

`X-Apex-Identity: <kid>.<base64url(JSON payload)>.<base64url(HMAC-SHA256(key, kid + "." + payloadB64))>`

- Payload: `{ iss: "apex-gateway", aud: "<app id>", sub: "<core user id>", app_user_id: "<id or null>", email, name, roles: [{role, scope_type, scope_id}], iat, exp }` (seconds).
- `exp - iat` = 60.

### 4.3 Gateway behaviour

- **Always** deletes incoming `x-apex-identity` and `x-apex-service` headers from every request, on every path.
- **Sign-in.** Identifies the Core user from the Academia login response (`user.id`). Stores `sub` in `apex_session`; the token format gains a `sub` part, and older tokens without it are still honoured.
- **Resolution.** Resolves via Core `POST /api/core/identity/resolve`, authenticated with `X-Apex-Service` (same format, `aud: "core"`, no user claims). Cached per `sub` for ≤ 30 s.
  - `active:false` clears the Apex session, which acts as revocation.
  - Core unreachable → requests to apps in `required` mode get 503, never an unsigned pass-through.
- **Per request.** For `showcase` and `slidesvault` requests with a session `sub`, adds a fresh assertion for that app's audience.
- **Upstream host.** Configurable for containers through `APEX_UPSTREAM_HOST` (default `127.0.0.1`).

### 4.4 App verification (Showcase and SlidesVault)

**`APEX_IDENTITY_MODE`**

| Mode | Behaviour |
|---|---|
| `off` (default) | Header ignored; legacy behaviour unchanged |
| `optional` | Valid header → that identity. Present-but-invalid → 401. Absent → legacy session |
| `required` | Every `/api` route except health and the public paths already open today requires a valid header. Legacy login/register return 403 |

**Verification order**
1. Format.
2. Known `kid`.
3. Constant-time signature.
4. `iss`.
5. `aud`.
6. `exp > now`, with `iat <= now + 30` and `exp - iat <= 120`.
7. The source address is in `APEX_IDENTITY_TRUSTED_SOURCES` (default `loopback`; a comma list of IPs or CIDRs for containers).

**Local user**
- `app_user_id` → that local user, which must exist and be active.
- Otherwise the local user whose `core_user_id = sub`.
- Otherwise a new passwordless local user created with `core_user_id = sub`. This creates; it never merges by email.
- App migrations add a nullable unique `core_user_id` column.

**Role, per request** (never written to the local role column)
- `platform_admin`, or `app_admin` scoped to this app → app admin.
- Any other active role → base role: Showcase `viewer`, SlidesVault `user`.
- No roles → 403.

Existing object-level rules then apply unchanged.

## 5. Private staging readiness

The scope is readiness, not deployment.
- Container images for the gateway, Core, Showcase API and SlidesVault API.
- `deploy/staging/compose.yml` with Postgres.
  - Only the gateway is published, bound to `127.0.0.1`.
  - App ports stay unpublished on an internal network.
  - Identity mode is `required`.
- `.env.staging.example` with no secrets.
- `docs/operations/STAGING_RUNBOOK.md`: bring-up, key rotation, revocation, backup and restore, rollback.
- A CI job that builds the images, starts the stack, and runs an end-to-end smoke test: health checks, sign-in through the gateway with an invited adult test account, an identity-asserted request to each app, and a direct-bypass attempt that must fail.
- Deploying anywhere real requires explicit founder authorisation (DEC-010 open).
