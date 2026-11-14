/**
 * Applies pending migrations and exits.
 *
 *   npm run migrate
 *
 * The server migrates on startup too; this exists for deployments that run
 * migrations as a separate step before rolling new instances.
 */
import { config, validateConfig } from '../src/config/index.js';
import { createDatabase } from '../src/db/index.js';
import { rollbackMigration } from '../src/db/migrations.js';
import { createLogger } from '../src/util/logger.js';

const cfg = config();
const logger = createLogger({ level: cfg.logLevel });

const { errors } = validateConfig(cfg);
if (errors.length) {
  for (const error of errors) logger.error(error);
  process.exit(1);
}

const db = await createDatabase(cfg, logger);
logger.info('Migrations applied', { driver: cfg.db.driver });

// npm run migrate -- --rollback 005_core_user_id   reverts the latest migration (see docs/SCHEMA.md)
const at = process.argv.indexOf('--rollback');
if (at > 0) {
  const id = process.argv[at + 1];
  const done = await rollbackMigration(db, id, logger);
  logger.info(done ? 'Migration rolled back' : 'Migration was not applied; nothing to roll back', { migration: id });
}
await db.close();
