# R1 follow-up — account-holder ownership proof (ADR 0003 item 4)

- Status: binding for the R1 follow-up
- Date: 2026-11-14
- Founder instruction: implement the account-holder sign-in ownership proof; do not create another platform admin to bypass linking.

**Rules (all mandatory)**

1. **Fresh authentication to both sides.** The Core password is re-entered at the start, and a Core sign-in that is merely recent is **not** enough. The legacy app account's password is checked freshly by that app at completion; an existing app session is **not** enough.
2. **The proof is bound** to the exact Core user, the exact app, the exact app account and the linking action (`action: "link"`).
3. **Short expiry:** a challenge expires after **5 minutes**, and the app's signed proof after **60 s**.
4. **Single use:** a challenge is consumed atomically, and a replay fails.
5. **CSRF protection:** gateway routes are same-origin only, use JSON bodies and the SameSite=Lax Apex session, and the challenge nonce travels in the body.
6. **Rate limits:**
   - per client IP and per Core user at the gateway;
   - the app's existing login limiter and per-account lockout for the legacy credential check;
   - the Core's lockout for the Core password check.
7. **Audit** in the Core for every step:
   - `link.challenge_created`
   - `link.challenge_failed` (reason: wrong Core password, rate limited)
   - `link.confirmed_by_possession`
   - `link.rejected` (expired, replayed, wrong user or app, conflict)
8. **Never** use matching email or name as proof.
9. **Preserve existing records.** The legacy app account row and its history are never modified; linking only adds a confirmed `identity_links` row.
10. **Reject conflicts:**
    - an app account already linked to another Core identity → 409;
    - the Core user already linked to a different account in that app → 409.

## Flow

```
Browser (signed in to Apex, page /link)        Gateway                           Core                          App (showcase|slidesvault)
1  POST /auth/link/start {app, core_password}  same-origin + rate limit
                                               → POST /api/core/link-challenges  re-verify password of sub
                                                 (X-Apex-Service, {sub, app,     → challenge {id, nonce,
                                                  core_password})                   expires_at}; audit
   ← {challenge_id, nonce, expires_at}
2  POST /auth/link/complete                    same-origin + rate limit
   {challenge_id, nonce, app, app_email,       → POST /api/apex/link-proof  ──────────────────────────────→ fresh credential check (no session
    app_password}                                (trusted source only;                                       created), login limiter + lockout;
                                                  {email, password, challenge_id})                          → proof = HMAC(app's audience key)
                                               ← proof                                                         {iss: app id, aud: "apex-link",
                                               verify proof with that app's key                                 app_user_id, challenge_id, iat, exp}
                                               → POST /api/core/identity-links/possession
                                                 (X-Apex-Service, {sub, challenge_id,
                                                  nonce, app, app_user_id})        verify challenge ∈ sub & app,
                                                                                   unexpired, unused → consume;
                                                                                   conflicts → 409; insert
                                                                                   confirmed link (evidence
                                                                                   'possession'); audit
   ← {linked: true, app, app_user_id}
```

### Core

- **New table `link_challenges`**, in migration `010_link_challenges`: `id` PK, `core_user_id` FK→users ON DELETE CASCADE, `app` CHECK in (`showcase`,`slidesvault`), `nonce_hash` (SHA-256), `action` CHECK = `link`, `created_at`, `expires_at`, `used_at` NULL, `outcome` NULL. Add it to the identity rollback.
- **`POST /api/core/link-challenges`** is gateway-service-only:
  - Body `{sub, app, core_password}`.
  - Verifies the password of `sub` with the existing password hashing, applies the Core login lockout, and refuses a disabled user.
  - Creates a challenge: 32-byte nonce, returned once, only its hash stored.
- **`POST /api/core/identity-links/possession`** is gateway-service-only:
  - Body `{sub, challenge_id, nonce, app, app_user_id}`.
  - Checks, in one transaction: the challenge exists, belongs to `sub`, its `app` matches, it is unexpired, `used_at IS NULL`, and the nonce hash matches in constant time. Then it consumes the challenge, whatever the later outcome.
  - Conflict checks as in rule 10. A `proposed` link for the same pair is superseded (marked confirmed).
  - Inserts or updates the confirmed link with `evidence='possession'`, `proposed_by = reviewed_by = sub`. Possession is its own review; ADR 0003 permits it.
  - Links still grant **no roles**.

### Apps (Showcase, SlidesVault)

`POST /api/apex/link-proof`:
- **Available in every identity mode,** including `required`, but **only from `APEX_IDENTITY_TRUSTED_SOURCES`** (the gateway). Anything else gets 403.
- Body `{email, password, challenge_id}`.
- Runs the same credential verification as legacy login, with the same limiter and lockout. It never creates a session or sets a cookie.
- A disabled or guest account gets 403.
- Returns `{proof}`, signed with the app's own audience key (current kid), using the same token format as assertions: `kid.payload.sig`, payload `{iss: <app id>, aud: "apex-link", app_user_id, challenge_id, iat, exp: iat+60}`.
- A Google-only account (no password) cannot prove ownership this way. It returns a clear error; that account needs the Google path.

### Gateway

- **Routes `POST /auth/link/start` and `/auth/link/complete`:**
  - Signed-in Apex session with `sub` required.
  - Same-origin check and JSON only.
  - Rate limit: 5 starts and 10 completes per 15 min per IP and per sub.
  - Linking requires identity keys, so when identity is `off` everywhere the routes answer 503 with a clear message.
  - On `complete`, the gateway verifies the app's proof with that app's key (`iss` = app id, `aud = "apex-link"`, `challenge_id` matches, not expired) before calling the Core.
- **Page `/link`** (static, CSP like the login page): it shows the current Core user and, per app, its link state from Core `/api/core/me`. It has a two-step form: Core password, then app email and password. Passwords are never stored or logged.
- After linking, the resolve cache for that sub is cleared.
