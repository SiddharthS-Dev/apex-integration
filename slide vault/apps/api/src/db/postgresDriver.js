/**
 * PostgreSQL driver — the same interface as the SQLite one, for multi-instance
 * deployments where several app instances share one connection and one catalog.
 *
 * `pg` is an optional dependency: a SQLite-only deployment never installs it,
 * so the import is lazy and the failure message says what to do.
 */

/** Rewrites portable `?` placeholders into Postgres' $1..$n form. */
export function toPgPlaceholders(sql) {
  let index = 0;
  let inSingle = false;
  let out = '';
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'") inSingle = !inSingle;
    if (ch === '?' && !inSingle) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

function bindable(value) {
  if (value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  return value;
}

export async function createPostgresDriver(cfg, logger) {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error(
      'DB_DRIVER=postgres requires the "pg" package. Install it with: npm install pg'
    );
  }

  const pool = new pg.Pool({
    connectionString: cfg.db.url,
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  // Fail fast on a bad DATABASE_URL rather than on the first request.
  const probe = await pool.connect();
  probe.release();
  logger?.info?.('Database ready', { driver: 'postgres' });

  const makeDriver = (executor) => ({
    dialect: 'postgres',
    raw: executor,

    async query(sql, params = []) {
      const result = await executor.query(toPgPlaceholders(sql), params.map(bindable));
      return result.rows;
    },

    async queryOne(sql, params = []) {
      const result = await executor.query(toPgPlaceholders(sql), params.map(bindable));
      return result.rows[0] ?? null;
    },

    async execute(sql, params = []) {
      const result = await executor.query(toPgPlaceholders(sql), params.map(bindable));
      return { changes: result.rowCount ?? 0 };
    },

    async transaction(fn) {
      // A pooled client, so every statement in the callback lands on the same
      // connection — otherwise BEGIN and COMMIT could hit different backends.
      const client = await pool.connect();
      const tx = makeDriver(client);
      tx.transaction = (inner) => inner(tx); // already in one
      try {
        await client.query('BEGIN');
        const result = await fn(tx);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Connection already broken; the pool will discard it.
        }
        throw error;
      } finally {
        client.release();
      }
    },

    async close() {
      await pool.end();
    },
  });

  return makeDriver(pool);
}
