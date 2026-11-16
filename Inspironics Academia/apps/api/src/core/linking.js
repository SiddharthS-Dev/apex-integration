import crypto from 'node:crypto';
import { findUserById } from '../repo/users.js';
import { verifyPassword } from '../auth/passwords.js';
import { clearFailures, lockedFor, lockoutKey, noteFailure } from '../auth/lockout.js';
import { insertAuditEvent } from './audit.js';
import { APP_IDS, isDisabled, nowIso } from './identity.js';
import { isUniqueViolation } from './roles.js';

// Account-holder ownership proof (R1 linking addendum, ADR 0003 item 4). Both entry points are called
// by the gateway only (the route checks the service assertion first). Never uses email or name as
// proof: the Core user is `sub` (from the gateway's Apex session) plus a fresh Core password, and the
// app account is the app_user_id the app vouched for with its signed proof (verified by the gateway).
// Links grant no roles: nothing here touches role_assignments or users.

export const CHALLENGE_TTL_MS = 5 * 60_000;
const NONCE_BYTES = 32;
const MAX_ID = 200;

const sha256Hex = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const str = (v) => (typeof v === 'string' ? v : '');

/** Outcome of a linking call: HTTP status and JSON body (the route sends it as is). */
const out = (status, body, headers) => ({ status, body, headers });
const refusal = (status, reason, error, extra = {}) => out(status, { error, reason, ...extra });

const audit = (q, action, { sub, targetType = 'link_challenge', targetId = null, detail, ip }) => insertAuditEvent(q, {
  actorUserId: sub || null, actorKind: 'gateway', action, targetType, targetId, detail, ip,
});

/**
 * POST /api/core/link-challenges { sub, app, core_password }.
 * 201 { id, challenge_id, nonce, app, expires_at } — the nonce is returned only here; only its SHA-256 is stored.
 */
export async function createLinkChallenge(db, body, { ip = null } = {}) {
  const sub = str(body?.sub);
  const app = str(body?.app);
  const password = body?.core_password;
  if (!sub || sub.length > MAX_ID) return refusal(400, 'invalid_request', 'sub is required');
  if (!APP_IDS.includes(app)) return refusal(400, 'invalid_request', `app must be one of: ${APP_IDS.join(', ')}`);
  if (typeof password !== 'string' || !password || password.length > 1024) return refusal(400, 'invalid_request', 'core_password is required');

  const user = await findUserById(sub);
  if (!user || isDisabled(user)) {
    await audit(db, 'link.challenge_failed', { sub, targetType: 'user', targetId: sub, detail: { app, reason: 'user_inactive' }, ip });
    return refusal(403, 'user_inactive', 'This account is not active', { active: false });
  }
  const key = lockoutKey(user.email);
  const wait = lockedFor(key);
  if (wait) {
    await audit(db, 'link.challenge_failed', { sub, targetType: 'user', targetId: sub, detail: { app, reason: 'rate_limited' }, ip });
    return out(429, { error: 'Too many failed password attempts for this account. Try again in 15 minutes.', reason: 'rate_limited' },
      { 'Retry-After': String(Math.ceil(wait / 1000)) });
  }
  if (!(await verifyPassword(password, user.password_hash))) {
    noteFailure(key);
    await audit(db, 'link.challenge_failed', { sub, targetType: 'user', targetId: sub, detail: { app, reason: 'wrong_core_password' }, ip });
    return refusal(401, 'wrong_core_password', 'Core password is incorrect');
  }
  clearFailures(key);

  const nonce = crypto.randomBytes(NONCE_BYTES).toString('base64url');
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + CHALLENGE_TTL_MS).toISOString();
  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO link_challenges (id, core_user_id, app, nonce_hash, action, created_at, expires_at, used_at, outcome)
       VALUES (?, ?, ?, ?, 'link', ?, ?, NULL, NULL)`,
      [id, sub, app, sha256Hex(nonce), createdAt.toISOString(), expiresAt],
    );
    await audit(tx, 'link.challenge_created', { sub, targetId: id, detail: { app, expires_at: expiresAt }, ip });
  });
  return out(201, { id, challenge_id: id, nonce, app, expires_at: expiresAt });
}

function nonceMatches(nonce, storedHashHex) {
  const given = Buffer.from(sha256Hex(nonce), 'hex');
  const expected = Buffer.from(String(storedHashHex || ''), 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * POST /api/core/identity-links/possession { sub, challenge_id, nonce, app, app_user_id }.
 * In one transaction: the challenge exists, belongs to sub, is unused (else 409 replayed); then it is
 * consumed whatever the outcome (expired 410, wrong app/nonce 403, inactive user 403, conflict 409);
 * on success a confirmed link (evidence 'possession', proposed_by = reviewed_by = sub) is inserted, or
 * the matching proposed link is superseded.
 */
export async function confirmLinkByPossession(db, body, { ip = null } = {}) {
  const sub = str(body?.sub);
  const challengeId = str(body?.challenge_id);
  const nonce = str(body?.nonce);
  const app = str(body?.app);
  const appUserId = str(body?.app_user_id).trim();
  if (!sub || sub.length > MAX_ID) return refusal(400, 'invalid_request', 'sub is required');
  if (!challengeId || challengeId.length > MAX_ID) return refusal(400, 'invalid_request', 'challenge_id is required');
  if (!nonce || nonce.length > 256) return refusal(400, 'invalid_request', 'nonce is required');
  if (!APP_IDS.includes(app)) return refusal(400, 'invalid_request', `app must be one of: ${APP_IDS.join(', ')}`);
  if (!appUserId || appUserId.length > MAX_ID) return refusal(400, 'invalid_request', 'app_user_id is required');

  const detail = (reason, extra = {}) => ({ reason, challenge_id: challengeId, app, app_user_id: appUserId, ...extra });
  let consumedFor = null; // set once the challenge row is consumed (for the unique-violation fallback)
  try {
    return await db.transaction(async (tx) => {
      const [ch] = await tx.query('SELECT * FROM link_challenges WHERE id = ?', [challengeId]);
      if (!ch) {
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('unknown_challenge'), ip });
        return refusal(404, 'unknown_challenge', 'Unknown link challenge');
      }
      if (ch.core_user_id !== sub) {
        // Not this user's challenge: refused, and not consumed (its owner's flow is unaffected).
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('wrong_user'), ip });
        return refusal(403, 'wrong_user', 'This link challenge belongs to another user');
      }
      if (ch.used_at) {
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('replayed'), ip });
        return refusal(409, 'replayed', 'This link challenge has already been used');
      }
      const at = nowIso();
      const [user] = await tx.query('SELECT id, disabled FROM users WHERE id = ?', [sub]);
      let reason = null;
      if (ch.expires_at <= at) reason = 'expired';
      else if (ch.app !== app) reason = 'wrong_app';
      else if (!nonceMatches(nonce, ch.nonce_hash)) reason = 'wrong_nonce';
      else if (!user || isDisabled(user)) reason = 'user_inactive';

      // Consume atomically: only one attempt can flip used_at, a concurrent one sees 0 changes.
      const consumed = await tx.run('UPDATE link_challenges SET used_at = ?, outcome = ? WHERE id = ? AND used_at IS NULL',
        [at, reason || 'confirmed', challengeId]);
      if (!consumed.changes) {
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('replayed'), ip });
        return refusal(409, 'replayed', 'This link challenge has already been used');
      }
      consumedFor = challengeId;
      if (reason) {
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail(reason), ip });
        if (reason === 'expired') return refusal(410, 'expired', 'This link challenge has expired');
        if (reason === 'wrong_app') return refusal(403, 'wrong_app', 'This link challenge was issued for another app');
        if (reason === 'wrong_nonce') return refusal(403, 'wrong_nonce', 'Link challenge verification failed');
        return refusal(403, 'user_inactive', 'This account is not active', { active: false });
      }

      // Rule 10 conflicts.
      const [existing] = await tx.query("SELECT * FROM identity_links WHERE app = ? AND app_user_id = ? AND status <> 'rejected'", [app, appUserId]);
      const [mine] = await tx.query("SELECT * FROM identity_links WHERE core_user_id = ? AND app = ? AND status = 'confirmed'", [sub, app]);
      let conflictReason = null;
      if (existing && existing.core_user_id !== sub) conflictReason = 'app_account_linked_elsewhere';
      else if (mine && mine.app_user_id !== appUserId) conflictReason = 'core_user_linked_elsewhere';
      if (conflictReason) {
        await tx.run("UPDATE link_challenges SET outcome = 'conflict' WHERE id = ?", [challengeId]);
        await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('conflict', { conflict: conflictReason }), ip });
        return refusal(409, conflictReason, conflictReason === 'app_account_linked_elsewhere'
          ? 'That app account is already linked to another APEX account'
          : 'Your APEX account is already linked to a different account in that app');
      }

      let linkId;
      let result;
      if (existing && existing.status === 'confirmed') {
        linkId = existing.id; // already confirmed for this pair: nothing to change
        result = 'already_confirmed';
      } else if (existing) {
        linkId = existing.id; // a proposed link for the same pair: superseded by the possession proof
        result = 'superseded_proposed';
        await tx.run(
          `UPDATE identity_links SET status = 'confirmed', evidence = 'possession', proposed_by = ?, reviewed_by = ?, reviewed_at = ?
            WHERE id = ? AND status = 'proposed'`,
          [sub, sub, at, linkId],
        );
      } else {
        linkId = crypto.randomUUID();
        result = 'created';
        await tx.run(
          `INSERT INTO identity_links (id, core_user_id, app, app_user_id, status, evidence, proposed_by, proposed_at, reviewed_by, reviewed_at, note)
           VALUES (?, ?, ?, ?, 'confirmed', 'possession', ?, ?, ?, ?, NULL)`,
          [linkId, sub, app, appUserId, sub, at, sub, at],
        );
      }
      await audit(tx, 'link.confirmed_by_possession', {
        sub,
        targetType: 'identity_link',
        targetId: linkId,
        detail: {
          challenge_id: challengeId, core_user_id: sub, app, app_user_id: appUserId, result,
          ...(result === 'superseded_proposed' ? { previous_evidence: existing.evidence, previous_proposed_by: existing.proposed_by } : {}),
        },
        ip,
      });
      return out(200, { linked: true, app, app_user_id: appUserId, link_id: linkId, evidence: result === 'already_confirmed' ? existing.evidence : 'possession', result });
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // A concurrent link won the race; the transaction rolled back, so consume the challenge on its own.
    await db.transaction(async (tx) => {
      await tx.run("UPDATE link_challenges SET used_at = ?, outcome = 'conflict' WHERE id = ? AND core_user_id = ? AND used_at IS NULL",
        [nowIso(), consumedFor || challengeId, sub]);
      await audit(tx, 'link.rejected', { sub, targetId: challengeId, detail: detail('conflict', { conflict: 'concurrent_link' }), ip });
    });
    return refusal(409, 'conflict', 'That app account or your APEX account was linked concurrently');
  }
}
