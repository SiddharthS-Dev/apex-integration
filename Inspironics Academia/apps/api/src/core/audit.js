import crypto from 'node:crypto';

// Append-only audit log (contract §1). There is deliberately no update or delete function: the only
// write is insertAuditEvent, which every Core mutation calls inside its own transaction.

export const ACTOR_KINDS = ['user', 'gateway', 'system', 'cli'];

/** Inserts one audit event with `tx` (a transaction handle or the driver). Returns its id. */
export async function insertAuditEvent(tx, {
  actorUserId = null, actorKind = 'user', action, targetType = null, targetId = null, organizationId = null, detail = null, ip = null,
}) {
  if (!ACTOR_KINDS.includes(actorKind)) throw new Error(`Unknown audit actor kind ${actorKind}`);
  if (!action) throw new Error('Audit action is required');
  const id = crypto.randomUUID();
  await tx.run(
    `INSERT INTO audit_events (id, at, actor_user_id, actor_kind, action, target_type, target_id, organization_id, detail, ip)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, new Date().toISOString(), actorUserId, actorKind, action, targetType, targetId, organizationId,
      detail == null ? null : JSON.stringify(detail), ip],
  );
  return id;
}

/** Lists audit events, newest first. Filters are exact matches. */
export async function listAuditEvents(q, { action, targetId, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (action) { where.push('action = ?'); params.push(String(action)); }
  if (targetId) { where.push('target_id = ?'); params.push(String(targetId)); }
  const lim = Math.min(Math.max(1, Number.parseInt(limit, 10) || 50), 200);
  const off = Math.max(0, Number.parseInt(offset, 10) || 0);
  const rows = await q.query(
    `SELECT * FROM audit_events ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY at DESC, id DESC LIMIT ? OFFSET ?`,
    [...params, lim, off],
  );
  return rows.map((r) => ({ ...r, detail: parseDetail(r.detail) }));
}

function parseDetail(text) {
  if (text == null) return null;
  try { return JSON.parse(text); } catch { return text; }
}
