// Role catalogue, active-assignment queries and authorization helpers (contract §2).
// Authorization is server-side and default-deny: `can` returns true only for the cases listed here.

export const APP_IDS = ['showcase', 'slidesvault'];
export const SCOPE_TYPES = ['platform', 'organization', 'app'];

// role -> allowed scope types, and whether an org_admin may grant it inside their own organisation.
export const ROLE_CATALOGUE = Object.freeze({
  platform_admin: { scopes: ['platform'] },
  org_admin: { scopes: ['organization'] },
  staff: { scopes: ['organization'] },
  assessor: { scopes: ['platform', 'organization'] },
  app_admin: { scopes: ['app'] },
  learner: { scopes: ['platform', 'organization'], orgAdminGrantable: true },
  mentor: { scopes: ['platform', 'organization'], orgAdminGrantable: true },
  student: { scopes: ['platform', 'organization'] },
  intern: { scopes: ['platform', 'organization'] },
  alumni: { scopes: ['platform', 'organization'] },
});
export const ROLES = Object.keys(ROLE_CATALOGUE);

export const nowIso = () => new Date().toISOString();
export const isDisabled = (user) => user?.disabled === true || user?.disabled === 1 || user?.disabled === '1';

/** Validates a (role, scope_type, scope_id) triple against the catalogue. Returns an error message or null. */
export function validateRoleScope(role, scopeType, scopeId) {
  const entry = ROLE_CATALOGUE[role];
  if (!entry) return `role must be one of: ${ROLES.join(', ')}`;
  if (!entry.scopes.includes(scopeType)) return `${role} can only be assigned with scope_type ${entry.scopes.join(' or ')}`;
  if (scopeType === 'platform' && scopeId) return 'scope_id must be empty for platform scope';
  if (scopeType !== 'platform' && !scopeId) return 'scope_id is required';
  if (scopeType === 'app' && !APP_IDS.includes(scopeId)) return `scope_id must be one of: ${APP_IDS.join(', ')}`;
  return null;
}

/** Active memberships of a user (in active organisations), with the organisation's slug and name. */
export async function activeMemberships(q, userId, at = nowIso()) {
  return q.query(
    `SELECT m.id, m.organization_id, m.user_id, m.title, m.valid_from, m.valid_to, o.slug AS organization_slug, o.name AS organization_name
       FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to > ?) AND o.status = 'active'
      ORDER BY m.valid_from`,
    [userId, at, at],
  );
}

/** True when the user holds an active membership in the (active) organisation. */
export async function isActiveMember(q, userId, organizationId, at = nowIso()) {
  const rows = await q.query(
    `SELECT m.id FROM organization_memberships m JOIN organizations o ON o.id = m.organization_id
      WHERE m.user_id = ? AND m.organization_id = ? AND m.valid_from <= ? AND (m.valid_to IS NULL OR m.valid_to > ?) AND o.status = 'active'`,
    [userId, organizationId, at, at],
  );
  return rows.length > 0;
}

/**
 * Active role assignments of a user (§2): valid now, the user exists and is not disabled, and for
 * organisation scope the user is an active member of that (active) organisation.
 */
export async function activeAssignments(q, userId, at = nowIso()) {
  const [user] = await q.query('SELECT id, disabled FROM users WHERE id = ?', [userId]);
  if (!user || isDisabled(user)) return [];
  const rows = await q.query(
    `SELECT * FROM role_assignments WHERE user_id = ? AND valid_from <= ? AND (valid_to IS NULL OR valid_to > ?) ORDER BY valid_from`,
    [userId, at, at],
  );
  const orgs = new Set((await activeMemberships(q, userId, at)).map((m) => m.organization_id));
  return rows.filter((r) => r.scope_type !== 'organization' || orgs.has(r.scope_id));
}

/** Everything authorization needs about the acting user, loaded once per request. */
export async function loadActor(q, userId) {
  if (!userId) return null;
  const [user] = await q.query('SELECT id, email, full_name, role, disabled FROM users WHERE id = ?', [userId]);
  if (!user || isDisabled(user)) return null;
  const roles = await activeAssignments(q, userId);
  return {
    id: user.id,
    user,
    roles,
    isPlatformAdmin: roles.some((r) => r.role === 'platform_admin' && r.scope_type === 'platform'),
    orgAdminOf: new Set(roles.filter((r) => r.role === 'org_admin' && r.scope_type === 'organization').map((r) => r.scope_id)),
  };
}

/**
 * Default-deny authorization check.
 *   can(actor, 'platform.admin')                                  platform-wide administration
 *   can(actor, 'org.manage', { organizationId })                 members of one organisation
 *   can(actor, 'role.grant' | 'role.revoke', { role, scopeType, scopeId, targetUserId })
 * Membership and staff grant nothing here (ADR 0004).
 */
export function can(actor, action, scope = {}) {
  if (!actor) return false;
  switch (action) {
    case 'platform.admin':
      return actor.isPlatformAdmin;
    case 'org.manage':
      return actor.isPlatformAdmin || (!!scope.organizationId && actor.orgAdminOf.has(scope.organizationId));
    case 'role.grant':
    case 'role.revoke': {
      const { role, scopeType, scopeId, targetUserId } = scope;
      if (!ROLE_CATALOGUE[role]) return false;
      // Nobody grants themselves platform_admin (break-glass CLI only), and nobody revokes their own,
      // so the last administrator cannot lock everyone out through the API.
      if (role === 'platform_admin' && targetUserId === actor.id) return false;
      if (actor.isPlatformAdmin) return true;
      return !!ROLE_CATALOGUE[role].orgAdminGrantable && scopeType === 'organization' && actor.orgAdminOf.has(scopeId);
    }
    default:
      return false;
  }
}

/** Any administrative power at all (platform_admin or org_admin somewhere). */
export const hasAdminPower = (actor) => !!actor && (actor.isPlatformAdmin || actor.orgAdminOf.size > 0);
