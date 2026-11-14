/**
 * Migration runner. Called on server start; also runnable on its own:
 *
 *   npm run migrate -w @inspironics/api
 *
 * Each pending migration runs in its own transaction together with the row
 * that records it, so a failure leaves the schema at the last good version.
 * On Postgres the whole pass holds an advisory lock, so two instances booting
 * at once cannot both apply the same migration.
 */
import { pathToFileURL } from 'node:url'
import { loadConfig, loadDotEnv } from '../config.js'
import { createLogger } from '../lib/log.js'
import { MIGRATIONS } from './migrations.js'
import { nowIso, openDatabase } from './index.js'

/** Split a migration into statements (none of ours contain `;` inside a literal). */
const statements = (sql) =>
  sql
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter(Boolean)

export async function migrate(db, log) {
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)')
  const lock = db.dialect === 'postgres' ? await waitForLock(db) : null
  try {
    const done = new Set((await db.all('SELECT id FROM schema_migrations')).map((r) => r.id))
    const pending = MIGRATIONS.filter((m) => !done.has(m.id))
    for (const m of pending) {
      const sql = typeof m.sql === 'string' ? m.sql : m.sql[db.dialect]
      await db.transaction(async (tx) => {
        for (const st of statements(sql)) await tx.run(st)
        await tx.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, nowIso()])
      })
      log?.info('Applied migration', { id: m.id })
    }
    return pending.map((m) => m.id)
  } finally {
    await lock?.release()
  }
}

/**
 * Reverts one migration: runs its `down` SQL and forgets it in
 * schema_migrations, in one transaction. Only the most recently applied
 * migration can be reverted, and only one that ships a `down`.
 *
 *   node src/db/migrate.js --rollback 002_core_user_id
 */
export async function rollbackMigration(db, id, log) {
  const m = MIGRATIONS.find((x) => x.id === id)
  if (!m?.down) throw new Error(`Migration ${id} has no rollback.`)
  const applied = (await db.all('SELECT id FROM schema_migrations')).map((r) => r.id)
  if (!applied.includes(id)) return false
  const later = MIGRATIONS.slice(MIGRATIONS.indexOf(m) + 1).filter((x) => applied.includes(x.id))
  if (later.length) throw new Error(`Roll back ${later.map((x) => x.id).join(', ')} first.`)
  const sql = typeof m.down === 'string' ? m.down : m.down[db.dialect]
  await db.transaction(async (tx) => {
    for (const st of statements(sql)) await tx.run(st)
    await tx.run('DELETE FROM schema_migrations WHERE id = ?', [id])
  })
  log?.info('Rolled back migration', { id })
  return true
}

async function waitForLock(db) {
  for (let i = 0; i < 60; i++) {
    const lock = await db.tryLock('schema-migrations', 60_000)
    if (lock) return lock
    await new Promise((r) => setTimeout(r, 1000))
  }
  throw new Error('Timed out waiting for the migration lock.')
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadDotEnv()
  const config = loadConfig()
  const log = createLogger({ level: 'info' })
  const db = await openDatabase(config, log)
  const at = process.argv.indexOf('--rollback')
  if (at > 0) {
    const id = process.argv[at + 1]
    const done = await rollbackMigration(db, id, log)
    log.info(done ? `Rolled back ${id}` : `${id} is not applied; nothing to roll back`)
  } else {
    const applied = await migrate(db, log)
    log.info(applied.length ? `Applied ${applied.length} migration(s)` : 'Schema is up to date')
  }
  await db.close()
}
