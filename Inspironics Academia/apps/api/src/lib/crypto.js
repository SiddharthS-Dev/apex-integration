import crypto from 'node:crypto';
import { config } from '../config.js';

// AES-256-GCM for secrets at rest (the Dropbox refresh token).
// Envelope: "v1.<iv b64url>.<tag b64url>.<ciphertext b64url>" — random 12-byte IV per message.

const VERSION = 'v1';

// Accepts a 32-byte key as hex (64 chars) or base64/base64url (44/43 chars). Throws a clear error otherwise.
export function parseKey(raw) {
  const s = String(raw || '').trim();
  if (!s) throw new Error('TOKEN_ENCRYPTION_KEY is not set (needs 32 bytes, base64 or hex — e.g. `openssl rand -base64 32`)');
  let key;
  if (/^[0-9a-fA-F]{64}$/.test(s)) key = Buffer.from(s, 'hex');
  else if (/^[A-Za-z0-9+/_-]+={0,2}$/.test(s)) key = Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
  if (!key || key.length !== 32) {
    throw new Error(`TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key ? key.length : 'an undecodable value'}); use \`openssl rand -base64 32\` or 64 hex characters`);
  }
  return key;
}

const defaultKey = () => parseKey(config.tokenEncryptionKey);

export function encrypt(plaintext, key = defaultKey()) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64url'), tag.toString('base64url'), ct.toString('base64url')].join('.');
}

export function decrypt(envelope, key = defaultKey()) {
  const parts = String(envelope || '').split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) throw new Error('Malformed encrypted value');
  const [, ivB, tagB, ctB] = parts;
  const iv = Buffer.from(ivB, 'base64url');
  const tag = Buffer.from(tagB, 'base64url');
  if (iv.length !== 12 || tag.length !== 16) throw new Error('Malformed encrypted value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    throw new Error('Encrypted value failed authentication (wrong key or tampered data)');
  }
}

export const sha256Hex = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
