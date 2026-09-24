/**
 * Migrations against an *existing* database, not just a fresh one.
 *
 * A fresh install exercises every migration together, which hides the failure
 * mode that actually matters in production: an upgrade landing on a database
 * that already holds a live connection and a full catalog.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { buildConfig } from '../../src/config/index.js';
import { createSqliteDriver } from '../../src/db/sqliteDriver.js';
import { MIGRATIONS, runMigrations } from '../../src/db/migrations.js';
import { nullLogger } from '../../src/util/logger.js';
import { TEST_KEY } from '../helpers/testEnv.js';

const config = () =>
  buildConfig({ DB_DRIVER: 'sqlite', DB_FILE: ':memory:', DROPBOX_TOKEN_ENCRYPTION_KEY: TEST_KEY });

/** A database at migration 001 only — what a deployment predating 002 looks like. */
async function databaseAtV1() {
  const db = createSqliteDriver(config(), nullLogger);
  await db.execute(
    'CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)'
  );
  await db.transaction(async (tx) => {
    for (const statement of MIGRATIONS[0].statements) await tx.execute(statement);
    await tx.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
      MIGRATIONS[0].id,
      new Date().toISOString(),
    ]);
  });
  return db;
}

test('upgrading a live database preserves the connection and the catalog', async (t) => {
  const db = await databaseAtV1();
  t.after(() => db.close());

  await db.execute(
    `INSERT INTO storage_connection
       (id, provider, refresh_token_encrypted, root_folder, account_email, connection_status, created_at, updated_at)
     VALUES ('c1', 'dropbox', 'v1.iv.data.tag', '/Decks', 'admin@example.com', 'connected', 't', 't')`
  );
  await db.execute(
    `INSERT INTO stored_file (id, provider, external_id, name, title, created_at, updated_at)
     VALUES ('f1', 'dropbox', 'id:ABC', 'Deck.pdf', 'Quarterly Review', 't', 't')`
  );

  await runMigrations(db, nullLogger);

  const connection = await db.queryOne('SELECT * FROM storage_connection WHERE id = ?', ['c1']);
  assert.equal(connection.refresh_token_encrypted, 'v1.iv.data.tag', 'the credential survives');
  assert.equal(connection.root_folder, '/Decks', 'the configured folder survives');

  // Blank, not populated: an established sync must keep its path semantics
  // until an administrator reconnects deliberately.
  assert.equal(connection.root_namespace_id, '');
  assert.equal(connection.home_namespace_id, '');
  assert.equal(connection.home_path, '');

  const file = await db.queryOne('SELECT * FROM stored_file WHERE id = ?', ['f1']);
  assert.equal(file.title, 'Quarterly Review', 'the catalog survives');
});

test('migrations are idempotent — a restart re-runs them harmlessly', async (t) => {
  const db = await databaseAtV1();
  t.after(() => db.close());

  await runMigrations(db, nullLogger);
  await runMigrations(db, nullLogger);
  await runMigrations(db, nullLogger);

  const applied = (await db.query('SELECT id FROM schema_migrations ORDER BY id')).map((row) => row.id);
  assert.deepEqual(applied, MIGRATIONS.map((migration) => migration.id));
  assert.equal(new Set(applied).size, applied.length, 'no migration is recorded twice');
});

test('every migration id is unique and append-only in order', () => {
  const ids = MIGRATIONS.map((migration) => migration.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate migration id');
  assert.deepEqual([...ids].sort(), ids, 'migrations must be listed in applied order');
});
