# Security

Written for: whoever operates this deployment and whoever reviews it.

## The credential model

| Credential | Where it lives | Lifetime |
|---|---|---|
| `DROPBOX_APP_KEY` / `DROPBOX_APP_SECRET` | Backend environment only | Until rotated in the App Console |
| `DROPBOX_TOKEN_ENCRYPTION_KEY` | Backend environment / secret manager / KMS | Until rotated (see below) |
| Refresh token | `storage_connection.refresh_token_encrypted`, AES-256-GCM | Until the admin disconnects or Dropbox revokes |
| Access token | Process memory only | Minted on demand, ~4 hours, never written anywhere |
| Session token | `user_session.token_hash` (SHA-256), cookie is http-only | `SESSION_TTL_HOURS` |

The access token is the one to be clear about: it is **never** persisted, never
returned by an API, never logged, and never sent to a browser. A dump of the
database therefore cannot be replayed against Dropbox without also holding the
encryption key, which is not in the database.

## Encryption at rest

`src/crypto/tokenCipher.js`. AES-256-GCM with a fresh 96-bit IV per encryption,
stored as `v1.<iv>.<ciphertext>.<tag>`. The format carries its version so a
future key or algorithm change can read old rows rather than guess at them.

A tampered or truncated row fails the GCM tag check and throws. It is
deliberately not treated as "empty": a silent `""` would look like "not
connected" and quietly hide the fact that stored data was altered.

Generate a key with `npm run keygen`. In production, prefer a secret manager,
KMS or Vault over an environment variable in a file.

### Rotating the encryption key

Rotating makes every stored refresh token unreadable. That is visible, not
silent: the connection reports an error and the message says to reconnect.

1. Set the new key.
2. Restart.
3. An administrator opens Dropbox Settings and presses **Reconnect**.

The indexed catalog is untouched throughout.

## What is never logged

Enforced twice: callers are expected not to pass these, and
`src/util/redact.js` strips them anyway, by key and by pattern, from every log
line and every audit record.

- refresh tokens, access tokens, the app secret, authorization codes
- OAuth `state` values, session tokens, password hashes
- `Authorization` headers, `Set-Cookie`, anything matching `sl.…` or `sk-ant-…`

Audit records say *that* a link was generated, never which URL it was.

## OAuth hardening

- `token_access_type=offline`, so a refresh token is issued and the admin never
  regenerates a token by hand.
- **CSRF**: a random 32-byte `state`, stored only as a SHA-256 hash, expiring in
  `DROPBOX_OAUTH_STATE_TTL_MINUTES`, consumed atomically. A forged, expired or
  replayed state is rejected and the code is never exchanged.
- **Single-use codes**: the authorization code is claimed in the database before
  the exchange. A replayed callback — StrictMode, a refresh, a double click —
  gets the first result instead of an "invalid code" error.
- The callback is the only unauthenticated Dropbox route, because Dropbox calls
  it. The `state` is what authenticates it.

## Serving content

Users never receive a Dropbox URL. `/api/dropbox/files/:id/content` proxies the
bytes through the backend, behind the session check.

Two header policies, because JSON and file bytes have different needs:

- **PDF and images** — no `X-Frame-Options` (it would block the viewer's
  iframe), `frame-ancestors` limited to the configured app origins,
  `nosniff`, `Cross-Origin-Resource-Policy: cross-origin`.
- **Synced HTML** — `Content-Security-Policy: sandbox` *without*
  `allow-same-origin`. A `.html` file in a shared Dropbox folder is untrusted
  content; served as ordinary same-origin markup it could run script on the API
  origin and issue credentialed requests, turning the sync folder into a way to
  call `/api/dropbox/disconnect` as whoever opened the file. An opaque origin
  cannot do that.

Short-lived direct Dropbox links exist only in `AdminDownloadService`, require
the admin role, are audited, and can be switched off entirely with
`DROPBOX_ALLOW_ADMIN_DOWNLOAD=false`.

## RBAC

Enforced server-side on every route. The client also hides admin screens, but
that is a convenience — a client check is advice, a server check is policy.

| | Admin | User |
|---|---|---|
| Connect / reconnect / disconnect Dropbox | ✓ | |
| Select the sync folder, browse folders | ✓ | |
| Run a sync, read sync logs and the audit trail | ✓ | |
| Rename files, mint direct download links | ✓ | |
| Metrics, detailed health | ✓ | |
| Read the library, open a presentation | ✓ | ✓ |

`POST /api/auth/register` always creates a plain user. Roles are granted
deliberately, never self-service.

## Input validation

Nothing from a request body, a query string or an OAuth callback is trusted.

- Ids must match the UUID shape before they reach a query.
- Paths are normalized and then checked: no `..`, no `.`, no control
  characters, no characters Dropbox rejects, length-bounded. Traversal would
  otherwise let a caller escape the configured root, since Dropbox resolves
  paths server-side.
- Object-store keys are `basename()`-reduced and confirmed to resolve inside the
  cache directory.
- All SQL is parameterized. There is no string-built query anywhere.

## Rate limiting

In-memory fixed windows: a general limit, a tighter admin limit, and a strict
one on sign-in keyed by IP *and* the email being tried. Per-instance by design —
a deployment needing exact global limits should enforce them at the ingress.

## Transport and cookies

Set `SESSION_COOKIE_SECURE=true` and serve over https in production. The cookie
is `HttpOnly`, `SameSite=Lax` — Lax specifically, because the OAuth callback is
a top-level cross-site navigation and a `Strict` cookie would not be sent with it.

Serve the app and the API on the same site (one domain, `/api` proxied to the
backend). A cross-site deployment needs `SESSION_COOKIE_SAMESITE=none` with
`secure`, and cross-site cookies are increasingly blocked by browsers.

## Reporting a problem

The audit trail (`GET /api/dropbox/audit`) and the sync log are the first place
to look. Neither contains a credential, so both can be shared with a vendor.
