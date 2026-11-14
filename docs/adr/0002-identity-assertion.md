# 2. The gateway asserts the Core identity to every app

- Status: accepted with conditions — founder approved DEC-008 on 2026-11-14
- Date: 2026-11-14
- Phase: R0 Discovery; implementation belongs to R1 (master plan Use Case 003)

## Context

Today the gateway's single sign-in posts the same email and password to each app's own
`/api/auth/login` and hands the browser each app's own session cookie (`apex/auth.mjs`, `signIn`).
So every person must exist as a separate account, with a separate password hash, in three databases. R0 found the one
shared account already carries a different display name in one app
(`docs/discovery/R0_DISCOVERY_REPORT.md` §3). Separate role columns make it impossible to express scoped,
multi-role personas across apps.

Facts the design must respect:

- Each app's API listens on `127.0.0.1` only. The gateway starts them with `HOST=127.0.0.1` and
  `TRUST_PROXY=loopback` (`apex/run.mjs`, `apex/projects.mjs`).
- The gateway already strips client-supplied `X-Forwarded-*` headers and forwards each app only its own
  cookie (`apex/server.mjs`, `forwardCookies` in `apex/auth.mjs`).
- The gateway signs its own session with an HMAC key kept in `apex/.session-secret`, and revokes
  signed-out tokens (`apex/auth.mjs`).
- The Showcase also supports Google sign-in (its users table has `provider` and `verified` columns), so
  Core identity must allow non-password sign-in methods.

## Founder conditions (binding, each an R1 acceptance criterion)

1. Signed, short-lived, per-application assertions.
2. Verify **signature, issuer, audience and expiry**.
3. Support **key rotation** and **documented revocation**.
4. Strip client-supplied identity headers.
5. Prevent direct backend bypass.
6. Each application still enforces scoped authorization.

The design below meets them as follows:
- Issuer: the `iss` claim is fixed to `apex-gateway`.
- Key rotation: a key ID (`kid`) with current and previous keys accepted during an overlap.
- Revocation:
  - **Sign-out** revokes the Apex session immediately (existing).
  - **Disabling a user** takes effect within the 30 s resolve cache.
  - **A role change** can take up to about 90 s: an already-issued assertion lives up to 60 s, plus the 30 s cache.

  These timings are measured from the implementation in R1 and documented in `docs/operations/IDENTITY_ASSERTION.md`. The original "≤ 60 s" estimate was corrected after implementation.
- Bypass: in `required` mode an app rejects every non-health request without a valid assertion, even on loopback.

## Decision

1. **Core authenticates.** The gateway's sign-in calls only the Core. The Core verifies credentials and returns the user ID plus active role assignments.
2. **The gateway asserts.** On every proxied request to an app, the gateway:
   - removes any incoming `X-Apex-Identity` header
   - adds a fresh one: base64url JSON `{ sub, roles, iat, exp, aud }`, where `aud` is the app ID
   - signs it with HMAC-SHA256 using a per-app key that `apex/run.mjs` passes to each app through its environment
3. **Apps trust only that header.** An app accepts the identity only if:
   - the request arrives on loopback
   - the signature verifies with its own key
   - `aud` is its own ID
   - it has not expired (≤ 60 s)

   Otherwise the request is anonymous. Apps keep their local user row, keyed by the Core `sub`, for app-specific preferences, with no password.
4. **Rollout behind a flag** (`APEX_IDENTITY_ASSERTION=on`), one app at a time, starting with SlidesVault. The current per-app login keeps working until each app is switched.
5. **Authorization stays server-side in each app**, derived from the asserted roles and the app's own object rules. Default is deny.

## Consequences

- One password store (the Core). App password hashes can be retired after migration (ADR 0003).
- A compromised app key lets an attacker impersonate users *to that app only* (`aud`). Keys are per app and rotated by restarting with new values.
- Apps reached directly (not through the gateway) become anonymous. That is acceptable, because they already bind to loopback only.
- Contract tests are needed on both sides: the gateway signs, and each app verifies and rejects tampered, expired, wrong-audience or non-loopback requests.
- Not decided here: SSO with external identity providers (deferred; master plan §13).
