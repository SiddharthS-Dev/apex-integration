import crypto from 'node:crypto';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { insertAuditEvent } from './audit.js';
import { coreConfig } from './config.js';
import { ROLE_CATALOGUE, can, nowIso } from './identity.js';
import { closeAssignment, deny, isUniqueViolation } from './roles.js';

// Organisations and memberships (contract §1, §3). Every query that an org_admin can reach is filtered
// by an organisation the actor administers (cross-organisation isolation).

const KINDS = ['internal', 'partner', 'institution'];
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

export async function findOrganization(q, id) {
  const [row] = await q.query('SELECT * FROM organizations WHERE id = ?', [id]);
  return row || null;
}

/** GET /organizations — platform_admin: all; everyone else: organisations they are an active member of. */
export async function listOrganizations(q, actor) {
  if (can(actor, 'platform.admin')) return q.query('SELECT * FROM organizations ORDER BY name');
  const at = nowIso();
  return q.query(
    `SELECT o.* FROM organizations o JOIN organization_memberships m ON m.organization_id = o.id
      WHERE m.user_id = ? AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to > ?) ORDER BY o.name`,
    [actor.id, at, at],
  );
}

/** POST /organizations (platform_admin). Non-internal kinds are held unless CORE_EXTERNAL_ORGS_ENABLED. */
export async function createOrganization(db, actor, body, { ip } = {}) {
  if (!can(actor, 'platform.admin')) throw forbidden('Platform administrator access required');
  const slug = String(body?.slug || '').trim().toLowerCase();
  const name = String(body?.name || '').trim();
  const kind = String(body?.kind || 'internal');
  if (!SLUG_RE.test(slug)) throw badRequest('slug must be lower-case letters, digits and dashes (max 64)');
  if (!name || name.length > 200) throw badRequest('name is required (max 200 characters)');
  if (!KINDS.includes(kind)) throw badRequest(`kind must be one of: ${KINDS.join(', ')}`);
  if (kind !== 'internal' && !coreConfig().externalOrgsEnabled) {
    throw forbidden('External organisations are not enabled (CORE_EXTERNAL_ORGS_ENABLED)');
  }
  const at = nowIso();
  const row = { id: crypto.randomUUID(), slug, name, kind, status: 'active', created_at: at, updated_at: at };
  try {
    await db.transaction(async (tx) => {
      await tx.run('INSERT INTO organizations (id, slug, name, kind, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [row.id, slug, name, kind, 'active', at, at]);
      await insertAuditEvent(tx, { actorUserId: actor.id, action: 'organization.created', targetType: 'organization', targetId: row.id, organizationId: row.id, detail: { slug, name, kind }, ip });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('An organisation with that slug already exists');
    throw err;
  }
  return row;
}

async function orgForManage(q, actor, orgId) {
  if (!can(actor, 'org.manage', { organizationId: orgId })) throw deny(actor);
  const org = await findOrganization(q, orgId);
  if (!org) throw notFound('Organisation not found');
  return org;
}

/** GET /organizations/:id/members (active memberships, with each member's basic identity). */
export async function listMembers(q, actor, orgId) {
  await orgForManage(q, actor, orgId);
  const at = nowIso();
  return q.query(
    `SELECT m.id, m.organization_id, m.user_id, m.title, m.valid_from, m.valid_to, m.created_by, m.created_at,
            u.email, u.full_name
       FROM organization_memberships m JOIN users u ON u.id = m.user_id
      WHERE m.organization_id = ? AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to > ?)
      ORDER BY u.email`,
    [orgId, at, at],
  );
}

/** POST /organizations/:id/members { user_id, title } */
export async function addMember(db, actor, orgId, body, { ip } = {}) {
  const org = await orgForManage(db, actor, orgId);
  // Adding a member is platform_admin only in R1 (security review M2): an org_admin who could enrol any
  // user by id could pull people across organisations, read their profile, and hand back app access a
  // platform admin had removed. org_admins still manage learner/mentor roles of their existing members.
  if (!actor.isPlatformAdmin) throw forbidden('Only a platform administrator can add organisation members');
  if (org.status !== 'active') throw conflict('That organisation is suspended');
  const userId = String(body?.user_id || '');
  const title = body?.title == null ? null : String(body.title).trim().slice(0, 200) || null;
  if (!userId) throw badRequest('user_id is required');
  const [user] = await db.query('SELECT id FROM users WHERE id = ?', [userId]);
  if (!user) throw notFound('User not found');
  const at = nowIso();
  const row = { id: crypto.randomUUID(), organization_id: orgId, user_id: userId, title, valid_from: at, valid_to: null, created_by: actor.id, created_at: at };
  try {
    await db.transaction(async (tx) => {
      await tx.run(
        'INSERT INTO organization_memberships (id, organization_id, user_id, title, valid_from, valid_to, created_by, created_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)',
        [row.id, orgId, userId, title, at, actor.id, at],
      );
      await insertAuditEvent(tx, { actorUserId: actor.id, action: 'membership.created', targetType: 'membership', targetId: row.id, organizationId: orgId, detail: { user_id: userId, title }, ip });
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw conflict('The user is already a member of that organisation');
    throw err;
  }
  return row;
}

/**
 * POST /memberships/:id/end — ends the membership and, in the same transaction, every open
 * organisation-scoped role assignment the user holds in that organisation. An org_admin may end only
 * memberships whose open roles there they could revoke themselves (learner, mentor).
 */
export async function endMembership(db, actor, membershipId, body, { ip } = {}) {
  const [m] = await db.query('SELECT * FROM organization_memberships WHERE id = ?', [membershipId]);
  if (!m || !can(actor, 'org.manage', { organizationId: m.organization_id })) throw deny(actor);
  if (m.valid_to) throw conflict('That membership has already ended');
  const open = await db.query(
    "SELECT * FROM role_assignments WHERE user_id = ? AND scope_type = 'organization' AND scope_id = ? AND valid_to IS NULL",
    [m.user_id, m.organization_id],
  );
  if (!can(actor, 'platform.admin')) {
    const blocked = open.filter((r) => !ROLE_CATALOGUE[r.role]?.orgAdminGrantable).map((r) => r.role);
    if (blocked.length) throw forbidden(`Only a platform administrator can end this membership (roles: ${blocked.join(', ')})`);
  }
  const reason = body?.reason == null ? null : String(body.reason).trim().slice(0, 1000) || null;
  return db.transaction(async (tx) => {
    const at = nowIso();
    const r = await tx.run('UPDATE organization_memberships SET valid_to = ? WHERE id = ? AND valid_to IS NULL', [at, m.id]);
    if (!r.changes) throw conflict('That membership has already ended');
    const closed = [];
    const stillOpen = await tx.query(
      "SELECT * FROM role_assignments WHERE user_id = ? AND scope_type = 'organization' AND scope_id = ? AND valid_to IS NULL",
      [m.user_id, m.organization_id],
    );
    for (const a of stillOpen) {
      if (await closeAssignment(tx, a.id, { revokedBy: actor.id, reason: reason || 'membership ended', at })) closed.push({ id: a.id, role: a.role });
    }
    await insertAuditEvent(tx, {
      actorUserId: actor.id, action: 'membership.ended', targetType: 'membership', targetId: m.id, organizationId: m.organization_id,
      detail: { user_id: m.user_id, closed_assignments: closed, reason }, ip,
    });
    return { membership: { ...m, valid_to: at }, closed_assignments: closed };
  });
}
