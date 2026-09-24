/**
 * One-time verification and reset codes.
 *
 * The record produced here is what a repository persists: a salted hash and an
 * attempt counter, never the code. Turning a failure into a sentence is the
 * service's job, so this layer returns a reason rather than a message.
 */
import { authPolicy } from '#shared/config'
import { hashSecret, newSalt, sameHash } from './credentials.js'

export const newCode = () => String(Math.floor(100000 + Math.random() * 900000))

/**
 * @returns {Promise<{code: string, record: object}>} the plaintext code (to be
 * emailed, or shown by the demo) and the record to store.
 */
export async function createCodeRecord(email, ttlMs) {
  const code = newCode()
  const salt = newSalt(8)
  return {
    code,
    record: { email, salt, hash: await hashSecret(code, salt), attempts: 0, expiresAt: Date.now() + ttlMs },
  }
}

/**
 * @returns {Promise<{ok: true, record: object} | {ok: false, reason: 'expired'|'locked'|'wrong', attemptsLeft: number, record: object}>}
 */
export async function checkCodeRecord(record, code) {
  if (record.expiresAt < Date.now()) return { ok: false, reason: 'expired', attemptsLeft: 0, record }
  if ((record.attempts || 0) >= authPolicy.maxCodeAttempts) {
    return { ok: false, reason: 'locked', attemptsLeft: 0, record }
  }
  if (sameHash(record.hash, await hashSecret(String(code).trim(), record.salt))) return { ok: true, record }

  const attempts = (record.attempts || 0) + 1
  const attemptsLeft = authPolicy.maxCodeAttempts - attempts
  const next = { ...record, attempts }
  return attemptsLeft <= 0
    ? { ok: false, reason: 'locked', attemptsLeft: 0, record: next }
    : { ok: false, reason: 'wrong', attemptsLeft, record: next }
}
