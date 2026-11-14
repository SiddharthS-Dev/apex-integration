/**
 * R0 / Use Case 002 — cross-application user overlap report. READ-ONLY.
 *
 *   node tools/discovery/user-overlap.mjs --detail-dir "E:\apex-review-tmp\r0"
 *   node tools/discovery/user-overlap.mjs --summary-json out.json --detail-dir <dir>
 *
 * What it does:
 *   1. Copies each app's SQLite database (with its -wal/-shm files) into a
 *      throw-away snapshot folder and opens only the copy, read-only. The live
 *      databases are never opened, so a running app cannot be disturbed.
 *   2. Reads each app's user table through a per-app column map (the three
 *      schemas differ: users vs app_user, disabled vs status, name vs full_name).
 *   3. Groups accounts by a normalised email (trimmed, lower-cased) FOR
 *      REPORTING ONLY, and classifies each group:
 *        single-app             present in one app
 *        multi-app-consistent   in several apps, no differences found
 *        multi-app-conflict     in several apps with a role, status, name or
 *                               sign-in-method difference — needs human review
 *      Nothing is merged, linked or written back. Matching email addresses
 *      are a hint for a reviewer, never proof of one identity (master plan,
 *      Use Case 004; implementation rule 6).
 *   4. Prints an aggregate summary that contains no email addresses or names.
 *      The per-account detail (which does) is written only with --detail-dir,
 *      and only to a folder outside this repository.
 *   5. Deletes the snapshot folder.
 *
 * R1: each account also carries its app user id (appUserId) so tools/identity/propose-links.mjs can
 * propose reviewed links; the printed summary never contains ids, emails or names.
 *
 * Node 22.5+ (node:sqlite), no dependencies.
 */
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Where each app keeps its users, and how its columns map onto one shape.
 * `active(row)` and `admin(row)` interpret each app's own encoding.
 */
export const APPS = [
  {
    id: 'academia',
    db: 'Inspironics Academia/apps/api/data/academy.db',
    table: 'users',
    cols: { id: 'id', email: 'email', name: 'full_name', role: 'role', created: 'created_date', lastLogin: 'last_login_at' },
    extra: ['disabled', 'password_hash', 'audience'],
    active: (r) => !Number(r.disabled),
    admin: (r) => r.role === 'admin',
    signIn: (r) => (r.password_hash ? 'password' : 'none'),
  },
  {
    id: 'showcase',
    db: 'inspironics-innovation-showcase/apps/api/data/app.db',
    table: 'users',
    cols: { id: 'id', email: 'email', name: 'name', role: 'role', created: 'created_at', lastLogin: 'last_login_at' },
    extra: ['disabled', 'password_hash', 'provider', 'verified'],
    active: (r) => !Number(r.disabled),
    admin: (r) => r.role === 'admin',
    signIn: (r) => (r.password_hash ? 'password' : r.provider ? String(r.provider) : 'none'),
  },
  {
    id: 'slidesvault',
    db: 'slide vault/apps/api/data/slidesvault.db',
    table: 'app_user',
    cols: { id: 'id', email: 'email', name: 'full_name', role: 'role', created: 'created_at', lastLogin: 'last_login_at' },
    extra: ['status', 'password_hash'],
    active: (r) => String(r.status || 'active') === 'active',
    admin: (r) => r.role === 'admin',
    signIn: (r) => (r.password_hash ? 'password' : 'none'),
  },
]

export const normaliseEmail = (e) => String(e ?? '').trim().toLowerCase()
const normaliseName = (n) => String(n ?? '').trim().replace(/\s+/g, ' ').toLowerCase()

/** True when `child` is `parent` or inside it. */
function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/** Copies db + -wal + -shm into `dir` and returns the copy's path, or null if the db is missing. */
function snapshot(dbPath, dir, id) {
  if (!fs.existsSync(dbPath)) return null
  const target = path.join(dir, `${id}.db`)
  fs.copyFileSync(dbPath, target)
  for (const ext of ['-wal', '-shm']) {
    if (fs.existsSync(dbPath + ext)) fs.copyFileSync(dbPath + ext, target + ext)
  }
  return target
}

/** Reads one app's accounts from a snapshot copy. */
export function readAccounts(app, dbFile) {
  const db = new DatabaseSync(dbFile, { readOnly: true })
  try {
    const present = new Set(db.prepare(`PRAGMA table_info(${app.table})`).all().map((c) => c.name))
    if (!present.size) return { error: `table ${app.table} not found` }
    const wanted = [...Object.values(app.cols), ...app.extra].filter((c) => present.has(c))
    const missing = [...Object.values(app.cols), ...app.extra].filter((c) => !present.has(c))
    const rows = db.prepare(`SELECT ${wanted.map((c) => `"${c}"`).join(', ')} FROM ${app.table}`).all()
    return {
      missingColumns: missing,
      accounts: rows.map((r) => ({
        app: app.id,
        appUserId: r[app.cols.id] == null ? null : String(r[app.cols.id]),
        email: r[app.cols.email] ?? '',
        name: r[app.cols.name] ?? '',
        role: r[app.cols.role] ?? '',
        active: app.active(r),
        admin: app.admin(r),
        signIn: app.signIn(r),
        created: r[app.cols.created] ?? '',
        lastLogin: r[app.cols.lastLogin] ?? '',
      })),
    }
  } finally {
    db.close()
  }
}

/** Groups accounts by normalised email and classifies each group. Pure. */
export function analyse(accountsByApp) {
  const appIds = Object.keys(accountsByApp)
  const groups = new Map()
  const withinAppDuplicates = {}
  let missingEmail = 0

  for (const id of appIds) {
    const seen = new Map()
    for (const a of accountsByApp[id]) {
      const key = normaliseEmail(a.email)
      if (!key) {
        missingEmail++
        continue
      }
      seen.set(key, (seen.get(key) || 0) + 1)
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(a)
    }
    withinAppDuplicates[id] = [...seen.values()].filter((n) => n > 1).length
  }

  const groupsOut = []
  for (const [key, accounts] of groups) {
    const apps = [...new Set(accounts.map((a) => a.app))].sort()
    const reasons = []
    if (apps.length > 1) {
      if (new Set(accounts.map((a) => a.admin)).size > 1) reasons.push('admin-in-some-apps-only')
      if (new Set(accounts.map((a) => a.active)).size > 1) reasons.push('active-status-differs')
      const names = new Set(accounts.map((a) => normaliseName(a.name)).filter(Boolean))
      if (names.size > 1) reasons.push('name-differs')
      if (new Set(accounts.map((a) => a.signIn)).size > 1) reasons.push('sign-in-method-differs')
      if (new Set(accounts.map((a) => String(a.email).trim())).size > 1) reasons.push('email-spelling-differs')
    }
    if (accounts.length > apps.length) reasons.push('duplicate-within-an-app')
    const classification =
      apps.length === 1
        ? reasons.length ? 'single-app-conflict' : 'single-app'
        : reasons.length ? 'multi-app-conflict' : 'multi-app-consistent'
    groupsOut.push({ key, apps, accounts, reasons, classification })
  }

  const countBy = (f) => groupsOut.reduce((m, g) => ((m[f(g)] = (m[f(g)] || 0) + 1), m), {})
  const reasonCounts = {}
  for (const g of groupsOut) for (const r of g.reasons) reasonCounts[r] = (reasonCounts[r] || 0) + 1

  const summary = {
    apps: Object.fromEntries(
      appIds.map((id) => {
        const list = accountsByApp[id]
        return [
          id,
          {
            accounts: list.length,
            active: list.filter((a) => a.active).length,
            admins: list.filter((a) => a.admin).length,
            roles: list.reduce((m, a) => ((m[a.role || '(none)'] = (m[a.role || '(none)'] || 0) + 1), m), {}),
            signIn: list.reduce((m, a) => ((m[a.signIn] = (m[a.signIn] || 0) + 1), m), {}),
            duplicateEmailsWithinApp: withinAppDuplicates[id],
          },
        ]
      })
    ),
    distinctEmails: groupsOut.length,
    accountsWithoutEmail: missingEmail,
    byPresence: countBy((g) => g.apps.join('+')),
    byClassification: countBy((g) => g.classification),
    conflictReasons: reasonCounts,
    note: 'Email matching is for review only. No accounts were merged or linked.',
  }
  return { summary, groups: groupsOut }
}

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** Writes the per-account detail (contains personal data) to a folder outside the repository. */
export function writeDetail(groups, dir) {
  if (isInside(dir, REPO_ROOT)) throw new Error(`Refusing to write personal data inside the repository: ${dir}`)
  fs.mkdirSync(dir, { recursive: true })
  const header = ['group', 'classification', 'reasons', 'app', 'email', 'name', 'role', 'active', 'admin', 'sign_in', 'created', 'last_login']
  const lines = [header.join(',')]
  groups.forEach((g, i) => {
    for (const a of g.accounts) {
      lines.push(
        [i + 1, g.classification, g.reasons.join(' '), a.app, a.email, a.name, a.role, a.active, a.admin, a.signIn, a.created, a.lastLogin]
          .map(csvCell)
          .join(',')
      )
    }
  })
  const file = path.join(dir, `user-overlap-detail-${new Date().toISOString().slice(0, 10)}.csv`)
  fs.writeFileSync(file, lines.join('\n') + '\n', { mode: 0o600 })
  return file
}

/** Runs the whole report. `root` lets tests point at fixture databases. */
export function run({ root = REPO_ROOT, apps = APPS, workDir, detailDir, summaryJson } = {}) {
  const work = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'apex-r0-'))
  fs.mkdirSync(work, { recursive: true })
  const accountsByApp = {}
  const sources = {}
  try {
    for (const app of apps) {
      const copy = snapshot(path.resolve(root, app.db), work, app.id) // app.db may be absolute (R1 propose-links)
      if (!copy) {
        sources[app.id] = { status: 'database not found', path: app.db }
        accountsByApp[app.id] = []
        continue
      }
      const result = readAccounts(app, copy)
      if (result.error) {
        sources[app.id] = { status: result.error, path: app.db }
        accountsByApp[app.id] = []
        continue
      }
      sources[app.id] = { status: 'read', path: app.db, missingColumns: result.missingColumns }
      accountsByApp[app.id] = result.accounts
    }
  } finally {
    fs.rmSync(work, { recursive: true, force: true })
  }
  const { summary, groups } = analyse(accountsByApp)
  summary.sources = sources
  summary.generatedAt = new Date().toISOString()
  if (summaryJson) fs.writeFileSync(summaryJson, JSON.stringify(summary, null, 2) + '\n')
  const detailFile = detailDir ? writeDetail(groups, detailDir) : null
  return { summary, groups, detailFile }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { summary, detailFile } = run({ detailDir: arg('--detail-dir'), summaryJson: arg('--summary-json'), workDir: arg('--work-dir') })
  console.log(JSON.stringify(summary, null, 2))
  console.error(detailFile ? `\nPer-account detail (personal data): ${detailFile}` : '\nNo detail written (pass --detail-dir outside the repository).')
}
