import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Shared harness for the Core identity tests: a throwaway SQLite database, the real app over HTTP, and
// cookie-jar clients. Must be called before anything under src/ is imported (config reads env once).
export async function startHarness(prefix, env = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `academy-${prefix}-`));
  Object.assign(process.env, {
    DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', EMAIL_PROVIDER: 'log', AI_ENABLED: 'false', LOG_LEVEL: 'error',
    NODE_ENV: 'test', JOBS_ENABLED: 'false', ...env,
  });
  delete process.env.BOOTSTRAP_ADMIN_EMAIL;
  delete process.env.ALLOW_FIRST_USER_ADMIN;
  const silence = console.log;
  console.log = () => {};
  const { getDb, closeDb } = await import('../../src/db/index.js');
  const { migrate } = await import('../../src/db/migrations.js');
  const { createApp } = await import('../../src/app.js');
  const db = await getDb();
  await migrate(db);
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => { server.once('listening', r); });
  const base = `http://127.0.0.1:${server.address().port}`;

  function client() {
    let cookie = '';
    const call = async (method, url, body, headers = {}) => {
      const res = await fetch(`${base}/api${url}`, {
        method,
        headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const set = res.headers.get('set-cookie');
      if (set) cookie = set.split(';')[0];
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      return { status: res.status, data };
    };
    const ok = async (method, url, body, headers) => {
      const r = await call(method, url, body, headers);
      assert.ok(r.status < 300, `${method} ${url} → ${r.status} ${JSON.stringify(r.data)}`);
      return r.data;
    };
    return { call, ok, get cookie() { return cookie; } };
  }

  /** Registers a user through the real API; the first one becomes admin (development default). */
  async function register(email, extra = {}) {
    const c = client();
    const r = await c.ok('POST', '/auth/register', { email, password: 'Pass-word-123', full_name: email.split('@')[0], ...extra });
    c.id = r.user.id;
    return c;
  }

  /**
   * Creates a user through the admin invite (register is rate-limited to 5 per window) and signs in.
   * `admin` is a signed-in admin client.
   */
  async function invite(admin, email, { role = 'user', audience } = {}) {
    const r = await admin.ok('POST', '/auth/invite', { email, role, audience, full_name: email.split('@')[0] });
    const c = client();
    await c.ok('POST', '/auth/login', { email, password: r.temporary_password });
    c.id = r.user.id;
    return c;
  }

  async function stop() {
    console.log = silence;
    server.close();
    await closeDb();
    fs.rmSync(dir, { recursive: true, force: true });
  }

  return { dir, db, base, client, register, invite, stop, migrate };
}

/** A single SELECT helper for assertions. */
export const rows = (db, sql, params = []) => db.query(sql, params);
