/**
 * Database access.
 *
 * One narrow interface — query / execute / transaction — with two drivers
 * behind it. SQLite (node's built-in, zero native dependencies) is the default
 * so the server runs on a laptop with no setup; PostgreSQL is the same schema
 * for multi-instance deployments.
 *
 * SQL is written once, in the portable subset both engines accept, with `?`
 * placeholders that the Postgres driver rewrites to $1..$n.
 */
import { createSqliteDriver } from './sqliteDriver.js';
import { createPostgresDriver } from './postgresDriver.js';
import { runMigrations } from './migrations.js';

/**
 * @typedef {object} Database
 * @property {'sqlite'|'postgres'} dialect
 * @property {(sql: string, params?: any[]) => Promise<any[]>} query   rows
 * @property {(sql: string, params?: any[]) => Promise<{changes: number}>} execute
 * @property {(sql: string, params?: any[]) => Promise<any|null>} queryOne
 * @property {(fn: (tx: Database) => Promise<any>) => Promise<any>} transaction
 * @property {() => Promise<void>} close
 */

/** Creates and migrates a database for the given config. */
export async function createDatabase(cfg, logger) {
  const db =
    cfg.db.driver === 'postgres'
      ? await createPostgresDriver(cfg, logger)
      : createSqliteDriver(cfg, logger);

  await runMigrations(db, logger);
  return db;
}

export { runMigrations };
