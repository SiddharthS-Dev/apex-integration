import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Guards against pointing tests and maintenance CLIs at the real database by accident (an earlier
// agent migrated apps/api/data/academy.db by running migrate-cli.js without SQLITE_PATH).
//  - Under the Node test runner (NODE_TEST_CONTEXT is set) the SQLite driver refuses any file inside the
//    app's default data directory, whatever flag is given.
//  - migrate-cli.js and the Core CLIs print their resolved target first, and refuse the default data
//    directory unless --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 is given explicitly.
// The server (src/server.js) is unaffected.

const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** apps/api/data — the default DATA_DIR, independent of what DATA_DIR is set to now. */
export const DEFAULT_DATA_DIR = path.join(apiRoot, 'data');

const norm = (p) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/** True when `file` is inside (or is) the app's default data directory. */
export function isInDefaultDataDir(file, dataDir = DEFAULT_DATA_DIR) {
  if (!file || file === ':memory:') return false;
  const rel = path.relative(norm(dataDir), norm(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export const underTestRunner = (env = process.env) => !!env.NODE_TEST_CONTEXT;

/** Throws when running under the test runner against the default data directory. */
export function assertNotDefaultDbUnderTest(file, env = process.env) {
  if (underTestRunner(env) && isInDefaultDataDir(file)) {
    throw new Error(`Refusing to open ${file} under the test runner: it is inside the default data directory (${DEFAULT_DATA_DIR}). `
      + 'Tests must use a disposable SQLITE_PATH (see test/helpers/coreHarness.js).');
  }
}

/** Human-readable target: the SQLite file, or the Postgres host/database without credentials. */
export function describeTarget({ databaseUrl, sqlitePath }) {
  if (!databaseUrl) return `sqlite ${sqlitePath}`;
  try {
    const u = new URL(databaseUrl);
    return `postgres ${u.hostname}${u.port ? `:${u.port}` : ''}${u.pathname}`;
  } catch {
    return 'postgres (DATABASE_URL, unparsable)';
  }
}

/**
 * Decision for a maintenance CLI: { ok, target, reason }. Pure (no I/O), so it is testable.
 * SQLite inside the default data directory needs --allow-default-db or APEX_ALLOW_DEFAULT_DB=1.
 */
export function cliTargetCheck({ databaseUrl, sqlitePath }, argv = [], env = process.env) {
  const target = describeTarget({ databaseUrl, sqlitePath });
  if (databaseUrl || !isInDefaultDataDir(sqlitePath)) return { ok: true, target };
  const allowed = argv.includes('--allow-default-db') || env.APEX_ALLOW_DEFAULT_DB === '1';
  if (allowed) return { ok: true, target };
  return {
    ok: false,
    target,
    reason: `refusing to run against the default data directory (${DEFAULT_DATA_DIR}). Set SQLITE_PATH or DATABASE_URL to the `
      + 'intended database, or pass --allow-default-db (or APEX_ALLOW_DEFAULT_DB=1) if you really mean the default database.',
  };
}

/**
 * For CLIs: prints the resolved target to stderr, then exits with code 2 if the target is refused.
 * Call before opening the database.
 */
export function guardCliTarget(name, cfg, argv = process.argv.slice(2), env = process.env) {
  const check = cliTargetCheck(cfg, argv, env);
  console.error(`${name}: target ${check.target}`);
  if (!check.ok) {
    console.error(`${name}: ${check.reason}`);
    process.exit(2);
  }
  return check;
}
