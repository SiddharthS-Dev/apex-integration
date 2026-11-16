// R1 rollback (contract §1): drops the R1 tables (008_core_identity's six, 009's user_session_epochs and 010's link_challenges; children first) and removes the
// migration and data-migration records. No pre-R1 table was altered by R1, so nothing else changes.
// users.role values set after R1 by admins are legitimate pre-R1-compatible data and stay as they are.
export const CORE_IDENTITY_TABLES = [
  'link_challenges', 'user_session_epochs', 'audit_events', 'external_identities', 'identity_links', 'role_assignments', 'organization_memberships', 'organizations',
];
export const CORE_IDENTITY_RECORDS = ['008_core_identity', '009_user_session_epochs', '010_link_challenges', 'core_identity_backfill'];

export async function rollbackIdentity(db) {
  return db.transaction(async (tx) => {
    for (const t of CORE_IDENTITY_TABLES) await tx.exec(`DROP TABLE IF EXISTS ${t}`);
    const r = await tx.run(`DELETE FROM schema_migrations WHERE id IN (${CORE_IDENTITY_RECORDS.map(() => '?').join(', ')})`, CORE_IDENTITY_RECORDS);
    return { tablesDropped: CORE_IDENTITY_TABLES, recordsRemoved: r.changes };
  });
}
