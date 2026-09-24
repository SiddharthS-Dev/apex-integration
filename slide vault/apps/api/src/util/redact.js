/**
 * Secret redaction.
 *
 * Every log line and every error message that leaves the Dropbox layer goes
 * through here. The rule from the security model is absolute: no access token,
 * refresh token, app secret or authorization code is ever written to a log, a
 * database row, or an API response.
 */

/** Keys whose values are replaced wholesale, wherever they appear in an object. */
export const SECRET_KEYS = new Set([
  'access_token',
  'refresh_token',
  'accesstoken',
  'refreshtoken',
  'client_secret',
  'app_secret',
  'appsecret',
  'authorization',
  'password',
  'code',
  'token',
  'refresh_token_encrypted',
  'dropbox_token_encryption_key',
  'anthropic_api_key',
  'api_key',
  'apikey',
  'secret',
  'cookie',
  'set-cookie',
  'state',
  'state_hash',
  'password_hash',
  'session_token',
]);

const PLACEHOLDER = '[redacted]';

/**
 * Patterns that catch secrets embedded in free text — an error message that
 * quotes a request body, say, where key-based redaction cannot reach.
 */
const TEXT_PATTERNS = [
  // Bearer tokens in headers or quoted error bodies.
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, `Bearer ${PLACEHOLDER}`],
  // Dropbox short-lived and refresh tokens (they carry a recognisable prefix).
  [/\bsl\.[A-Za-z0-9._-]{16,}/g, PLACEHOLDER],
  // Anthropic keys.
  [/\bsk-ant-[A-Za-z0-9._-]{8,}/g, PLACEHOLDER],
  // key=value / "key": "value" forms for any known secret name.
  [
    /("?(?:access_token|refresh_token|client_secret|code|password|api_key)"?\s*[:=]\s*"?)([^"&,\s}]{4,})/gi,
    (_m, head) => `${head}${PLACEHOLDER}`,
  ],
];

/** Redacts secrets inside a free-text string. */
export function redactText(input) {
  if (typeof input !== 'string' || !input) return input;
  let out = input;
  for (const [pattern, replacement] of TEXT_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Deep-redacts a value for logging. Objects are copied, never mutated, so a
 * redacted log line can never corrupt the object the caller is still using.
 */
export function redact(value, seen = new WeakSet()) {
  if (value == null) return value;
  if (typeof value === 'string') return redactText(value);
  if (typeof value !== 'object') return value;

  if (seen.has(value)) return '[circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((item) => redact(item, seen));

  if (value instanceof Error) {
    return { name: value.name, message: redactText(value.message), code: value.code };
  }
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `[buffer ${value.length}b]`;

  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEYS.has(key.toLowerCase()) ? PLACEHOLDER : redact(item, seen);
  }
  return out;
}
