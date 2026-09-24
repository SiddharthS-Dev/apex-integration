/**
 * Server entry point.
 *
 * Startup order matters, and each step is a gate:
 *   validate config -> migrate -> build the container -> reclaim stale state
 *   -> listen -> start the scheduler
 *
 * "Reclaim stale state" is the restart-resilience step: a container that was
 * killed mid-sync left a `running` sync log and a held advisory lock behind,
 * and a fresh process must clear them or the dashboard will claim a sync is in
 * flight forever (spec §64).
 */
import { config, validateConfig } from './config/index.js';
import { createDatabase } from './db/index.js';
import { createLogger } from './util/logger.js';
import { createContainer, bootstrapAdmin } from './container.js';
import { createApp } from './app.js';

async function main() {
  const cfg = config();
  const logger = createLogger({ level: cfg.logLevel });

  /* ------------------------------------------------- 1. configuration */
  const { errors, warnings } = validateConfig(cfg);
  for (const warning of warnings) logger.warn(warning);
  if (errors.length) {
    for (const error of errors) logger.error(error);
    logger.error('Refusing to start with an invalid configuration.');
    process.exit(1);
  }

  /* ----------------------------------------- 2. database and migrations */
  const db = await createDatabase(cfg, logger);

  /* ------------------------------------------------------ 3. container */
  const container = createContainer({ config: cfg, db, logger });
  await bootstrapAdmin({ config: cfg, users: container.users, logger });

  /* ------------------------------------------------- 4. reclaim state */
  const reclaimed = await container.syncLogs.failStaleRuns(cfg.sync.lockTtlMinutes * 60_000);
  if (reclaimed) logger.warn('Marked sync runs abandoned by a previous process', { count: reclaimed });
  await container.connections.ensure('dropbox');
  // A sync_status of "running" that survived a restart is not true any more.
  const connection = await container.connections.get('dropbox');
  if (connection?.sync_status === 'running' && !(await container.sync.isRunning())) {
    await container.connections.update('dropbox', { sync_status: 'idle' });
  }

  /* --------------------------------------------------------- 5. listen */
  const app = createApp(container);
  const server = app.listen(cfg.port, () => {
    logger.info('SlidesVault API listening', {
      port: cfg.port,
      env: cfg.nodeEnv,
      db: cfg.db.driver,
      appBaseUrl: cfg.appBaseUrl,
      redirectUri: cfg.dropbox.redirectUri,
    });
  });

  /* ------------------------------------------------------ 6. scheduler */
  container.scheduler.start();

  /* ------------------------------------------------------- 7. shutdown */
  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Shutting down', { signal });

    container.scheduler.stop();
    server.close(() => logger.info('HTTP server closed'));

    // A sync in flight holds a lock with a TTL, so it is safe to exit without
    // waiting for it — the next process reclaims it. What must not happen is
    // hanging forever on an in-flight request.
    const timer = setTimeout(() => {
      logger.warn('Forcing exit after the shutdown grace period.');
      process.exit(0);
    }, 10_000);
    timer.unref();

    try {
      await db.close();
    } catch (error) {
      logger.warn('Database did not close cleanly', { error: error.message });
    }
    clearTimeout(timer);
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled promise rejection', { error: reason?.message ?? String(reason) });
  });
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception — exiting', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  return { app, server, container };
}

main().catch((error) => {
  // The logger may not exist yet if config() itself threw.
  console.error('[slidesvault] Startup failed:', error);
  process.exit(1);
});
