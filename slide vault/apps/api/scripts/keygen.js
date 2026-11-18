/**
 * Prints a fresh AES-256 key for DROPBOX_TOKEN_ENCRYPTION_KEY.
 *
 *   npm run keygen
 *
 * To rotate, keep the old key in DROPBOX_TOKEN_ENCRYPTION_KEY_PREVIOUS so the
 * stored refresh token stays readable, then run `npm run rewrap-tokens` — see
 * docs/SECURITY.md.
 */
import { generateKey } from '../src/crypto/tokenCipher.js';

const key = generateKey();
process.stdout.write(`DROPBOX_TOKEN_ENCRYPTION_KEY=${key}\n`);
