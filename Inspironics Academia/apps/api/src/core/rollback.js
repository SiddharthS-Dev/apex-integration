// R1 rollback (contract §1): drops the R1 tables (008_core_identity's six, 009's user_session_epochs, 010's
// link_challenges, 011's registration_requests and registration_decoys, and 012's registration_documents;
// children first) and removes the migration and data-migration records. No pre-R1 table was altered by R1,
// so nothing else changes.
// users.role values set after R1 by admins are legitimate pre-R1-compatible data and stay as they are.
// Accounts created by approving a registration request (Use Case 007) are ordinary users rows and stay.
export const CORE_IDENTITY_TABLES = [
  'registration_documents', 'registration_decoys', 'registration_requests', 'link_challenges', 'user_session_epochs', 'audit_events', 'external_identities', 'identity_links',
  'role_assignments', 'organization_memberships', 'organizations',
];
export const CORE_IDENTITY_RECORDS = [
  '008_core_identity', '009_user_session_epochs', '010_link_challenges', '011_registration_requests', '012_registration_documents', 'core_identity_backfill',
];

export async function rollbackIdentity(db) {
  return db.transaction(async (tx) => {
    for (const t of CORE_IDENTITY_TABLES) await tx.exec(`DROP TABLE IF EXISTS ${t}`);
    const r = await tx.run(`DELETE FROM schema_migrations WHERE id IN (${CORE_IDENTITY_RECORDS.map(() => '?').join(', ')})`, CORE_IDENTITY_RECORDS);
    return { tablesDropped: CORE_IDENTITY_TABLES, recordsRemoved: r.changes };
  });
}

// 012 alone: drops registration_documents (the attached files) and its migration record. Access requests
// are untouched; code without the document feature runs on the result. Starting this code again
// recreates the empty table.
export async function rollbackRegistrationDocuments(db) {
  return db.transaction(async (tx) => {
    await tx.exec('DROP TABLE IF EXISTS registration_documents');
    const r = await tx.run('DELETE FROM schema_migrations WHERE id = ?', ['012_registration_documents']);
    return { tablesDropped: ['registration_documents'], recordsRemoved: r.changes };
  });
}
