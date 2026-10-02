import { config } from '../config.js';
import { log } from '../lib/logger.js';
import { createSqliteDriver } from './sqlite.js';
import { createPostgresDriver } from './postgres.js';

let driver;

// Returns the process-wide database driver: { dialect, query, run, exec, transaction, close }.
export async function getDb() {
  if (driver) return driver;
  if (config.databaseUrl) {
    driver = await createPostgresDriver(config.databaseUrl);
    log.info('db.connected', { dialect: 'postgres' });
  } else {
    driver = createSqliteDriver(config.sqlitePath);
    log.info('db.connected', { dialect: 'sqlite', file: config.sqlitePath });
  }
  return driver;
}

export function db() {
  if (!driver) throw new Error('Database not initialised — call getDb() at startup');
  return driver;
}

export async function closeDb() {
  if (driver) await driver.close();
  driver = undefined;
}
