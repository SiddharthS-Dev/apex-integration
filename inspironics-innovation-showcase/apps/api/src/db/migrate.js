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
  const applied = await migrate(db, log)
  log.info(applied.length ? `Applied ${applied.length} migration(s)` : 'Schema is up to date')
  await db.close()
}
