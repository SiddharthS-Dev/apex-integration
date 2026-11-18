import crypto from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { insertAuditEvent } from './audit.js';
import { APP_IDS, can, nowIso } from './identity.js';
import { isUniqueViolation } from './roles.js';

// Reviewed identity links (ADR 0003). A link maps a Core user to an app account. Links never grant
// roles: nothing in this file touches role_assignments or users.

const STATUSES = ['proposed', 'confirmed', 'rejected'];

export async function findLink(q, id) {
  const [row] = await q.query('SELECT * FROM identity_links WHERE id = ?', [id]);
  return row || null;
}

/** { showcase: app_user_id|null, slidesvault: app_user_id|null } from confirmed links. */
export async function confirmedLinkMap(q, userId) {
  const rows = await q.query("SELECT app, app_user_id FROM identity_links WHERE core_user_id = ? AND status = 'confirmed'", [userId]);
  const map = Object.fromEntries(APP_IDS.map((a) => [a, null]));
  for (const r of rows) map[r.app] = r.app_user_id;
  return map;
}

export async function linksForUser(q, userId, { confirmedOnly = false } = {}) {
  return q.query(
    `SELECT * FROM identity_links WHERE core_user_id = ? ${confirmedOnly ? "AND status = 'confirmed'" : ''} ORDER BY proposed_at`,
    [userId],
  );
}

export async function listLinks(q, actor, { status } = {}) {
  if (!can(actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  if (status && !STATUSES.includes(status)) throw badRequest(`status must be one of: ${STATUSES.join(', ')}`);
  return status
    ? q.query('SELECT * FROM identity_links WHERE status = ? ORDER BY proposed_at DESC', [status])
    : q.query('SELECT * FROM identity_links ORDER BY proposed_at DESC');
}

/** POST /identity-links — a platform_admin proposes (evidence admin_review). */
export async function proposeLink(db, actor, body, { ip } = {}) {
  if (!can(actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  const coreUserId = String(body?.core_user_id || '');
  const app = String(body?.app || '');
  const appUserId = String(body?.app_user_id || '').trim();
  const note = body?.note == null ? null : String(body.note).trim().slice(0, 1000) || null;
  if (!coreUserId) throw badRequest('core_user_id is required');
  if (!APP_IDS.includes(app)) throw badRequest(`app must be one of: ${APP_IDS.join(', ')}`);
  if (!appUserId || appUserId.length > 200) throw badRequest('app_user_id is required');
  const [user] = await db.query('SELECT id FROM users WHERE id = ?', [coreUserId]);
  if (!user) throw notFound('User not found');
  const at = nowIso();
  const row = {
    id: crypto.randomUUID(), core_user_id: coreUserId, app, app_user_id: appUserId, status: 'proposed', evidence: 'admin_review',
    proposed_by: actor.id, proposed_at: at, reviewed_by: null, reviewed_at: null, note,
  };
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        `INSERT INTO identity_links (id, core_user_id, app, app_user_id, status, evidence, proposed_by, proposed_at, reviewed_by, reviewed_at, note)
         VALUES (?, ?, ?, ?, 'proposed', 'admin_review', ?, ?, NULL, NULL, ?)`,
        [row.id, coreUserId, app, appUserId, actor.id, at, note],
      );
      await insertAuditEvent(tx, { actorUserId: actor.id, action: 'identity_link.proposed', targetType: 'identity_link', targetId: row.id, detail: { core_user_id: coreUserId, app, app_user_id: appUserId }, ip });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That app account already has an open link');
    throw err;
  }
  return row;
}

/** POST /identity-links/:id/confirm — a platform_admin other than the proposer. */
export async function confirmLink(db, actor, id, body, { ip } = {}) {
  if (!can(actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  const link = await findLink(db, id);
  if (!link) throw notFound('Link not found');
  if (link.status !== 'proposed') throw conflict(`That link is ${link.status}`);
  if (link.proposed_by && link.proposed_by === actor.id) throw forbidden('A different administrator must confirm a link you proposed');
  const note = body?.note == null ? link.note : String(body.note).trim().slice(0, 1000) || link.note;
  try {
    return await db.transaction(async (tx) => {
      const at = nowIso();
      const r = await tx.run("UPDATE identity_links SET status = 'confirmed', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ? AND status = 'proposed'",
        [actor.id, at, note, id]);
      if (!r.changes) throw conflict('That link is no longer proposed');
      await insertAuditEvent(tx, { actorUserId: actor.id, action: 'identity_link.confirmed', targetType: 'identity_link', targetId: id, detail: { core_user_id: link.core_user_id, app: link.app, app_user_id: link.app_user_id }, ip });
      return findLink(tx, id);
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('That user already has a confirmed link for this app');
    throw err;
  }
}

/** POST /identity-links/:id/reject { note } — proposed or confirmed links can be rejected. */
export async function rejectLink(db, actor, id, body, { ip } = {}) {
  if (!can(actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  const note = String(body?.note || '').trim().slice(0, 1000);
  if (!note) throw badRequest('note is required');
  const link = await findLink(db, id);
  if (!link) throw notFound('Link not found');
  if (link.status === 'rejected') throw conflict('That link is already rejected');
  return db.transaction(async (tx) => {
    const at = nowIso();
    const r = await tx.run("UPDATE identity_links SET status = 'rejected', reviewed_by = ?, reviewed_at = ?, note = ? WHERE id = ? AND status <> 'rejected'",
      [actor.id, at, note, id]);
    if (!r.changes) throw conflict('That link is already rejected');
    await insertAuditEvent(tx, { actorUserId: actor.id, action: 'identity_link.rejected', targetType: 'identity_link', targetId: id, detail: { previous_status: link.status, note }, ip });
    return findLink(tx, id);
  });
}
