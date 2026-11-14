// Public surface of the Core identity module. Other modules import only from here (ADR 0001 §2).
import { db } from '../db/index.js';
import { log } from '../lib/logger.js';
import { provisionNewUser, setLegacyRole } from './roles.js';
import { insertAuditEvent } from './audit.js';

export { default as coreRoutes } from './routes.js';
export { coreIdentityBackfill } from './backfill.js';
export { rollbackIdentity, CORE_IDENTITY_TABLES, CORE_IDENTITY_RECORDS } from './rollback.js';
export { grantAdminBreakGlass } from './roles.js';
export { ROLE_CATALOGUE, ROLES, can, loadActor, activeAssignments } from './identity.js';
export { setGoogleVerifier } from './google.js';
export { signAssertion, verifyServiceAssertion, parseKeys } from './service.js';

/**
 * A new account was created (register, invite, bootstrap admin): give it the ADR 0004 membership and
 * roles. Failure is logged, never fatal — the account still works through users.role, and the next
 * startup's backfill is not re-run, so an operator can fix it with the Core API.
 */
export async function onUserCreated(user, { actorUserId = null, ip = null } = {}) {
  try {
    return await provisionNewUser(db(), user, { actorUserId, ip });
  } catch (err) {
    log.error('core.provision_failed', { userId: user?.id, error: err.message });
    return [];
  }
}

/** Legacy user admin changed users.role: set it together with the platform_admin assignment. */
export function setUserRole(userId, role, { actorUserId, ip = null } = {}) {
  return setLegacyRole(db(), userId, role, { actorUserId, ip });
}

/** Records a legacy user-admin action (delete, disable) in the Core audit log. */
export async function auditUserAdmin(action, { actorUserId, targetId, detail = null, ip = null }) {
  return insertAuditEvent(db(), { actorUserId, action, targetType: 'user', targetId, detail, ip });
}
