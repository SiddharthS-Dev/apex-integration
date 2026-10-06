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
import { get as getEntity, list as listEntities, update as updateEntity } from './repo/entities.js';
import { lessonLockName } from './pipeline/util.js';
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

// A lesson left 'generating' with no live lock was being generated when its server stopped, and the
// Studio would show it busy forever. Put it back so Generate is offered again. Runs at startup and
// every few minutes, because on SQLite a killed run's lock only lapses when its lease expires.
async function releaseInterruptedLessons() {
  for (const l of await listEntities('Lesson', { query: { status: 'generating' } })) {
    if (await isLocked(lessonLockName(l.id))) continue;
    const fresh = await getEntity('Lesson', l.id); // the run may have finished since the list
    if (fresh?.status !== 'generating') continue;
    const status = String(fresh.teaching_script || '').trim() ? 'pending_review' : 'pending';
    await updateEntity('Lesson', l.id, { status });
    log.warn('pipeline.interrupted_lesson_released', { lesson_id: l.id, status });
  }
}
await releaseInterruptedLessons();

const app = createApp();
const server = app.listen(config.port, config.host, () => {
  log.info('api.listening', {
    host: config.host,
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

const lessonSweep = setInterval(() => releaseInterruptedLessons().catch(() => {}), 5 * 60_000);
lessonSweep.unref();

async function shutdown(signal) {
  log.info('api.shutdown', { signal });
  stopScheduler();
  server.close();
  await closeDb();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
