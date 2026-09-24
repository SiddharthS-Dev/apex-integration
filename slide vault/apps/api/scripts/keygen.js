/**
 * Prints a fresh AES-256 key for DROPBOX_TOKEN_ENCRYPTION_KEY.
 *
 *   npm run keygen
 *
 * Rotating this key makes every stored refresh token unreadable, which shows
 * up as "reconnect Dropbox" rather than as silent breakage — see
 * docs/SECURITY.md before rotating in production.
 */
import { generateKey } from '../src/crypto/tokenCipher.js';

const key = generateKey();
process.stdout.write(`DROPBOX_TOKEN_ENCRYPTION_KEY=${key}\n`);
