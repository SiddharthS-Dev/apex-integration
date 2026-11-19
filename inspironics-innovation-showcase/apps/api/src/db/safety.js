/**
 * Guards against pointing a test or a migration at the real database.
 *
 * The real development database lives in the app's default data directory
 * (apps/api/data). Under the Node test runner (NODE_TEST_CONTEXT is set) no
 * SQLite file in there may be opened at all: tests use ':memory:' or a temp
 * directory. The migration CLI refuses that directory too unless it is asked
 * for explicitly (--allow-default-db or APEX_ALLOW_DEFAULT_DB=1), after
 * printing the resolved target, so a migration never lands there by accident.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** apps/api/data */
export const DEFAULT_DATA_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data')

const norm = (p) => {
  const r = path.resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

/** True when `file` is the default data directory or anything inside it. */
export function isInDefaultDataDir(file, dir = DEFAULT_DATA_DIR) {
  if (!file || file === ':memory:') return false
  const rel = path.relative(norm(dir), norm(file))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Throws before anything is opened or created when a test would open a SQLite file in the default data directory. */
export function assertTestSafeSqlite(file, env = process.env) {
  if (env.NODE_TEST_CONTEXT && isInDefaultDataDir(file)) {
    throw new Error(`Refusing to open ${path.resolve(file)} under the test runner: it is in the real data directory (${DEFAULT_DATA_DIR}). Use ':memory:' or a temp directory.`)
  }
}

/**
 * The migration (and rewrap-secrets) CLI's decision for a SQLite target: null to go ahead, else the
 * reason to refuse. The default data directory needs --allow-default-db or
 * APEX_ALLOW_DEFAULT_DB=1.
 */
export function defaultDbRefusal(file, { argv = process.argv, env = process.env, action = 'migrate' } = {}) {
  if (!isInDefaultDataDir(file)) return null
  if (argv.includes('--allow-default-db') || String(env.APEX_ALLOW_DEFAULT_DB || '').trim() === '1') return null
  return `Refusing to ${action} ${path.resolve(file)}: it is the default (real) database. Re-run with --allow-default-db or APEX_ALLOW_DEFAULT_DB=1 if that is really the target.`
}
