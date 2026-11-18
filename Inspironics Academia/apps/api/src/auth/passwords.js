import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
// OWASP's floor for scrypt: N=2^17, r=8, p=1 (128 MiB). Older hashes (N=2^14) still verify, carry their own
// parameters, and are upgraded on the next successful sign-in (needsRehash).
const PARAMS = { N: 2 ** 17, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;
const KEYLEN = 64;
// Stored parameters above this are refused rather than computed (a corrupt row cannot exhaust memory).
const MAX_N = 2 ** 20;

// Format: scrypt$N$r$p$salt(b64)$hash(b64)
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { ...PARAMS, maxmem: MAXMEM });
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

export async function verifyPassword(password, stored) {
  if (!stored || typeof password !== 'string') return false;
  const [algo, N, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const n = Number(N), rr = Number(r), pp = Number(p);
  if (!Number.isInteger(n) || n < 2 || n > MAX_N || !Number.isInteger(rr) || rr < 1 || rr > 32 || !Number.isInteger(pp) || pp < 1 || pp > 16) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, { N: n, r: rr, p: pp, maxmem: MAXMEM });
  return crypto.timingSafeEqual(expected, actual);
}

/** True when a stored hash was made with other parameters than today's, so it should be re-made. */
export function needsRehash(stored) {
  const [algo, N, r, p] = String(stored || '').split('$');
  return algo !== 'scrypt' || Number(N) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Password must be at least 8 characters';
  if (password.length > 256) return 'Password is too long';
  return null;
}

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
