import crypto from 'node:crypto';
import { HttpError, conflict } from '../lib/errors.js';
import { insertAuditEvent } from './audit.js';
import { nowIso } from './identity.js';
import { isUniqueViolation } from './roles.js';

// Google sign-in by verified (provider, subject) only — never by email (ADR 0003 §6).
// The ID token is verified with Google's tokeninfo endpoint, as the Showcase does
// (inspironics-innovation-showcase/apps/api/src/routes/auth.js, verifyGoogleCredential). The verifier is
// injectable so tests never call Google. email_verified is deliberately irrelevant: the email is not used.

const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

/** Default verifier: returns { sub } or throws a 401. */
export async function verifyWithTokeninfo(credential, clientId, { fetchImpl = fetch } = {}) {
  if (typeof credential !== 'string' || !credential || credential.length > 4096) throw new HttpError(401, 'Google sign-in failed');
  let info;
  try {
    const res = await fetchImpl(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
    if (!res.ok) throw new Error(`tokeninfo ${res.status}`);
    info = await res.json();
  } catch {
    throw new HttpError(401, 'Google sign-in failed');
  }
  if (!info || info.aud !== clientId) throw new HttpError(401, 'Google sign-in failed');
  if (!GOOGLE_ISSUERS.includes(info.iss)) throw new HttpError(401, 'Google sign-in failed');
  if (!(Number(info.exp) > Date.now() / 1000)) throw new HttpError(401, 'Google sign-in failed');
  if (typeof info.sub !== 'string' || !info.sub) throw new HttpError(401, 'Google sign-in failed');
  return { sub: info.sub };
}

let verifier = verifyWithTokeninfo;

/** Tests replace the verifier: fn(credential, clientId) -> { sub } | throws. Pass nothing to restore. */
export function setGoogleVerifier(fn) {
  verifier = fn || verifyWithTokeninfo;
}

export async function verifyGoogleCredential(credential, clientId) {
  try {
    const out = await verifier(credential, clientId);
    if (!out || typeof out.sub !== 'string' || !out.sub) throw new Error('no subject');
    return { sub: out.sub };
  } catch {
    throw new HttpError(401, 'Google sign-in failed');
  }
}

/** The Core user for a Google subject, or null. Matches only on (provider, subject). */
export async function userForGoogleSubject(q, sub) {
  const [row] = await q.query(
    "SELECT u.* FROM external_identities e JOIN users u ON u.id = e.user_id WHERE e.provider = 'google' AND e.subject = ?",
    [sub],
  );
  return row || null;
}

/**
 * Links (google, sub) to userId inside `tx`, with an audit event. Idempotent for the same user;
 * 409 when the subject belongs to someone else.
 */
export async function linkGoogleIdentity(tx, userId, sub, { actorUserId = userId, ip = null, via = 'possession' } = {}) {
  const [existing] = await tx.query("SELECT * FROM external_identities WHERE provider = 'google' AND subject = ?", [sub]);
  if (existing) {
    if (existing.user_id !== userId) throw conflict('That Google account is linked to another user');
    return { id: existing.id, created: false };
  }
  const at = nowIso();
  const id = crypto.randomUUID();
  try {
    await tx.run('INSERT INTO external_identities (id, user_id, provider, subject, verified_at, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, userId, 'google', sub, at, at]);
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That Google account is linked to another user');
    throw err;
  }
  await insertAuditEvent(tx, { actorUserId, action: 'external_identity.linked', targetType: 'external_identity', targetId: id, detail: { user_id: userId, provider: 'google', via }, ip });
  return { id, created: true };
}

export async function externalIdentityProviders(q, userId) {
  return q.query('SELECT id, provider, verified_at, created_at FROM external_identities WHERE user_id = ? ORDER BY created_at', [userId]);
}
