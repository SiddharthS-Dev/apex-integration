/**
 * Re-encrypts every secret stored at rest under the current ENCRYPTION_KEY, so
 * a retired key (ENCRYPTION_KEY_PREVIOUS) can be removed after a rotation:
 *
 *   npm run rewrap-secrets -w @inspironics/api [-- --dry-run]
 *
 * The only encrypted column is dropbox_connection.refresh_token_enc (one row,
 * AAD 'dropbox-refresh-token'); nothing re-saves it on read or refresh, so this
 * is the way to move it to a new key. No schema change, no migration.
 *
 * Like the migration CLI it prints its target first and refuses the default
 * (real) database unless --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 is given
 * (db/safety.js). It never prints a key or a token.
 */
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { loadConfig, loadDotEnv } from '../config.js'
import { decryptWithIndex, encrypt, parsePreviousKeys, resolveEncryptionKey } from '../lib/crypto.js'
import { createLogger } from '../lib/log.js'
import { nowIso, openDatabase } from './index.js'
import { defaultDbRefusal } from './safety.js'

/** Every encrypted column: table, key column, ciphertext column, AAD. */
export const ENCRYPTED_COLUMNS = [{ table: 'dropbox_connection', id: 'id', column: 'refresh_token_enc', aad: 'dropbox-refresh-token' }]

/**
 * keys = [current, ...previous]. -> { checked, current, rewrapped, changedMeanwhile, failed }
 * where failed lists "table.column#id" for values no key opens (left as they are).
 * Each write is a compare-and-set on the old ciphertext, so a reconnect that
 * happened meanwhile (already under the current key) is not overwritten.
 */
export async function rewrapSecrets(db, keys, { dryRun = false } = {}) {
  const result = { checked: 0, current: 0, rewrapped: 0, changedMeanwhile: 0, failed: [] }
  for (const { table, id, column, aad } of ENCRYPTED_COLUMNS) {
    const rows = await db.all(`SELECT ${id} AS id, ${column} AS enc FROM ${table}`)
    for (const row of rows) {
      if (!row.enc) continue
      result.checked++
      let opened
      try {
        opened = decryptWithIndex(keys, row.enc, aad)
      } catch {
        result.failed.push(`${table}.${column}#${row.id}`)
        continue
      }
      if (opened.keyIndex === 0) {
        result.current++
        continue
      }
      if (!dryRun) {
        const r = await db.run(`UPDATE ${table} SET ${column} = ?, updated_at = ? WHERE ${id} = ? AND ${column} = ?`, [
          encrypt(keys, opened.plaintext, aad),
          nowIso(),
          row.id,
          row.enc,
        ])
        if (!r.changes) {
          result.changedMeanwhile++
          continue
        }
      }
      result.rewrapped++
    }
  }
  return result
}

/** The key ring for the CLI: never generates a development key, and any malformed previous key is fatal. */
function cliKeys(config) {
  if (!config.encryptionKey && !existsSync(config.devKeyFile)) throw new Error('ENCRYPTION_KEY is not set.')
  const { keys, errors } = parsePreviousKeys(config.encryptionKeyPrevious)
  if (errors.length) throw new Error(errors.join(' '))
  return [resolveEncryptionKey(config), ...keys]
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  loadDotEnv()
  const config = loadConfig()
  const log = createLogger({ level: 'warn' })
  console.log(config.db.url ? 'Rewrap target: postgres (DATABASE_URL)' : `Rewrap target: sqlite ${config.db.sqlitePath}`)
  const refusal = config.db.url ? null : defaultDbRefusal(config.db.sqlitePath, { action: 'rewrap secrets in' })
  if (refusal) {
    console.error(refusal)
    process.exit(2)
  }
  const dryRun = process.argv.includes('--dry-run')
  let code = 0
  let db
  try {
    const keys = cliKeys(config)
    db = await openDatabase(config, log)
    const r = await rewrapSecrets(db, keys, { dryRun })
    console.log(JSON.stringify({ ok: r.failed.length === 0, dry_run: dryRun, checked: r.checked, already_current: r.current, rewrapped: r.rewrapped, changed_meanwhile: r.changedMeanwhile, failed: r.failed }))
    if (r.failed.length) {
      console.error(`rewrap-secrets: ${r.failed.length} value(s) open with no configured key; left unchanged`)
      code = 1
    }
  } catch (err) {
    console.error(`rewrap-secrets failed: ${err.message}`)
    code = 1
  } finally {
    await db?.close()
  }
  process.exit(code)
}
