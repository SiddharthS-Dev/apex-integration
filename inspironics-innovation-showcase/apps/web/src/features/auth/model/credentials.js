/**
 * Credential rules and password hashing. Pure domain logic — no storage, no
 * transport, no React.
 */
import { authPolicy } from '#shared/config'

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export const normaliseEmail = (email) => String(email || '').trim().toLowerCase()

export function passwordIssues(pw) {
  const issues = []
  if ((pw || '').length < 8) issues.push('at least 8 characters')
  if (!/[A-Za-z]/.test(pw || '')) issues.push('a letter')
  if (!/\d/.test(pw || '')) issues.push('a number')
  return issues
}

/** The identifier stored on a user record, so a future change is detectable. */
export const KDF = 'pbkdf2-sha256'

const subtle = typeof crypto !== 'undefined' ? crypto.subtle : undefined
const encoder = new TextEncoder()
const toHex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

const fallbackRandomBytes = (bytes) => {
  const values = new Uint8Array(bytes)
  for (let i = 0; i < bytes; i++) values[i] = Math.floor(Math.random() * 256)
  return values
}

export const newSalt = (bytes = 16) => {
  const source = typeof crypto !== 'undefined' && crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(bytes)) : fallbackRandomBytes(bytes)
  return toHex(source)
}

/**
 * Legacy, non-cryptographic digest. Kept only to verify accounts created
 * before PBKDF2 landed, and as the fallback on insecure origins where
 * WebCrypto's subtle API is unavailable.
 */
const legacyDigest = (s) => {
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

let warnedInsecure = false

/** PBKDF2-HMAC-SHA256, used for both passwords and one-time codes. */
export async function hashSecret(secret, salt, iterations = authPolicy.pbkdf2Iterations) {
  if (!subtle) {
    // http:// origins other than localhost have no crypto.subtle at all. Fall
    // back rather than break sign-in, but say so — this is not equivalent.
    if (!warnedInsecure) {
      warnedInsecure = true
      console.warn('crypto.subtle unavailable (insecure origin) — falling back to a weak digest.')
    }
    return legacyDigest(salt + ':' + secret)
  }
  const key = await subtle.importKey('raw', encoder.encode(secret), 'PBKDF2', false, ['deriveBits'])
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: encoder.encode(salt), iterations },
    key,
    256
  )
  return toHex(bits)
}

/** Length-then-content compare that does not short-circuit on the first byte. */
export function sameHash(a = '', b = '') {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Stamp a freshly stretched password onto a user record. */
export async function withNewPassword(user, password) {
  user.salt = newSalt()
  user.iterations = authPolicy.pbkdf2Iterations
  user.kdf = KDF
  user.pw = await hashSecret(password, user.salt, user.iterations)
  return user
}

export async function passwordMatches(user, password) {
  if (user.kdf === KDF) return sameHash(user.pw, await hashSecret(password, user.salt, user.iterations))
  return sameHash(user.pw, legacyDigest(password))
}

/** True when a record still carries the pre-PBKDF2 digest and wants upgrading. */
export const needsRehash = (user) => user.kdf !== KDF
