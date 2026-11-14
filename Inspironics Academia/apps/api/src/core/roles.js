import crypto from 'node:crypto';
import { HttpError, badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { insertAuditEvent } from './audit.js';
import { ROLE_CATALOGUE, can, hasAdminPower, isActiveMember, isDisabled, nowIso, validateRoleScope } from './identity.js';

// Scoped, dated role assignments (contract §1–§3). Every mutation runs in one transaction with its
// audit event, and keeps users.role in step with platform_admin: 'admin' while an open platform_admin
// assignment exists, otherwise 'user'.

export const INSPIRONICS_SLUG = 'inspironics';

export function isUniqueViolation(err) {
  return err?.code === '23505' || /UNIQUE constraint failed/i.test(String(err?.message || ''));
}

/** Refusal that does not reveal objects outside the actor's organisations: 404 for admins, 403 otherwise. */
export const deny = (actor) => (hasAdminPower(actor) ? notFound('Not found') : forbidden('Not allowed'));

/** Sets users.role from the open platform_admin assignments. Returns the role now stored. */
export async function syncUserRole(tx, userId) {
  const open = await tx.query(
    "SELECT id FROM role_assignments WHERE user_id = ? AND role = 'platform_admin' AND scope_type = 'platform' AND valid_to IS NULL",
    [userId],
  );
  const role = open.length ? 'admin' : 'user';
  await tx.run('UPDATE users SET role = ?, updated_date = ? WHERE id = ? AND role <> ?', [role, nowIso(), userId, role]);
  return role;
}

/** Inserts an open assignment (no checks — callers authorise). Returns the row. */
export async function insertAssignment(tx, { userId, role, scopeType, scopeId = '', grantedBy = null, grantedVia, reason = null, at = nowIso() }) {
  const row = {
    id: crypto.randomUUID(), user_id: userId, role, scope_type: scopeType, scope_id: scopeId || '', valid_from: at, valid_to: null,
    granted_by: grantedBy, granted_via: grantedVia, revoked_by: null, reason, created_at: at,
  };
  await tx.run(
    `INSERT INTO role_assignments (id, user_id, role, scope_type, scope_id, valid_from, valid_to, granted_by, granted_via, revoked_by, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, NULL, ?, ?)`,
    [row.id, userId, role, scopeType, row.scope_id, at, grantedBy, grantedVia, reason, at],
  );
  return row;
}

/** Closes an open assignment (valid_to = at). History stays in the table. */
export async function closeAssignment(tx, id, { revokedBy = null, reason = null, at = nowIso() } = {}) {
  const r = await tx.run(
    'UPDATE role_assignments SET valid_to = ?, revoked_by = ?, reason = COALESCE(?, reason) WHERE id = ? AND valid_to IS NULL',
    [at, revokedBy, reason, id],
  );
  return r.changes > 0;
}

export async function findAssignment(q, id) {
  const [row] = await q.query('SELECT * FROM role_assignments WHERE id = ?', [id]);
  return row || null;
}

async function findOpen(q, userId, role, scopeType, scopeId = '') {
  const [row] = await q.query(
    'SELECT * FROM role_assignments WHERE user_id = ? AND role = ? AND scope_type = ? AND scope_id = ? AND valid_to IS NULL',
    [userId, role, scopeType, scopeId],
  );
  return row || null;
}

const reasonText = (r) => (r == null ? null : String(r).trim().slice(0, 1000) || null);

/** POST /role-assignments */
export async function grantRole(db, actor, body, { ip } = {}) {
  const userId = String(body?.user_id || '');
  const role = String(body?.role || '');
  const scopeType = String(body?.scope_type || '');
  const scopeId = body?.scope_id == null ? '' : String(body.scope_id);
  const problem = validateRoleScope(role, scopeType, scopeId);
  if (!userId) throw badRequest('user_id is required');
  if (problem) throw badRequest(problem);
  if (!can(actor, 'role.grant', { role, scopeType, scopeId, targetUserId: userId })) {
    if (role === 'platform_admin' && userId === actor?.id) throw forbidden('You cannot grant platform_admin to yourself');
    if (scopeType === 'organization' && actor?.orgAdminOf.has(scopeId)) throw forbidden(`An org_admin cannot grant ${role}`);
    // Platform and app scopes hide nothing; another organisation's scope is not revealed (404).
    if (scopeType !== 'organization') throw forbidden(`You cannot grant ${role}`);
    throw deny(actor);
  }
  const [target] = await db.query('SELECT id, disabled FROM users WHERE id = ?', [userId]);
  if (!target) throw notFound('User not found');
  if (scopeType === 'organization') {
    const [org] = await db.query('SELECT id, status FROM organizations WHERE id = ?', [scopeId]);
    if (!org) throw notFound('Organisation not found');
    if (!(await isActiveMember(db, userId, scopeId))) throw badRequest('The user is not an active member of that organisation');
  }
  try {
    return await db.transaction(async (tx) => {
      const row = await insertAssignment(tx, { userId, role, scopeType, scopeId, grantedBy: actor.id, grantedVia: 'api', reason: reasonText(body?.reason) });
      if (role === 'platform_admin') await syncUserRole(tx, userId);
      await insertAuditEvent(tx, {
        actorUserId: actor.id, action: 'role.granted', targetType: 'role_assignment', targetId: row.id,
        organizationId: scopeType === 'organization' ? scopeId : null, detail: { user_id: userId, role, scope_type: scopeType, scope_id: row.scope_id, reason: row.reason }, ip,
      });
      return row;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('The user already holds that role in that scope');
    throw err;
  }
}

async function loadOpenForChange(db, actor, id, action) {
  const row = await findAssignment(db, id);
  if (!row) throw deny(actor);
  const scope = { role: row.role, scopeType: row.scope_type, scopeId: row.scope_id, targetUserId: row.user_id };
  if (!can(actor, action, scope)) {
    if (row.role === 'platform_admin' && row.user_id === actor?.id) throw forbidden('You cannot remove your own platform_admin role');
    if (row.scope_type === 'organization' && actor?.orgAdminOf.has(row.scope_id)) throw forbidden(`An org_admin cannot change ${row.role}`);
    throw deny(actor);
  }
  if (row.valid_to) throw conflict('That assignment has already ended');
  return row;
}

/** POST /role-assignments/:id/revoke */
export async function revokeRole(db, actor, id, body, { ip } = {}) {
  const row = await loadOpenForChange(db, actor, id, 'role.revoke');
  const reason = reasonText(body?.reason);
  return db.transaction(async (tx) => {
    const at = nowIso();
    if (!(await closeAssignment(tx, row.id, { revokedBy: actor.id, reason, at }))) throw conflict('That assignment has already ended');
    if (row.role === 'platform_admin') await syncUserRole(tx, row.user_id);
    await insertAuditEvent(tx, {
      actorUserId: actor.id, action: 'role.revoked', targetType: 'role_assignment', targetId: row.id,
      organizationId: row.scope_type === 'organization' ? row.scope_id : null, detail: { user_id: row.user_id, role: row.role, reason }, ip,
    });
    return findAssignment(tx, row.id);
  });
}

/** POST /role-assignments/:id/transition — closes the old assignment and opens the new one atomically. */
export async function transitionRole(db, actor, id, body, { ip } = {}) {
  const row = await loadOpenForChange(db, actor, id, 'role.revoke');
  const toRole = String(body?.to_role || '');
  if (toRole === row.role) throw badRequest('to_role must differ from the current role');
  const problem = validateRoleScope(toRole, row.scope_type, row.scope_id);
  if (problem) throw badRequest(problem);
  if (!can(actor, 'role.grant', { role: toRole, scopeType: row.scope_type, scopeId: row.scope_id, targetUserId: row.user_id })) {
    if (toRole === 'platform_admin' && row.user_id === actor.id) throw forbidden('You cannot grant platform_admin to yourself');
    throw forbidden(`You cannot grant ${toRole}`);
  }
  const reason = reasonText(body?.reason);
  try {
    return await db.transaction(async (tx) => {
      const at = nowIso();
      if (!(await closeAssignment(tx, row.id, { revokedBy: actor.id, reason, at }))) throw conflict('That assignment has already ended');
      const next = await insertAssignment(tx, {
        userId: row.user_id, role: toRole, scopeType: row.scope_type, scopeId: row.scope_id, grantedBy: actor.id, grantedVia: 'api', reason, at,
      });
      if (row.role === 'platform_admin' || toRole === 'platform_admin') await syncUserRole(tx, row.user_id);
      await insertAuditEvent(tx, {
        actorUserId: actor.id, action: 'role.transitioned', targetType: 'role_assignment', targetId: next.id,
        organizationId: row.scope_type === 'organization' ? row.scope_id : null,
        detail: { user_id: row.user_id, from_role: row.role, to_role: toRole, from_assignment_id: row.id, reason }, ip,
      });
      return { closed: await findAssignment(tx, row.id), opened: next };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict(`The user already holds ${toRole} in that scope`);
    throw err;
  }
}

// ---- ADR 0004 mapping (backfill and new accounts) ------------------------------------------------

export async function ensureInspironics(tx, { at = nowIso(), actorKind = 'system', actorUserId = null } = {}) {
  const [org] = await tx.query('SELECT * FROM organizations WHERE slug = ?', [INSPIRONICS_SLUG]);
  if (org) return { org, created: false };
  const row = { id: crypto.randomUUID(), slug: INSPIRONICS_SLUG, name: 'Inspironics', kind: 'internal', status: 'active', created_at: at, updated_at: at };
  await tx.run('INSERT INTO organizations (id, slug, name, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [row.id, row.slug, row.name, row.kind, row.status, at, at]);
  await insertAuditEvent(tx, { actorUserId, actorKind, action: 'organization.created', targetType: 'organization', targetId: row.id, organizationId: row.id, detail: { slug: row.slug, kind: row.kind } });
  return { org: row, created: true };
}

/**
 * Applies the ADR 0004 table to one user, inserting only what is missing:
 *   audience employee|leadership -> Inspironics membership + staff (organization)
 *   audience intern              -> Inspironics membership (title Intern) + intern (organization), no staff
 *   role admin -> platform_admin (platform);  role user -> learner (platform)
 * Returns the list of things created.
 */
export async function applyIdentityMapping(tx, user, orgId, { grantedVia, grantedBy = null, at = nowIso() }) {
  const created = [];
  const audience = String(user.audience || '');
  const member = ['employee', 'leadership', 'intern'].includes(audience);
  if (member) {
    const [open] = await tx.query('SELECT id FROM organization_memberships WHERE organization_id = ? AND user_id = ? AND valid_to IS NULL', [orgId, user.id]);
    if (!open) {
      await tx.run(
        'INSERT INTO organization_memberships (id, organization_id, user_id, title, valid_from, valid_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
        [crypto.randomUUID(), orgId, user.id, audience === 'intern' ? 'Intern' : null, at, grantedBy, at],
      );
      created.push('membership');
    }
    const orgRole = audience === 'intern' ? 'intern' : 'staff';
    if (!(await findOpen(tx, user.id, orgRole, 'organization', orgId))) {
      await insertAssignment(tx, { userId: user.id, role: orgRole, scopeType: 'organization', scopeId: orgId, grantedBy, grantedVia, at });
      created.push(orgRole);
    }
  }
  const platformRole = user.role === 'admin' ? 'platform_admin' : user.role === 'user' ? 'learner' : null;
  if (platformRole && !(await findOpen(tx, user.id, platformRole, 'platform', ''))) {
    await insertAssignment(tx, { userId: user.id, role: platformRole, scopeType: 'platform', scopeId: '', grantedBy, grantedVia, at });
    created.push(platformRole);
  }
  return created;
}

/**
 * New accounts (register, invite, bootstrap admin) get the same mapping as the backfill, so a person
 * invited after R1 is represented exactly like one who existed before it.
 */
export async function provisionNewUser(db, user, { actorUserId = null, actorKind = actorUserId ? 'user' : 'system', ip = null } = {}) {
  return db.transaction(async (tx) => {
    const at = nowIso();
    const { org } = await ensureInspironics(tx, { at, actorKind, actorUserId });
    const created = await applyIdentityMapping(tx, user, org.id, { grantedVia: 'api', grantedBy: actorUserId, at });
    if (created.includes('platform_admin')) await syncUserRole(tx, user.id);
    if (created.length) {
      await insertAuditEvent(tx, { actorUserId, actorKind, action: 'user.provisioned', targetType: 'user', targetId: user.id, organizationId: org.id, detail: { created }, ip });
    }
    return created;
  });
}

/**
 * Legacy user-admin path (PATCH /api/entities/User/:id with role): sets users.role and opens or closes
 * the platform_admin assignment in the same transaction, with an audit event.
 */
export async function setLegacyRole(db, userId, role, { actorUserId, ip = null } = {}) {
  if (!['admin', 'user'].includes(role)) throw badRequest('role must be admin or user');
  if (role === 'admin' && userId === actorUserId) {
    const [me] = await db.query('SELECT role FROM users WHERE id = ?', [userId]);
    if (me?.role !== 'admin') throw forbidden('You cannot grant platform_admin to yourself');
  }
  return db.transaction(async (tx) => {
    const [user] = await tx.query('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) throw notFound();
    const open = await findOpen(tx, userId, 'platform_admin', 'platform', '');
    const at = nowIso();
    if (role === 'admin' && !open) {
      const row = await insertAssignment(tx, { userId, role: 'platform_admin', scopeType: 'platform', grantedBy: actorUserId, grantedVia: 'api', reason: 'user admin: role set to admin', at });
      await insertAuditEvent(tx, { actorUserId, action: 'role.granted', targetType: 'role_assignment', targetId: row.id, detail: { user_id: userId, role: 'platform_admin', via: 'user_admin' }, ip });
    } else if (role === 'user' && open) {
      await closeAssignment(tx, open.id, { revokedBy: actorUserId, reason: 'user admin: role set to user', at });
      await insertAuditEvent(tx, { actorUserId, action: 'role.revoked', targetType: 'role_assignment', targetId: open.id, detail: { user_id: userId, role: 'platform_admin', via: 'user_admin' }, ip });
    }
    await syncUserRole(tx, userId);
    return role;
  });
}

/** Break-glass (CLI): grants platform_admin with granted_via 'cli', audited with actor_kind 'cli'. */
export async function grantAdminBreakGlass(db, { email, reason }) {
  const cleanEmail = String(email || '').trim().toLowerCase();
  const why = reasonText(reason);
  if (!cleanEmail) throw new HttpError(400, '--email is required');
  if (!why) throw new HttpError(400, '--reason is required');
  const [user] = await db.query('SELECT id, email, disabled FROM users WHERE email = ?', [cleanEmail]);
  if (!user) throw new HttpError(404, `No user with email ${cleanEmail}`);
  if (isDisabled(user)) throw new HttpError(409, 'That account is disabled; enable it first');
  return db.transaction(async (tx) => {
    const open = await findOpen(tx, user.id, 'platform_admin', 'platform', '');
    if (open) {
      await syncUserRole(tx, user.id);
      return { userId: user.id, assignmentId: open.id, alreadyAdmin: true };
    }
    const row = await insertAssignment(tx, { userId: user.id, role: 'platform_admin', scopeType: 'platform', grantedVia: 'cli', reason: why });
    await syncUserRole(tx, user.id);
    await insertAuditEvent(tx, {
      actorKind: 'cli', action: 'role.granted', targetType: 'role_assignment', targetId: row.id,
      detail: { user_id: user.id, role: 'platform_admin', break_glass: true, reason: why },
    });
    return { userId: user.id, assignmentId: row.id, alreadyAdmin: false };
  });
}

export const ROLE_NAMES = Object.keys(ROLE_CATALOGUE);
