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
await db.close();
