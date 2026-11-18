import { parseKey, parsePreviousKeys } from './lib/crypto.js';

// Start-up configuration checks. `errors` stop a production server before it listens (server.js);
// `warnings` are logged. Pure: takes the env and the resolved config, so it is testable on its own.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
export const BOOTSTRAP_ADMIN_MIN_PRODUCTION = 12;

/** True when an origin/URL names this machine only (plain http there is not a network exposure). */
export function isLoopbackOrigin(url) {
  try {
    return LOOPBACK.has(new URL(url).hostname.toLowerCase());
  } catch {
    return false;
  }
}

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v || '').trim());

export function startupProblems(env = process.env, cfg) {
  const errors = [];
  const warnings = [];
  const production = env.NODE_ENV === 'production';
  const local = isLoopbackOrigin(cfg.appOrigin);

  // Session cookies must be Secure wherever the browser reaches us over a network.
  if (production && !cfg.cookieSecure && !local) {
    errors.push(`COOKIE_SECURE is off but the app is served from ${cfg.appOrigin}: serve it over https and set COOKIE_SECURE=true`);
  }

  // A malformed encryption key would otherwise surface only on the first Dropbox connect.
  if (cfg.tokenEncryptionKey) {
    try {
      parseKey(cfg.tokenEncryptionKey);
    } catch (err) {
      (production ? errors : warnings).push(err.message);
    }
  }
  // Retired keys (TOKEN_ENCRYPTION_KEY_PREVIOUS): a malformed one would leave older ciphertext unreadable.
  for (const message of parsePreviousKeys(cfg.tokenEncryptionKeyPrevious).errors) {
    (production ? errors : warnings).push(message);
  }

  // The bootstrap admin becomes platform_admin: in production its password must be long.
  if (production && cfg.bootstrapAdminPassword && cfg.bootstrapAdminPassword.length < BOOTSTRAP_ADMIN_MIN_PRODUCTION) {
    const msg = `BOOTSTRAP_ADMIN_PASSWORD must be at least ${BOOTSTRAP_ADMIN_MIN_PRODUCTION} characters in production`;
    // On a loopback-only deployment (start.bat prod) it is refused for creation but does not stop the server.
    (local ? warnings : errors).push(msg);
  }

  if (production && truthy(env.EMAIL_LOG_SECRETS) && !['resend', 'smtp', 'emailjs'].includes(cfg.email?.provider)) {
    warnings.push('EMAIL_LOG_SECRETS=true: password-reset and invitation links are written to the production log');
  }
  return { errors, warnings };
}
