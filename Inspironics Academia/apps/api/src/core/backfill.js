import { insertAuditEvent } from './audit.js';
import { nowIso } from './identity.js';
import { applyIdentityMapping, ensureInspironics } from './roles.js';

// Data migration core_identity_backfill (contract §1, ADR 0004). Reads users; writes only to the
// 008_core_identity tables, in one transaction, with an audit event per user that gained anything.
// Idempotent: re-running inserts nothing that already exists. users.role is NOT rewritten: the mapping
// follows it (admin -> platform_admin), so the two agree from the start.
export async function coreIdentityBackfill(db) {
  return db.transaction(async (tx) => {
    const at = nowIso();
    const { org, created: orgCreated } = await ensureInspironics(tx, { at, actorKind: 'system' });
    const users = await tx.query('SELECT id, role, audience FROM users ORDER BY created_date, id');
    let usersChanged = 0;
    for (const user of users) {
      const created = await applyIdentityMapping(tx, user, org.id, { grantedVia: 'migration', at });
      if (!created.length) continue;
      usersChanged += 1;
      await insertAuditEvent(tx, {
        actorKind: 'system', action: 'user.backfilled', targetType: 'user', targetId: user.id, organizationId: org.id,
        detail: { migration: 'core_identity_backfill', created },
      });
    }
    return { organization_created: orgCreated, users: users.length, users_changed: usersChanged };
  });
}
