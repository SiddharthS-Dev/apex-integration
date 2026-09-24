/**
 * Postgres driver over `pg` (an optional dependency — only needed when
 * DATABASE_URL is set).
 *
 * Locks are real session-level advisory locks. Each held lock pins one pooled
 * client for its lifetime, because an advisory lock belongs to the session
 * that took it; if the process dies, Postgres drops the session and the lock
 * with it.
 */

/** `?` -> `$1, $2, …`. The SQL in this codebase never has a literal `?`. */
const toPg = (sql) => {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

/** Stable 32-bit key for pg_try_advisory_lock from a lock name. */
function lockKey(name) {
  let h = 0
  for (const ch of name) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0
  return h
}

const bind = (params = []) => params.map((v) => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v))

export async function createPostgresDb(url, log) {
  let pg
  try {
    pg = (await import('pg')).default
  } catch {
    throw new Error('DATABASE_URL is set but the `pg` package is not installed. Run `npm install pg -w @inspironics/api`.')
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 })
  pool.on('error', (error) => log?.error('Postgres pool error', { error }))

  const on = (client) => ({
    all: async (sql, params) => (await client.query(toPg(sql), bind(params))).rows,
    get: async (sql, params) => (await client.query(toPg(sql), bind(params))).rows[0],
    run: async (sql, params) => ({ changes: (await client.query(toPg(sql), bind(params))).rowCount ?? 0 }),
  })

  return {
    dialect: 'postgres',
    ...on(pool),
    exec: async (sql) => {
      await pool.query(sql)
    },

    async transaction(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(on(client))
        await client.query('COMMIT')
        return result
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },

    async tryLock(name) {
      const client = await pool.connect()
      const key = lockKey(name)
      try {
        const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [key])
        if (!rows[0]?.ok) {
          client.release()
          return null
        }
      } catch (error) {
        client.release()
        throw error
      }
      let held = true
      return {
        // the session holds the lock for as long as it lives; nothing to extend
        renew: async () => held,
        release: async () => {
          if (!held) return
          held = false
          try {
            await client.query('SELECT pg_advisory_unlock($1)', [key])
          } finally {
            client.release()
          }
        },
      }
    },

    close: () => pool.end(),
  }
}
