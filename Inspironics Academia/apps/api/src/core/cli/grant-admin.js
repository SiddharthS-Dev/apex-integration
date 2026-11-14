// Break-glass: grant platform_admin from the server's shell (contract §3).
//   npm run core:grant-admin -- --email <email> --reason "<why>"
// The only way past the "never self" rule when no second administrator exists. Recorded with
// granted_via='cli' and an audit event with actor_kind='cli'. Uses the same DATABASE_URL/SQLITE_PATH
// as the server (.env), and applies pending migrations first so the Core tables exist.
import { closeDb, getDb } from '../../db/index.js';
import { migrate } from '../../db/migrations.js';
import { grantAdminBreakGlass } from '../index.js';
import { parseArgs } from './args.js';

const args = parseArgs(process.argv.slice(2));
let code = 0;
try {
  if (typeof args.email !== 'string' || typeof args.reason !== 'string') {
    throw Object.assign(new Error('Usage: npm run core:grant-admin -- --email <email> --reason "<why>"'), { status: 400 });
  }
  const db = await getDb();
  await migrate(db);
  const r = await grantAdminBreakGlass(db, { email: args.email, reason: args.reason });
  console.log(JSON.stringify({ ok: true, user_id: r.userId, assignment_id: r.assignmentId, already_admin: r.alreadyAdmin }));
} catch (err) {
  console.error(`core:grant-admin failed: ${err.message}`);
  code = err.status && err.status < 500 ? 2 : 1;
} finally {
  await closeDb().catch(() => {});
}
process.exit(code);
