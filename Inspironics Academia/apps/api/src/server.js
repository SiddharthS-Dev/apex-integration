import { config, dropboxConfigured } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { migrate } from './db/migrations.js';
import { purgeExpiredSessions } from './auth/sessions.js';
import { log } from './lib/logger.js';
import { createApp } from './app.js';
import { startScheduler, stopScheduler } from './sync/scheduler.js';
import { SYNC_LOCK } from './sync/pipeline.js';
import { closeStaleRuns } from './sync/log.js';
import { isLocked } from './db/locks.js';
import { list as listEntities, update as updateEntity } from './repo/entities.js';
import { createUser, findUserByEmail } from './repo/users.js';
import { hashPassword, validatePassword } from './auth/passwords.js';

const db = await getDb();
await migrate(db);
await purgeExpiredSessions();
await bootstrapAdmin();

// BOOTSTRAP_ADMIN_EMAIL + BOOTSTRAP_ADMIN_PASSWORD create the administrator at startup, so the account
// exists without anyone registering — the Apex gateway signs in to every app with that one account.
// Only ever creates: re-running must never silently reset the password of a live account.
async function bootstrapAdmin() {
  const email = config.bootstrapAdminEmail;
  const password = config.bootstrapAdminPassword;
  if (!email || !password || (await findUserByEmail(email))) return;
  const problem = validatePassword(password);
  if (problem) return log.warn('auth.bootstrap_admin_refused', { reason: problem });
  await createUser({ email, fullName: config.bootstrapAdminName, role: 'admin', passwordHash: await hashPassword(password) });
  log.info('auth.bootstrap_admin_created', { email });
}
// A sync killed by a restart stays 'running' in sync_log; close it out unless a live run (possibly on
// another instance) still holds the sync lock.
if (!(await isLocked(SYNC_LOCK))) await closeStaleRuns();
// Same for playbook runs: one left 'processing' with no live lock was killed mid-run and would
// otherwise look busy forever. Mark it failed so the Playbook Hub offers a retry.
for (const p of await listEntities('Playbook', { query: { status: 'processing' } })) {
  if (await isLocked(`pipeline:playbook:${p.id}`)) continue;
  await updateEntity('Playbook', p.id, { status: 'failed', error: 'Processing was interrupted (the server restarted). Run it again.' });
  log.warn('pipeline.interrupted_run_closed', { playbook_id: p.id });
}

const app = createApp();
const server = app.listen(config.port, () => {
  log.info('api.listening', {
    port: config.port,
    ai: config.aiEnabled,
    model: config.aiEnabled ? (config.aiProvider === 'base44' ? 'base44' : config.anthropicModel) : undefined,
    media: config.mediaProvider,
    dropbox: dropboxConfigured(),
  });
});

startScheduler();

const sessionSweep = setInterval(() => purgeExpiredSessions().catch(() => {}), 3600_000);
sessionSweep.unref();

async function shutdown(signal) {
  log.info('api.shutdown', { signal });
  stopScheduler();
  server.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
