/**
 * The three pieces of cryptography the API needs, on node:crypto alone.
 *
 * - AES-256-GCM for secrets at rest (the Dropbox refresh token). Authenticated,
 *   so a tampered ciphertext fails to decrypt instead of decrypting to garbage.
 * - scrypt for passwords.
 * - Random opaque tokens, stored only as SHA-256 digests.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

const scrypt = promisify(scryptCb)

/* ------------------------------------------------------------ keys ------ */

/** Parse a 32-byte key given as 64 hex chars or base64. */
export function parseKey(text) {
  const s = String(text || '').trim()
  const buf = /^[0-9a-f]{64}$/i.test(s) ? Buffer.from(s, 'hex') : Buffer.from(s, 'base64')
  if (buf.length !== 32) throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes (64 hex chars or 44 base64 chars).')
  return buf
}

/**
 * The configured key, or — in development only — one generated on first run
 * and kept beside the database, so a restart can still decrypt what it stored.
 */
export function resolveEncryptionKey(config, log) {
  if (config.encryptionKey) return parseKey(config.encryptionKey)
  if (config.isProd) throw new Error('ENCRYPTION_KEY is required in production.')
  const file = config.devKeyFile
  if (existsSync(file)) return parseKey(readFileSync(file, 'utf8'))
  mkdirSync(path.dirname(file), { recursive: true })
  const key = randomBytes(32)
  writeFileSync(file, key.toString('hex'), { mode: 0o600 })
  log?.warn('Generated a development encryption key. Set ENCRYPTION_KEY before deploying.', { file })
  return key
}

/* ------------------------------------------------------ AES-256-GCM ------ */

const VERSION = 'v1'

/** -> "v1.<iv>.<tag>.<ciphertext>", all base64url. `aad` binds the ciphertext to its purpose. */
export function encrypt(key, plaintext, aad = '') {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  if (aad) cipher.setAAD(Buffer.from(aad))
  const body = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.')
}

export function decrypt(key, envelope, aad = '') {
  const [version, iv, tag, body] = String(envelope || '').split('.')
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error('Unrecognised ciphertext format.')
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'))
  if (aad) decipher.setAAD(Buffer.from(aad))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

/* ----------------------------------------------------------- scrypt ------ */

/** OWASP's recommended floor: N=2^17, r=8, p=1. */
const SCRYPT = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }
const KEYLEN = 64

/** -> "scrypt$N$r$p$salt$hash" so parameters can be raised later without breaking old hashes. */
export async function hashPassword(password) {
  const salt = randomBytes(16)
  const hash = await scrypt(String(password), salt, KEYLEN, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$')
}

export async function verifyPassword(password, stored) {
  const [alg, N, r, p, salt, hash] = String(stored || '').split('$')
  if (alg !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64url')
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64url'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

export const needsRehash = (stored) => {
  const [, N, r, p] = String(stored || '').split('$')
  return Number(N) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p
}

/* ----------------------------------------------------------- tokens ------ */

export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')
export const sha256 = (text) => createHash('sha256').update(String(text)).digest('hex')
export const randomId = () => randomBytes(12).toString('base64url')

/** A six-digit code, uniformly distributed. */
export function randomCode() {
  const n = randomBytes(4).readUInt32BE(0) % 1_000_000
  return String(n).padStart(6, '0')
}

/** Constant-time comparison of two strings. */
export function safeEqual(a, b) {
  const x = Buffer.from(String(a))
  const y = Buffer.from(String(b))
  return x.length === y.length && timingSafeEqual(x, y)
}
