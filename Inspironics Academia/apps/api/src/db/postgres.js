// Postgres driver (production). `pg` is an optional dependency, loaded only when DATABASE_URL is set.
// SQL throughout the app is written with `?` placeholders; they're rewritten to $1..$n here.

function toPg(sql) {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

export async function createPostgresDriver(url) {
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch {
    throw new Error('DATABASE_URL is set but the optional "pg" package is not installed (npm install pg -w @academy/api)');
  }
  const pool = new pg.Pool({ connectionString: url, max: 10 });

  const make = (client) => ({
    dialect: 'postgres',
    async query(sql, params = []) {
      return (await client.query(toPg(sql), params)).rows;
    },
    async run(sql, params = []) {
      return { changes: (await client.query(toPg(sql), params)).rowCount };
    },
    async exec(sql) {
      await client.query(sql);
    },
  });

  const driver = {
    ...make(pool),
    pool,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(make(client));
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    },
    // Dedicated connection for session-level advisory locks.
    async connect() {
      const client = await pool.connect();
      return { ...make(client), release: () => client.release() };
    },
    async close() {
      await pool.end();
    },
  };
  return driver;
}
