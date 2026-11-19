/**
 * AES-256-GCM envelope encryption for credentials at rest.
 *
 * Only the Dropbox *refresh* token is ever persisted, and it is persisted
 * through this module. The ciphertext is self-describing so the key can be
 * rotated later without guessing how an old row was written:
 *
 *   v1.<base64 iv>.<base64 ciphertext>.<base64 auth tag>
 *
 * The key never lives in the database or in source — it comes from the
 * environment, a secret manager, KMS or Vault (see docs/SECURITY.md).
 *
 * Rotation: encrypt() always uses the current key (DROPBOX_TOKEN_ENCRYPTION_KEY);
 * decrypt() tries it first and then each retired key from
 * DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS in order, moving on when GCM
 * authentication fails. The envelope is unchanged, so rows written before a
 * rotation keep decrypting; `npm run rewrap-tokens` re-encrypts them under the
 * current key so the previous one can be removed.
 */
import crypto from 'node:crypto';
import { decodeKey } from '../config/index.js';

const VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the size GCM is specified for
const TAG_BYTES = 16;

const toKey = (key) => {
  const bytes = Buffer.isBuffer(key) ? key : decodeKey(key);
  if (!bytes || bytes.length !== 32) {
    throw new Error('TokenCipher requires a 32-byte key (AES-256-GCM).');
  }
  return bytes;
};

export class TokenCipher {
  #key;
  #previous;

  /**
   * @param {string|Buffer} key 32 raw bytes, or a hex/base64 encoding of them
   * @param {(string|Buffer)[]} [previousKeys] retired keys, tried for decryption only
   */
  constructor(key, previousKeys = []) {
    this.#key = toKey(key);
    this.#previous = previousKeys.map(toKey);
  }

  /** Encrypts a UTF-8 secret. Empty input encrypts to empty — nothing to hide. */
  encrypt(plaintext) {
    if (plaintext == null || plaintext === '') return '';
    const iv = crypto.randomBytes(IV_BYTES);
    const cipher = crypto.createCipheriv(ALGORITHM, this.#key, iv);
    const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, iv.toString('base64'), ciphertext.toString('base64'), tag.toString('base64')].join('.');
  }

  /**
   * Decrypts a value produced by encrypt().
   *
   * A tampered or truncated row fails the GCM tag check and throws — a silent
   * "" would look like "not connected" and quietly trigger a re-authorization,
   * hiding the fact that stored data was corrupted.
   */
  decrypt(payload) {
    return this.decryptWithIndex(payload).plaintext;
  }

  /**
   * As decrypt(), also saying which key opened the value: keyIndex 0 is the
   * current key, 1.. the previous keys in order, -1 an empty value.
   */
  decryptWithIndex(payload) {
    if (payload == null || payload === '') return { plaintext: '', keyIndex: -1 };
    const parts = String(payload).split('.');
    if (parts.length !== 4 || parts[0] !== VERSION) {
      throw new Error('Encrypted credential is malformed or written by an unknown key version.');
    }
    const [, ivB64, dataB64, tagB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
      throw new Error('Encrypted credential is malformed.');
    }
    const data = Buffer.from(dataB64, 'base64');
    const keys = [this.#key, ...this.#previous];
    for (let i = 0; i < keys.length; i++) {
      const decipher = crypto.createDecipheriv(ALGORITHM, keys[i], iv, { authTagLength: 16 });
      decipher.setAuthTag(tag);
      try {
        return { plaintext: Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8'), keyIndex: i };
      } catch {
        // GCM authentication failed under this key: try the next one.
      }
    }
    // Wrong key(s), or the row was altered. Never echo the ciphertext.
    throw new Error(
      'Could not decrypt the stored Dropbox credential — the encryption key has changed or the ' +
        'record was tampered with. Reconnect Dropbox to store a fresh credential.'
    );
  }

  /** True when the value looks like something this cipher wrote. */
  static isEncrypted(value) {
    return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
  }
}

/** Generates a fresh key, base64-encoded, for DROPBOX_TOKEN_ENCRYPTION_KEY. */
export function generateKey() {
  return crypto.randomBytes(32).toString('base64');
}
