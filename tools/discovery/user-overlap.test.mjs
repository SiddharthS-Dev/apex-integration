/**
 * Tests for the R0 user overlap report, on disposable fixture databases only.
 *
 *   node --test tools/discovery/
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { APPS, analyse, run, writeDetail } from './user-overlap.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/** Builds three fixture databases shaped like the real apps' user tables. */
function fixtures() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r0-fixture-'))
  const make = (rel, ddl, rows) => {
    const file = path.join(root, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const db = new DatabaseSync(file)
    db.exec(ddl)
    for (const [sql, ...vals] of rows) db.prepare(sql).run(...vals)
    db.close()
    return file
  }
  make(APPS[0].db,
    'CREATE TABLE users (id TEXT, email TEXT, full_name TEXT, role TEXT, password_hash TEXT, disabled INTEGER, created_date TEXT, updated_date TEXT, last_login_at TEXT, avatar_url TEXT, audience TEXT)',
    [
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 'a1', 'Ada@Example.com', 'Ada Admin', 'admin', 'h', 0, 't', 't', null, null, 'employee'],
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 'a2', 'lee@example.com', 'Lee Learner', 'user', 'h', 0, 't', 't', null, null, 'intern'],
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 'a3', 'solo@example.com', 'Solo', 'user', 'h', 0, 't', 't', null, null, 'employee'],
    ])
  make(APPS[1].db,
    'CREATE TABLE users (id TEXT, email TEXT, name TEXT, password_hash TEXT, role TEXT, verified INTEGER, provider TEXT, picture TEXT, disabled INTEGER, created_at TEXT, last_login_at TEXT)',
    [
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 's1', ' ada@example.com', 'Ada Admin', 'h', 'admin', 1, null, null, 0, 't', null],
      ['INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?)', 's2', 'lee@example.com', 'Lee L.', null, 'viewer', 1, 'google', null, 0, 't', null],
    ])
  make(APPS[2].db,
    'CREATE TABLE app_user (id TEXT, email TEXT, full_name TEXT, role TEXT, password_hash TEXT, status TEXT, last_login_at TEXT, created_at TEXT, updated_at TEXT, last_active_at TEXT)',
    [
      ['INSERT INTO app_user VALUES (?,?,?,?,?,?,?,?,?,?)', 'v1', 'ada@example.com', 'Ada Admin', 'admin', 'h', 'active', null, 't', 't', null],
      ['INSERT INTO app_user VALUES (?,?,?,?,?,?,?,?,?,?)', 'v2', 'lee@example.com', 'Lee Learner', 'admin', 'h', 'disabled', null, 't', 't', null],
    ])
  return root
}

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

test('classifies overlap and conflicts without merging anything', () => {
  const root = fixtures()
  const before = APPS.map((a) => sha(path.join(root, a.db)))
  const { summary, groups } = run({ root })

  assert.equal(summary.distinctEmails, 3)
  assert.deepEqual(summary.byPresence, { 'academia+showcase+slidesvault': 2, academia: 1 })
  const ada = groups.find((g) => g.key === 'ada@example.com')
  assert.equal(ada.classification, 'multi-app-conflict')
  assert.deepEqual(ada.reasons, ['email-spelling-differs'], 'case/whitespace spelling is surfaced, not silently equated')
  const lee = groups.find((g) => g.key === 'lee@example.com')
  assert.equal(lee.classification, 'multi-app-conflict')
  for (const r of ['admin-in-some-apps-only', 'active-status-differs', 'name-differs', 'sign-in-method-differs']) {
    assert.ok(lee.reasons.includes(r), r)
  }
  assert.equal(groups.find((g) => g.key === 'solo@example.com').classification, 'single-app')

  // Read-only: the source databases are byte-identical afterwards.
  assert.deepEqual(APPS.map((a) => sha(path.join(root, a.db))), before)
})

test('the summary contains no email addresses or names', () => {
  const { summary } = run({ root: fixtures() })
  const text = JSON.stringify(summary)
  assert.ok(!/@/.test(text), 'no emails')
  assert.ok(!/Ada|Lee|Solo/.test(text), 'no names')
})

test('a missing database is reported, not fatal', () => {
  const root = fixtures()
  fs.rmSync(path.join(root, APPS[2].db))
  const { summary } = run({ root })
  assert.equal(summary.sources.slidesvault.status, 'database not found')
  assert.equal(summary.apps.slidesvault.accounts, 0)
})

test('duplicate emails inside one app are flagged', () => {
  const acc = (app, email) => ({ app, email, name: 'x', role: 'user', active: true, admin: false, signIn: 'password' })
  const { summary, groups } = analyse({ academia: [acc('academia', 'a@x.io'), acc('academia', 'A@x.io')], showcase: [] })
  assert.equal(summary.apps.academia.duplicateEmailsWithinApp, 1)
  assert.equal(groups[0].classification, 'single-app-conflict')
})

test('refuses to write personal data inside the repository', () => {
  assert.throws(() => writeDetail([], path.join(REPO_ROOT, 'docs')), /inside the repository/)
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r0-out-'))
  const file = writeDetail([], out)
  assert.ok(fs.existsSync(file))
})
