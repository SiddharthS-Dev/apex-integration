# Private staging — runbook

R1 identity contract §5, ADR 0001/0002. This describes the private staging stack in
`deploy/staging/`. It covers readiness only. Nothing here deploys Apex anywhere real. Deploying to a
real host needs explicit founder authorisation, and the hosting decision (DEC-010) is still open.

The stack runs five containers:

| Service | Image | Database | Published |
|---|---|---|---|
| `gateway` | `deploy/gateway/Dockerfile` (apex/ + the three web bundles) | — | `127.0.0.1:${APEX_STAGING_PORT}` → 4173, **the only published port** |
| `core` (APEX Core = Academia API) | `Inspironics Academia/apps/api/Dockerfile` | Postgres `core` | no |
| `showcase-api` | `inspironics-innovation-showcase/apps/api/Dockerfile` | Postgres `showcase` | no |
| `slidesvault-api` | `slide vault/apps/api/Dockerfile` (existing) | Postgres `slidesvault` | no |
| `postgres` | `postgres:16` | one role and one database per API | no |

**Networks**
- `apex-staging-backend` is `internal` (no route in or out). Every service is on it.
- The gateway has a fixed address there, `APEX_STAGING_GATEWAY_IP` (default `10.213.47.10`).
- `APEX_IDENTITY_TRUSTED_SOURCES` in each API names that one address. So does the Core's check of the
  gateway's service assertion.
- `apex-staging-edge` carries only the gateway's published port.

**Identity**
- Showcase and SlidesVault run `APEX_IDENTITY_MODE=required`.
- The gateway holds the whole key store (`APEX_IDENTITY_KEYS_STORE`).
- Each API gets only its own audience's keys (`APEX_IDENTITY_KEYS`), current and previous.

**Hardening**
- The four app containers run as the non-root `node` user.
- Their root filesystem is read-only, with all capabilities dropped and `no-new-privileges` set.
- State lives only on named volumes.

**External inputs**
- Dropbox, AI (Gemini, Anthropic), Google sign-in and outbound mail are all off or empty. The Core
  writes mail to its log.
- Registration is closed. There is no first-user admin.
- One adult, internal test admin is bootstrapped (`BOOTSTRAP_ADMIN_*`).

All commands below run from the repository root. Define this alias once per shell:

```sh
alias stg='docker compose -f deploy/staging/compose.yml --env-file deploy/staging/.env.staging'
```

## 1. Prerequisites

- Docker Engine 24+ with Compose v2.17+ (`docker compose version`). Compose needs `--wait` and
  `--wait-timeout`.
- Node.js 22 for the two scripts (`generate-secrets.mjs`, `smoke.mjs`). They use built-ins only.
- About 4 GB free for images and build cache. The gateway image carries the Showcase's ~170 MB of
  infographics.
- The images build from source. Building needs the npm registry and the ffmpeg-static download
  (GitHub). Running needs neither.

## 2. Secrets

```sh
node deploy/staging/generate-secrets.mjs            # writes deploy/staging/.env.staging (mode 0600)
```

- The file is gitignored (`deploy/staging/.gitignore`). Every variable is documented in
  `deploy/staging/.env.staging.example`, which holds no values.
- The script refuses to overwrite an existing file.
- `--force` regenerates every secret. Then also remove the volumes (`stg down -v`): Postgres roles
  keep the passwords they were created with.
- Options: `--port <n>` (default 4173) and `--admin-email <e>` (default
  `staging-admin@apex-staging.invalid`).
- The bootstrap admin password is in the file (`BOOTSTRAP_ADMIN_PASSWORD`). It is never printed.
- The values are throwaway. Never copy them into chat, tickets or commits.

## 3. Bring-up and shut-down

```sh
stg config --quiet                          # the file resolves (missing secrets stop here)
stg up -d --build --wait --wait-timeout 600 # build the 4 images, start, wait for every healthcheck
stg ps
stg down                                    # stop, keep data
stg down -v                                 # stop and delete every volume (all data)
```

**Start order** is enforced by `depends_on` and healthchecks:
1. `postgres` starts. Its healthcheck queries the `slidesvault` database over TCP, so it passes only
   after the init script has created all three databases.
2. The three APIs start. Each one applies its own migrations at start-up.
3. `gateway` starts.

On the first start, the Core creates the bootstrap admin with an Inspironics membership, `staff` and
`platform_admin`.

**Logs:**

```sh
stg logs -f gateway core showcase-api slidesvault-api
```

The apps log JSON lines. Identity refusals are logged with their reason:
- Showcase and SlidesVault: `Apex identity assertion refused`
- Core: `core.service_assertion_rejected`

## 4. Verifying

```sh
node deploy/staging/smoke.mjs                # through the gateway, from the host
```

**Checks through the gateway (host side)**
- Gateway health.
- Signed out: the app APIs are refused, even with a forged `X-Apex-Identity`.
- A wrong password is refused.
- Sign-in with the bootstrap admin through the gateway.
- `GET /academia/api/core/me` lists `platform_admin` and the membership. This exercises the Core,
  Postgres and the backfill.
- `GET /showcase/api/auth/me` and `GET /vault/api/auth/me` return the asserted Core user as admin.
- `GET /vault/api/presentations` answers 200. This exercises assertion, Core resolve and each app's
  Postgres.
- A forged client `X-Apex-Identity` is stripped: the real session decides.
- A forged `X-Apex-Service` is stripped: Core resolve refuses the request.
- Core registration and the apps' own sign-in routes answer 403.
- No app or database port answers on the host.
- After sign-out, the old cookies get 401 everywhere.

**Bypass attempts (from inside the internal network)**

Run them from a throwaway container on the internal network. It has no keys and no app environment:

```sh
KID=$(grep '^APEX_IDENTITY_KID=' deploy/staging/.env.staging | cut -d= -f2)
docker run --rm --network apex-staging-backend --read-only -e SMOKE_KID="$KID" \
  -v "$PWD/deploy/staging/smoke.mjs:/smoke/smoke.mjs:ro" --entrypoint node \
  apex-staging/showcase-api:local /smoke/smoke.mjs bypass
```

These calls go straight to `showcase-api`, `slidesvault-api` and `core`. Each one must be refused:
- No assertion → 401.
- A self-made assertion with an unknown kid → 401.
- A self-made assertion with the real kid but a wrong key → 401.
- Legacy password sign-in → 403.
- Core resolve without a valid service assertion → 401.

The key id is not secret.

CI runs exactly this sequence in the `staging-smoke` job, then `down -v`. The `core-postgres` job runs
the Core migrations, including `008_core_identity`, twice against Postgres 16, with the rollback
drill. It also runs the Showcase migrations and their `002_core_user_id` rollback.

## 5. Identity key rotation

Keys are read **at start-up only**, by the gateway and by every API. A rotation is therefore always a
restart of all four app services. The gateway must restart too, or it keeps signing with the old kid.

1. Rotate. This adds a new current kid and keeps the previous one, so both are accepted during the
   overlap. Only the identity lines change; the old file is kept as `.env.staging.bak-<time>`.

   ```sh
   node deploy/staging/generate-secrets.mjs --rotate-identity-keys
   ```

2. Recreate everything that holds keys:

   ```sh
   stg up -d --force-recreate --wait core showcase-api slidesvault-api gateway
   ```

   Compose starts the APIs before the gateway (`depends_on`). Each app accepts both kids, and the
   gateway signs with the new one.
3. Wait at least 2 minutes, which is longer than the longest assertion life (`exp − iat ≤ 120 s`
   accepted, 60 s issued). Then prune and recreate again:

   ```sh
   node deploy/staging/generate-secrets.mjs --prune-identity-keys
   stg up -d --force-recreate --wait core showcase-api slidesvault-api gateway
   ```

   Assertions under the pruned kid are then refused (`unknown_kid`).

**Suspected leak:** do steps 1–3 back to back, without the 2-minute wait. A leaked key only ever
worked against its own audience. A leaked `core` key could only call resolve, and only from the
gateway's address.

Recreating the gateway does not sign anyone out. The session secret and the revocation list live on
the `gateway-state` volume. To sign everyone out, delete that volume while the gateway is stopped:

```sh
stg rm -sf gateway
docker volume rm apex-staging_gateway-state
stg up -d --wait gateway
```

## 6. Revocation and timings

These are taken from the code: `apex/gateway-identity.mjs`, `apex/identity.mjs` and `apex/auth.mjs`.

| Event | Takes effect |
|---|---|
| Sign-out at the gateway | **Immediately.** The token is revoked; the list persists on `gateway-state`. Every app session is revoked at its API. |
| User disabled or deleted in the Core | **≤ 30 s.** The gateway caches each resolve answer per user for at most 30 s (`RESOLVE_TTL_MS`). The next request after expiry gets `active:false`, and the gateway ends the session as a sign-out does. |
| Role granted, revoked or transitioned; identity link confirmed or rejected | **≤ 30 s** through the gateway (the same cache). Worst case **≈ 90 s**: an assertion already issued stays valid until its `exp`, 60 s after issue. |
| Core unreachable | Showcase and SlidesVault API calls get **503** `APEX_IDENTITY_UNAVAILABLE`, never an unsigned pass-through. The failure is cached for 2 s. |
| Key pruned | On the recreate after `--prune-identity-keys`. |

Assertions are minted per request by the gateway. The browser never sees them, so the 60 s tail only
matters for a header captured on the internal network.

To disable a user, use the Core's user administration as a platform admin. Disabling also destroys
that user's Core sessions.

## 7. Backup and restore (Postgres)

### Backup

Take one archive per database plus the roles:

```sh
mkdir -p backups && ts=$(date -u +%Y%m%dT%H%M%SZ)
for db in core showcase slidesvault; do
  stg exec -T postgres pg_dump -U postgres -Fc "$db" > "backups/$db-$ts.dump"
done
stg exec -T postgres pg_dumpall -U postgres --globals-only > "backups/globals-$ts.sql"
```

Non-database state lives on volumes:
- `core-data`: the Core's media store.
- `gateway-state`: the session secret and revocations.
- `showcase-data` and `slidesvault-data`: regenerable caches.

Archive a volume like this:

```sh
docker run --rm -v apex-staging_core-data:/v:ro -v "$PWD/backups:/b" alpine \
  tar czf "/b/core-data-$ts.tgz" -C /v .
```

### Restore drill

Restore into a scratch database, compare, then drop it. The live data is not touched.

```sh
stg exec -T postgres createdb -U postgres core_restore_drill
stg exec -T postgres pg_restore -U postgres -d core_restore_drill --no-owner < backups/core-$ts.dump
for d in core core_restore_drill; do
  stg exec -T postgres psql -U postgres -d "$d" -tAc \
    "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM role_assignments), (SELECT count(*) FROM schema_migrations)"
done                                         # the two lines must match
stg exec -T postgres dropdb -U postgres core_restore_drill
```

Repeat for `showcase` and `slidesvault` (compare `users` and `app_user` respectively), and record the
date and result.

### Real restore of one database

Example: `core`.

```sh
stg stop core gateway
stg exec -T postgres dropdb -U postgres --force core
stg exec -T postgres createdb -U postgres -O core core
stg exec -T postgres pg_restore -U postgres -d core --no-owner --role=core < backups/core-<ts>.dump
stg up -d --wait core gateway
```

If the roles are missing (a new volume), first apply `backups/globals-<ts>.sql` with `psql -U postgres`.
Restore all three databases from the same backup time.

## 8. Rollback

### Images

Images are tagged `apex-staging/<service>:${APEX_IMAGE_TAG}` (default `local`).
- Before an upgrade, give the running images a tag of their own:
  `docker tag apex-staging/core:local apex-staging/core:pre-<date>`, and the same for the other
  three.
- Alternatively, build with `APEX_IMAGE_TAG=<git sha>` in `.env.staging`.

To roll back:
1. Set `APEX_IMAGE_TAG` back to the previous tag.
2. Run `stg up -d --no-build --wait`.

Migrations are forward-only. The R1 ones are additive, so older images run against them:
- New Core tables, which pre-R1 code ignores.
- A nullable `core_user_id` column in each app.

### Core identity (contract §1)

This drops the six Core identity tables and the two migration records. No pre-R1 table is touched.
Take a backup (§7) first.

1. Showcase and SlidesVault cannot run `required` without the Core resolve endpoint. Set their
   `APEX_IDENTITY_MODE` to `off` in `compose.yml`.

   > **Note:** in staging they then have no local accounts.
2. Stop the Core so it cannot re-apply the migration, then run the rollback:

   ```sh
   stg stop core
   stg run --rm --no-deps core node src/core/cli/rollback-identity.js --yes
   ```

   This is what `npm run core:rollback-identity -- --yes` runs. Inside the container, call node
   directly: the root filesystem is read-only, and npm wants to write its cache.

3. Start a **pre-R1** Core image (image rollback above). Starting the R1 image again re-applies `008`
   and the backfill, recreating the tables from `users.role` and `users.audience`.

CI rehearses this on a throwaway Postgres database in the `core-postgres` job:
1. Migrate.
2. Roll back. The tables and records are gone, and the `users` count is unchanged.
3. Migrate again.

The drill has not been run against a staging volume.

### App `core_user_id` columns

Roll an app's column back only after that app's identity mode is `off`. Each command drops only the
column and its unique index; no pre-R1 data lives there.

```sh
stg run --rm --no-deps showcase-api node src/db/migrate.js --rollback 002_core_user_id
stg run --rm --no-deps slidesvault-api node scripts/migrate.js --rollback 005_core_user_id
```

The SlidesVault command works only while `005_core_user_id` is its latest migration
(`slide vault/apps/api/docs/SCHEMA.md`).

## 9. What is intentionally not done

- **No public exposure.** The gateway binds `127.0.0.1` only, with no TLS. The cookies are therefore
  not `Secure` (`COOKIE_SECURE=false` for the Core and the Showcase, `SESSION_COOKIE_SECURE=false`
  for SlidesVault). A real host needs:
  - an https `APEX_PUBLIC_URL`
  - a TLS-terminating reverse proxy
  - `APEX_TRUST_PROXY`
  - those flags set to `true`
- **No real external inputs.** There are no Dropbox apps, AI keys, Google client, mail provider or
  real users. The internal network has no route out.
- **No real deployment, registry push or hosting choice.** Deploying needs founder authorisation;
  DEC-010 is open.
- **No consent screens, public registration, student-work publication or external organisations.**
  These are held in R1. `CORE_EXTERNAL_ORGS_ENABLED=false`.
- **No automated backups or monitoring.** §7 is manual.

### Known limits

- **The Core's own client address.** The Academia API trusts `X-Forwarded-For` from loopback only
  (`app.set('trust proxy', 'loopback')` in `apps/api/src/app.js`). In containers, its login history
  and IP rate limits see the gateway's address, not the browser's. Fixing this needs an app change
  (an env-driven `TRUST_PROXY`). The Showcase and SlidesVault already take `TRUST_PROXY`, set to the
  gateway's address.
- **The gateway's own client address.** Docker's port publishing shows the gateway one address for
  every client, so its sign-in failure limiter is shared by everyone on this host.
- **Healthcheck depth.** The Core's `/api/health` does not query the database. It only answers after
  the start-up migrations succeeded. The gateway's healthcheck (`/auth/config`) does not probe the
  APIs; `depends_on` covers that at start.
