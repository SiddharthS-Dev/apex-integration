// R1 rollback (contract §1): drops the R1 Core identity tables and removes the 008_core_identity, 009_user_session_epochs and
// core_identity_backfill records. No pre-R1 table is touched.
//   npm run core:rollback-identity -- --yes
// Back up the database first. Then deploy pre-R1 code: starting this (R1) server again re-applies the
// migration and the backfill, recreating empty Core tables from users.role/users.audience.
import { closeDb, getDb } from '../../db/index.js';
import { rollbackIdentity } from '../index.js';
import { parseArgs } from './args.js';

const args = parseArgs(process.argv.slice(2));
let code = 0;
try {
  if (args.yes !== true) {
    throw Object.assign(new Error('This drops the Core identity tables and their data. Re-run with --yes after taking a backup.'), { status: 400 });
  }
  const db = await getDb();
  const r = await rollbackIdentity(db);
  console.log(JSON.stringify({ ok: true, tables_dropped: r.tablesDropped, records_removed: r.recordsRemoved }));
} catch (err) {
  console.error(`core:rollback-identity failed: ${err.message}`);
  code = err.status && err.status < 500 ? 2 : 1;
} finally {
  await closeDb().catch(() => {});
}
process.exit(code);
