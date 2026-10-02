import { ENTITY_NAMES } from '@academy/shared';
import { log } from '../lib/logger.js';
import { columnsFor, quote, sqlType, tableName } from './schema.js';

// Ordered, append-only core migrations. Entity tables are reconciled separately from the shared schema.
const CORE_MIGRATIONS = [
  {
    id: '001_core_auth',
    sql: (d) => `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT,
        disabled ${d === 'postgres' ? 'BOOLEAN NOT NULL DEFAULT FALSE' : 'INTEGER NOT NULL DEFAULT 0'},
        created_date TEXT NOT NULL,
        updated_date TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS login_history (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT,
        success ${d === 'postgres' ? 'BOOLEAN' : 'INTEGER'} NOT NULL,
        reason TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at);
    `,
  },
  {
    id: '002_settings_locks_sync',
    sql: () => `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS locks (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms ${'INTEGER'},
        discovered INTEGER DEFAULT 0,
        added INTEGER DEFAULT 0,
        updated INTEGER DEFAULT 0,
        unchanged INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        errors TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at);
    `,
  },
  {
    // Profile photo as a small client-resized data URL ('' = none).
    id: '003_user_avatar',
    sql: () => 'ALTER TABLE users ADD COLUMN avatar_url TEXT',
  },
];

async function existingColumns(db, table) {
  if (db.dialect === 'postgres') {
    const rows = await db.query('SELECT column_name FROM information_schema.columns WHERE table_name = ?', [table]);
    return new Set(rows.map((r) => r.column_name));
  }
  const rows = await db.query(`PRAGMA table_info(${quote(table)})`);
  return new Set(rows.map((r) => r.name));
}

// Creates entity tables and adds any columns introduced by schema changes (never drops).
async function reconcileEntityTables(db) {
  for (const entity of ENTITY_NAMES) {
    const table = tableName(entity);
    const cols = columnsFor(entity);
    const defs = cols.map((c) => `${quote(c.name)} ${c.name === 'id' ? 'TEXT PRIMARY KEY' : sqlType(c.kind, db.dialect)}`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${quote(table)} (${defs.join(', ')})`);
    const have = await existingColumns(db, table);
    for (const c of cols) {
      if (!have.has(c.name)) {
        await db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(c.name)} ${sqlType(c.kind, db.dialect)}`);
        log.info('db.column_added', { table, column: c.name });
      }
    }
    for (const c of cols) {
      if (c.name.endsWith('_id') || c.name === 'status' || c.name === 'created_date') {
        await db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`idx_${table}_${c.name}`)} ON ${quote(table)} (${quote(c.name)})`);
      }
    }
  }
}

export async function migrate(db) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.query('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const m of CORE_MIGRATIONS) {
    if (applied.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.sql(db.dialect).split(';').map((s) => s.trim()).filter(Boolean)) await tx.exec(stmt);
      await tx.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()]);
    });
    log.info('db.migration_applied', { id: m.id });
  }
  await reconcileEntityTables(db);
}
