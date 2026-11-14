# Identity assertion — operations

R1 identity contract §4, ADR 0002. The gateway tells the Showcase and SlidesVault which APEX Core
user is asking, in a signed, short-lived, per-application header. This page is for whoever runs
Apex: modes, keys, revocation, bypass prevention, troubleshooting.

## How it works

1. **Sign-in.** The gateway posts the credentials to each app as before. The Academia (APEX Core)
   answer carries `user.id`; the gateway stores it as `sub` in the `apex_session` token
   (`email.expiresAt.apps.sub.signature`). Tokens issued before R1 (three or four parts) are still
   accepted until they expire; they have no `sub`, so they get no assertion. With
   `APEX_GOOGLE_CLIENT_ID` set, **Sign in with Google** posts the Google ID token to the Core
   (`POST /api/core/auth/google`), which signs in only a Google subject already linked to a Core
   user.
2. **Resolution.** For a session with a `sub`, the gateway calls the Core directly on its API port:
   `POST /api/core/identity/resolve` with `{ sub }`, authenticated by `X-Apex-Service` (same format,
   `aud: "core"`, no user claims, signed with the `core` key). The answer is cached per `sub` for
   30 seconds; a "Core unreachable" answer for 2 seconds.
3. **Assertion.** Every request to `/showcase/api/…` or `/vault/api/…` gets a fresh
   `X-Apex-Identity: <kid>.<base64url(payload)>.<base64url(HMAC-SHA256)>` signed with that app's own
   key. Payload: `iss: "apex-gateway"`, `aud` (`showcase` | `slidesvault`), `sub`, `app_user_id`
   (from a confirmed identity link, else null), `email`, `name`, `roles`, `iat`, `exp = iat + 60`.
4. **Verification** in each app (`lib/apexIdentity.js` / `http/apexIdentity.js`, byte-identical
   copies of `apex/identity.mjs`): format → known `kid` → constant-time signature → `iss` → `aud` →
   `exp > now`, `iat <= now + 30`, `exp − iat <= 120` → the TCP peer is in
   `APEX_IDENTITY_TRUSTED_SOURCES`. Then the local account (linked `app_user_id`, else
   `core_user_id = sub`, else a new passwordless account; never matched by email) and the role for
   this request only (`platform_admin`, or `app_admin` for this app → admin; any other role → base
   role; no role → 403).

## Modes

| Variable | Values | Default |
|---|---|---|
| `APEX_IDENTITY_MODE` | `off` \| `optional` \| `required` | `off` |
| `APEX_IDENTITY_MODE_SHOWCASE`, `APEX_IDENTITY_MODE_SLIDESVAULT` | same; override per app | the global value |

Set them in the environment before `start.bat`. `apex/run.mjs` passes each app its resolved mode,
`APEX_IDENTITY_ISSUER`, `APEX_IDENTITY_AUDIENCE` and only its own keys (`APEX_IDENTITY_KEYS`,
current and previous); the Academia gets its `core` keys. An unrecognised value runs as `required`
at the gateway, and is a configuration error in the apps (SlidesVault refuses to start; the
Showcase refuses in production and runs as `required`).

| Mode | Gateway | App |
|---|---|---|
| `off` | Strips client `X-Apex-Identity`/`X-Apex-Service`. Never calls the Core, creates no keys, adds nothing. | Ignores the header; legacy sign-in unchanged. |
| `optional` | Adds the assertion when the Core answered. Core unreachable: forwards without one (the app's own session cookie still works). | Valid header → that user. Present but invalid → 401. Absent → legacy session. |
| `required` | Does not post the password to that app's login; counts it signed in when the Core accepted. Core unreachable → **503** `APEX_IDENTITY_UNAVAILABLE`, never an unsigned pass-through. | Every `/api` route except health and today's public routes needs a valid header (401 `APEX_IDENTITY_REQUIRED`). Its own login/register/Google/reset routes → 403. |

Suggested rollout (ADR 0002): SlidesVault `optional` → `required`, then the Showcase. Confirm
identity links in the Core first (`/api/core/identity-links`), so existing accounts are reused
through `app_user_id` rather than new passwordless ones being created.

## Keys and rotation

File: `apex/.identity-keys.json` (gitignored, mode 0600; `APEX_IDENTITY_KEYS_FILE` moves it).
Created on first start with identity on. One 32-byte key per audience (`core`, `showcase`,
`slidesvault`) per `kid`.

```text
node apex/identity-keys.mjs           # show the kids (never the keys)
node apex/identity-keys.mjs rotate    # new current kid; the previous one is kept
node apex/identity-keys.mjs prune     # drop every kid but the current one
```

Rotation:

1. `node apex/identity-keys.mjs rotate`.
2. Restart Apex (`stop.bat`, then `start.bat`). Keys are read at start-up only. Every app now
   accepts both kids; the gateway signs with the new one.
3. If any app is restarted separately, it must be restarted *after* step 1 so it knows the new kid.
4. After every process runs with the new kid (at least 2 minutes after the last restart),
   `node apex/identity-keys.mjs prune`, then restart Apex again. Assertions under the pruned kid are
   refused (`unknown_kid`).

On a suspected key leak: rotate, restart, prune and restart immediately — the overlap is then
seconds, and a leaked key only ever worked against its own app (`aud`).

## Revocation and timings

| Event | Takes effect |
|---|---|
| Sign-out at Apex | Immediately: the token is revoked (`apex/.revoked-sessions`), every app session revoked at its API. |
| User disabled or deleted in the Core | At the next request after the resolve cache entry expires — **≤ 30 s**. The Core answers `active:false`; the gateway revokes the Apex session exactly as a sign-out does, answers 401 (or redirects a page load to `/login?expired=1`). |
| Role granted, revoked or transitioned in the Core | **≤ 30 s** (resolve cache), plus up to 60 s for an assertion already in flight: **≤ 90 s** worst case, normally ≤ 30 s. |
| Identity link confirmed or rejected | Same as a role change. |
| Key pruned | On the restart after `prune`. |

App-local sessions (`insp_session`, `sv_session`) in `optional` mode are revoked by the Apex
sign-out as before; in `required` mode they are not accepted at all.

## Bypass prevention

- The gateway deletes `X-Apex-Identity` and `X-Apex-Service` from every incoming request, on every
  path, before routing (also on websocket upgrades); only the gateway's own value is added.
- Each app binds to `127.0.0.1` (`HOST`, set by `run.mjs`) and accepts an assertion only from a peer
  in `APEX_IDENTITY_TRUSTED_SOURCES` — the TCP peer, never `X-Forwarded-For`.
- In `required` mode an app refuses every non-public `/api` request without a valid assertion, even
  on loopback: a local process calling the app's port directly is anonymous.
- Keys are per audience: the Showcase holds no SlidesVault or Core key and vice versa.
- Asserted roles never reach the apps' role columns, so turning identity off returns every account
  to exactly the role it had.

## Containers

Containers do not use `run.mjs`, so every service gets its environment explicitly. The working reference is `deploy/staging/compose.yml`, with its runbook at `docs/operations/STAGING_RUNBOOK.md`.

**Gateway**
- `APEX_UPSTREAM_HOST_<ID>` (`SHOWCASE`, `VAULT`, `ACADEMIA`) names each app's host. It falls back to `APEX_UPSTREAM_HOST`, then `127.0.0.1`.
- The full key store comes from `APEX_IDENTITY_KEYS_STORE` (JSON, validated; no file is written).
- `APEX_SESSION_SECRET_FILE` moves the session secret to a writable volume.

**Each app**
- `APEX_IDENTITY_MODE`, `APEX_IDENTITY_AUDIENCE` and **only its own** keys in `APEX_IDENTITY_KEYS` (`keysFor()` in `apex/identity-keys.mjs`; `deploy/staging/generate-secrets.mjs` produces them).
- `APEX_IDENTITY_TRUSTED_SOURCES` and `TRUST_PROXY` set to the gateway's fixed internal address. The Core honours `TRUST_PROXY` too.

**Key rotation in containers**
1. Run `node deploy/staging/generate-secrets.mjs --rotate-identity-keys`.
2. Recreate every service.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| App answers 401 `APEX_IDENTITY_INVALID` | The app's log line `Apex identity assertion refused` names the reason: `unknown_kid` (app started before a rotation, or keys pruned too early — restart it), `signature` (keys from a different file), `audience`, `expired`/`not_yet_valid` (clock skew > 30 s between gateway and app), `source` (`APEX_IDENTITY_TRUSTED_SOURCES` does not include the gateway). |
| 503 `APEX_IDENTITY_UNAVAILABLE` | The Core is down, or refuses the service assertion (Core log `core.service_assertion_rejected`: it was not started with the current `core` keys — restart Apex). |
| 401 `APEX_IDENTITY_REQUIRED` from an app | No assertion was sent: the session has no `sub` (signed in before R1, or the Academia did not accept the password). Sign out and in again. |
| 403 `APEX_NO_ROLE` | The Core user has no active role. Grant one in the Core. |
| 403 `APEX_LINK_MISSING` / `APEX_ACCOUNT_DISABLED` | The confirmed link points to a local account that was deleted or disabled in that app. |
| Sign-in page shows no Google button | `APEX_GOOGLE_CLIENT_ID` unset, or Google's script blocked by the network. |
| Google sign-in answers "not linked" | The Google account is not linked to a Core user (`POST /api/core/external-identities/google` while signed in). |
