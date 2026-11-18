/**
 * Tests for the R1 link-proposal CLI, on disposable fixture databases only.
 *
 *   node --test tools/identity/
 *
 * The Core fixture is a real, fully migrated Core database: the Academia API's own migrate CLI is run
 * against a temporary SQLITE_PATH, then fixture users are inserted.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { APPS } from '../discovery/user-overlap.mjs'
import { apply, plan } from './propose-links.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../..')
const API = path.join(REPO_ROOT, 'Inspironics Academia/apps/api')
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

let migratedTemplate
function migratedCore(dir) {
  if (!migratedTemplate) {
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r1-coretpl-'))
    migratedTemplate = path.join(tdir, 'core.db')
    execFileSync(process.execPath, [path.join(API, 'src/db/migrate-cli.js')], {
      cwd: API, stdio: 'ignore', windowsHide: true,
      env: { ...process.env, SQLITE_PATH: migratedTemplate, DATA_DIR: tdir, DATABASE_URL: '', LOG_LEVEL: 'error', AI_ENABLED: 'false' },
    })
    const db = new DatabaseSync(migratedTemplate)
    db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    db.close()
  }
  const file = path.join(dir, 'core.db')
  fs.copyFileSync(migratedTemplate, file)
  return file
}

function fixtures({ migrated = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r1-links-'))
  const core = migrated ? migratedCore(root) : path.join(root, 'core.db')
  const cdb = new DatabaseSync(core)
  if (!migrated) cdb.exec('CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, full_name TEXT, role TEXT, password_hash TEXT, disabled INTEGER, created_date TEXT, updated_date TEXT, last_login_at TEXT, audience TEXT)')
  const u = cdb.prepare("INSERT INTO users (id, email, full_name, role, password_hash, disabled, created_date, updated_date, audience) VALUES (?, ?, ?, ?, 'h', 0, 't', 't', 'employee')")
  u.run('c-kim', 'kim@example.com', 'Kim', 'user')
  u.run('c-lee', 'lee@example.com', 'Lee Learner', 'user')
  u.run('c-solo', 'solo@example.com', 'Solo', 'user')
  cdb.close()
  const make = (rel, ddl, rows) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec(ddl)
    for (const [sql, ...vals] of rows) db.prepare(sql).run(...vals)
    db.close()
    return file
  }
  make(APPS[1].db,
    'CREATE TABLE users (id TEXT, email TEXT, name TEXT, password_hash TEXT, role TEXT, verified INTEGER, provider TEXT, picture TEXT, disabled INTEGER, created_at TEXT, last_login_at TEXT)',
    [
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 's-kim', 'kim@example.com', 'Kim', 'h', 'viewer', 1, null, null, 0, 't', null],
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 's-lee', 'lee@example.com', 'Lee L.', 'h', 'viewer', 1, null, null, 0, 't', null],
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 's-pat', 'pat@example.com', 'Pat', 'h', 'viewer', 1, null, null, 0, 't', null],
    ])
  make(APPS[2].db,
    'CREATE TABLE app_user (id TEXT, email TEXT, full_name TEXT, role TEXT, password_hash TEXT, status TEXT, last_login_at TEXT, created_at TEXT, updated_at TEXT, last_active_at TEXT)',
    [
      ['INSERT INTO app_user VALUES (?,?,?,?,?,?,?,?,?,?)', 'v-kim', 'kim@example.com', 'Kim', 'user', 'h', 'active', null, 't', 't', null],
      ['INSERT INTO app_user VALUES (?,?,?,?,?,?,?,?,?,?)', 'v-pat', 'pat@example.com', 'Pat', 'user', 'h', 'active', null, 't', 't', null],
    ])
  return { root, core }
}

test('dry run proposes only for consistent groups with exactly one Core user, and writes nothing', () => {
  const { root, core } = fixtures()
  const before = [core, path.join(root, APPS[1].db), path.join(root, APPS[2].db)].map(sha)
  const r = plan({ coreDb: core, root })
  assert.deepEqual(r.proposals.map((p) => [p.core_user_id, p.app, p.app_user_id]).sort(), [['c-kim', 'showcase', 's-kim'], ['c-kim', 'slidesvault', 'v-kim']])
  const reasons = r.conflicts.map((c) => c.reasons.join(' ')).sort()
  assert.ok(reasons.some((x) => x.includes('name-differs')), 'lee: conflict, no proposal')
  assert.ok(reasons.includes('no-core-user'), 'pat: no Core user')
  assert.ok(!JSON.stringify({ p: r.proposals, c: r.conflicts }).includes('@'), 'no emails in the printed plan')
  assert.deepEqual([core, path.join(root, APPS[1].db), path.join(root, APPS[2].db)].map(sha), before, 'all databases unchanged')
})

test('--apply inserts proposed links (import_consistent, no proposer), audited, never confirmed; re-running is a no-op', () => {
  const { root, core } = fixtures()
  const appDbs = [path.join(root, APPS[1].db), path.join(root, APPS[2].db)]
  const before = appDbs.map(sha)
  const out = apply(plan({ coreDb: core, root }))
  assert.equal(out.inserted.length, 2)
  const db = new DatabaseSync(core, { readOnly: true })
  const links = db.prepare('SELECT * FROM identity_links ORDER BY app').all()
  assert.deepEqual(links.map((l) => [l.status, l.evidence, l.proposed_by, l.reviewed_by]), [['proposed', 'import_consistent', null, null], ['proposed', 'import_consistent', null, null]])
  const audit = db.prepare("SELECT actor_kind FROM audit_events WHERE action = 'identity_link.proposed'").all()
  assert.deepEqual(audit.map((a) => a.actor_kind), ['cli', 'cli'])
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM role_assignments WHERE user_id = 'c-kim'").get().n, 0, 'no roles granted')
  db.close()
  assert.deepEqual(appDbs.map(sha), before, 'app databases are only ever read (from snapshots)')

  const again = plan({ coreDb: core, root })
  assert.equal(again.proposals.length, 0)
  assert.deepEqual(again.skipped.map((s) => s.reason), ['already-proposed', 'already-proposed'])
  assert.equal(apply(again).inserted.length, 0)
})

test('refuses an unmigrated Core database for --apply, and personal data inside the repository', () => {
  const { root, core } = fixtures({ migrated: false })
  const r = plan({ coreDb: core, root })
  assert.equal(r.migrated, false)
  assert.equal(r.proposals.length, 2, 'the dry run still works')
  assert.throws(() => apply(r), /identity_links/)
  assert.throws(() => plan({ coreDb: core, root, detailDir: path.join(REPO_ROOT, 'docs') }), /inside the repository/)
  assert.throws(() => plan({ coreDb: core, root, workDir: path.join(REPO_ROOT, 'tmp-snapshots') }), /inside the repository/)
  assert.ok(!fs.existsSync(path.join(REPO_ROOT, 'tmp-snapshots')))
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r1-detail-'))
  assert.ok(fs.existsSync(plan({ coreDb: core, root, detailDir: out }).detailFile))
  assert.throws(() => plan({ coreDb: path.join(root, 'missing.db'), root }), /not found/)
})

test('CLI: dry run by default, prints JSON without emails', () => {
  const { root, core } = fixtures()
  const stdout = execFileSync(process.execPath, [path.join(HERE, 'propose-links.mjs'), '--core-db', core, '--root', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true })
  const out = JSON.parse(stdout)
  assert.equal(out.mode, 'dry-run')
  assert.equal(out.proposals.length, 2)
  assert.ok(!stdout.includes('@'))
  const db = new DatabaseSync(core, { readOnly: true })
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM identity_links').get().n, 0)
  db.close()
})
