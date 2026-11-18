import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM for secrets at rest (the Dropbox refresh token).
// Envelope: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>" — random 12-byte IV per message.
//
// Key rotation: TOKEN_ENCRYPTION_KEY is the current key (every encrypt uses it); retired keys go in
// TOKEN_ENCRYPTION_KEY_PREVIOUS, comma-separated. Decrypt tries the current key, then each previous key
// in order, moving on when GCM authentication fails. The envelope does not change, so ciphertext written
// before a rotation keeps decrypting. `npm run rewrap-secrets` re-encrypts stored values under the
// current key, after which the previous key can be removed (docs/operations/STAGING_RUNBOOK.md).

const VERSION = 'v1';
export const KEY_ENV = 'TOKEN_ENCRYPTION_KEY';
export const PREVIOUS_KEY_ENV = 'TOKEN_ENCRYPTION_KEY_PREVIOUS';

// Accepts a 32-byte key as hex (64 chars) or base64/base64url (44/43 chars). Throws a clear error otherwise.
// The message names the variable, never the value.
export function parseKey(raw, name = KEY_ENV) {
  const s = String(raw || '').trim();
  if (!s) throw new Error(`${name} is not set (needs 32 bytes, base64 or hex — e.g. \`openssl rand -base64 32\`)`);
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(s)) key = Buffer.from(s, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) key = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!key || key.length !== 32) {
    throw new Error(`${name} must decode to exactly 32 bytes (got ${key ? key.length : 'an undecodable value'}); use \`openssl rand -base64 32\` or 64 hex characters`);
  }
  return key;
}

/**
 * Parses TOKEN_ENCRYPTION_KEY_PREVIOUS: zero or more keys, comma-separated, each validated like the main
 * key. Returns { keys, errors }: the valid keys in order, and one message per malformed entry.
 */
export function parsePreviousKeys(raw, name = PREVIOUS_KEY_ENV) {
  const keys = [];
  const errors = [];
  const entries = String(raw || '').split(',').map((s) => s.trim()).filter(Boolean);
  entries.forEach((entry, i) => {
    try {
      keys.push(parseKey(entry, entries.length > 1 ? `${name} entry ${i + 1}` : name));
    } catch (err) {
      errors.push(err.message);
    }
  });
  return { keys, errors };
}

/** [current, ...previous] from the configuration. Malformed previous keys are skipped (start-up reports them). */
export function configuredKeys(cfg = config) {
  return [parseKey(cfg.tokenEncryptionKey), ...parsePreviousKeys(cfg.tokenEncryptionKeyPrevious).keys];
}

const defaultKeys = () => configuredKeys();
const keyList = (key) => (Array.isArray(key) ? key : [key]);

/** Encrypts under `key` — a Buffer, or a key list whose first entry is the current key. */
export function encrypt(plaintext, key = defaultKeys()) {
  const current = keyList(key)[0];
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', current, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

/**
 * Decrypts with the first key (of a Buffer or key list) that authenticates the envelope.
 * Returns { plaintext, keyIndex } — keyIndex 0 is the current key.
 */
export function decryptWithIndex(envelope, key = defaultKeys()) {
  const parts = String(envelope || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Malformed encrypted value');
  const [, ivB, tagB, ctB] = parts;
  const iv = Buffer.from(ivB, 'base64url');
  const tag = Buffer.from(tagB, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Malformed encrypted value');
  const ct = Buffer.from(ctB, 'base64url');
  const keys = keyList(key);
  for (let i = 0; i < keys.length; i++) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', keys[i], iv);
    decipher.setAuthTag(tag);
    try {
      return { plaintext: Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8'), keyIndex: i };
    } catch {
      // GCM authentication failed under this key: try the next one.
    }
  }
  throw new Error('Encrypted value failed authentication (wrong key or tampered data)');
}

export function decrypt(envelope, key = defaultKeys()) {
  return decryptWithIndex(envelope, key).plaintext;
}

export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
