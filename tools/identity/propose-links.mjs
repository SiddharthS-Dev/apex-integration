/**
 * R1 / Use Case 004 — propose identity links from app database SNAPSHOTS. Never confirms anything.
 *
 *   node tools/identity/propose-links.mjs                          # dry run (default): prints the plan
 *   node tools/identity/propose-links.mjs --apply                  # inserts the proposed links
 *   options: --core-db <path>    Core (Academia API) SQLite database
 *                                (default: Inspironics Academia/apps/api/data/academy.db)
 *            --root <dir>        where the Showcase / SlidesVault databases live (default: repo root)
 *            --detail-dir <dir>  per-account CSV with emails/names (outside the repository only)
 *            --work-dir <dir>    snapshot folder (outside the repository only; default: OS temp)
 *
 * How it decides (contract §3, ADR 0003):
 *   1. tools/discovery/user-overlap.mjs copies every database (Core included) into a throw-away folder
 *      and reads only the copies. Live app databases are never opened.
 *   2. Only `multi-app-consistent` groups whose email matches exactly one Core user produce proposals:
 *      one `proposed` link per Showcase/SlidesVault account, evidence `import_consistent`,
 *      proposed_by NULL (CLI). A platform administrator confirms or rejects each one in the Core.
 *   3. Everything else that spans apps is printed as a conflict for manual handling, by app user IDs and
 *      reasons only (no emails or names on stdout).
 *   4. --apply writes to the Core database itself (it must already be migrated to 008_core_identity),
 *      in one transaction, with an audit event (actor_kind 'cli') per inserted link. Already-linked
 *      app accounts are skipped, so re-running is safe. Take a backup of the Core database first.
 *
 * Node 22.5+ (node:sqlite), no dependencies. SQLite Core databases only.
 */
import { DatabaseSync } from 'node:sqlite'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { APPS, run as overlap, writeDetail } from '../discovery/user-overlap.mjs'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const DEFAULT_CORE_DB = path.join(REPO_ROOT, 'Inspironics Academia/apps/api/data/academy.db')
const LINK_APPS = ['showcase', 'slidesvault']

function isInside(child, parent) {
  const rel = path.relative(path.resolve(parent), path.resolve(child))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function copyDb(src, dir, name) {
  const target = path.join(dir, name)
  fs.copyFileSync(src, target)
  for (const ext of ['-wal', '-shm']) if (fs.existsSync(src + ext)) fs.copyFileSync(src + ext, target + ext)
  return target
}

const hasTable = (db, name) => !!db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)

/** Builds the plan from snapshots. Pure with respect to the live databases. */
export function plan({ coreDb = DEFAULT_CORE_DB, root = REPO_ROOT, workDir, detailDir } = {}) {
  const resolvedCore = path.resolve(coreDb)
  if (!fs.existsSync(resolvedCore)) throw new Error(`Core database not found: ${resolvedCore}`)
  if (workDir && isInside(workDir, REPO_ROOT)) throw new Error(`Refusing to write personal data inside the repository: ${workDir}`)
  if (detailDir && isInside(detailDir, REPO_ROOT)) throw new Error(`Refusing to write personal data inside the repository: ${detailDir}`)

  const apps = APPS.map((a) => (a.id === 'academia' ? { ...a, db: resolvedCore } : a))
  const base = workDir || os.tmpdir()
  fs.mkdirSync(base, { recursive: true })
  const overlapWork = fs.mkdtempSync(path.join(base, 'apex-r1-overlap-'))
  const { summary, groups } = overlap({ root, apps, workDir: overlapWork })

  // Existing links, read from a snapshot of the Core database too.
  const coreWork = fs.mkdtempSync(path.join(base, 'apex-r1-core-'))
  let existing = []
  let migrated = false
  try {
    const db = new DatabaseSync(copyDb(resolvedCore, coreWork, 'core.db'), { readOnly: true })
    try {
      migrated = hasTable(db, 'identity_links')
      if (migrated) existing = db.prepare('SELECT core_user_id, app, app_user_id, status FROM identity_links').all()
    } finally {
      db.close()
    }
  } finally {
    fs.rmSync(coreWork, { recursive: true, force: true })
  }
  const openByAppUser = new Map(existing.filter((l) => l.status !== 'rejected').map((l) => [`${l.app}|${l.app_user_id}`, l]))
  const confirmedByUser = new Map(existing.filter((l) => l.status === 'confirmed').map((l) => [`${l.core_user_id}|${l.app}`, l]))

  const proposals = []
  const conflicts = []
  const skipped = []
  groups.forEach((g, i) => {
    const group = i + 1
    const ids = g.accounts.map((a) => ({ app: a.app, app_user_id: a.appUserId }))
    if (g.apps.length < 2 && g.classification === 'single-app') return
    if (g.classification !== 'multi-app-consistent') {
      conflicts.push({ group, classification: g.classification, reasons: g.reasons, accounts: ids })
      return
    }
    const core = g.accounts.filter((a) => a.app === 'academia')
    if (core.length !== 1) {
      conflicts.push({ group, classification: g.classification, reasons: [core.length ? 'several-core-users' : 'no-core-user'], accounts: ids })
      return
    }
    const coreUserId = core[0].appUserId
    for (const a of g.accounts.filter((x) => LINK_APPS.includes(x.app))) {
      const link = { group, core_user_id: coreUserId, app: a.app, app_user_id: a.appUserId }
      const open = openByAppUser.get(`${a.app}|${a.appUserId}`)
      const confirmed = confirmedByUser.get(`${coreUserId}|${a.app}`)
      if (open) skipped.push({ ...link, reason: open.core_user_id === coreUserId ? `already-${open.status}` : 'app-account-linked-to-another-core-user' })
      else if (confirmed) conflicts.push({ group, classification: g.classification, reasons: ['core-user-already-linked-to-another-app-account'], accounts: ids })
      else proposals.push(link)
    }
  })
  const detailFile = detailDir ? writeDetail(groups, detailDir) : null
  return { coreDb: resolvedCore, migrated, sources: summary.sources, byClassification: summary.byClassification, proposals, conflicts, skipped, detailFile }
}

/** Inserts the planned proposals into the Core database (one transaction, audited). */
export function apply(result) {
  if (!result.migrated) throw new Error('The Core database has no identity_links table: start the Core API (or run npm run migrate) first')
  const db = new DatabaseSync(result.coreDb)
  const inserted = []
  const refused = []
  try {
    db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
    db.exec('BEGIN IMMEDIATE')
    try {
      const insLink = db.prepare(`INSERT INTO identity_links (id, core_user_id, app, app_user_id, status, evidence, proposed_by, proposed_at, reviewed_by, reviewed_at, note)
        VALUES (?, ?, ?, ?, 'proposed', 'import_consistent', NULL, ?, NULL, NULL, ?)`)
      const insAudit = db.prepare(`INSERT INTO audit_events (id, at, actor_user_id, actor_kind, action, target_type, target_id, organization_id, detail, ip)
        VALUES (?, ?, NULL, 'cli', 'identity_link.proposed', 'identity_link', ?, NULL, ?, NULL)`)
      for (const p of result.proposals) {
        const id = crypto.randomUUID()
        const at = new Date().toISOString()
        try {
          insLink.run(id, p.core_user_id, p.app, p.app_user_id, at, 'proposed by tools/identity/propose-links.mjs (multi-app-consistent)')
        } catch (err) {
          // Linked since the snapshot was taken, or the Core user no longer exists: leave it for review.
          refused.push({ ...p, reason: /UNIQUE/i.test(err.message) ? 'already-linked' : /FOREIGN KEY/i.test(err.message) ? 'core-user-missing' : err.message })
          continue
        }
        insAudit.run(crypto.randomUUID(), at, id, JSON.stringify({ core_user_id: p.core_user_id, app: p.app, app_user_id: p.app_user_id, evidence: 'import_consistent', tool: 'propose-links' }))
        inserted.push({ id, ...p })
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  } finally {
    db.close()
  }
  return { inserted, refused }
}

function arg(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = plan({ coreDb: arg('--core-db') || DEFAULT_CORE_DB, root: arg('--root') || REPO_ROOT, workDir: arg('--work-dir'), detailDir: arg('--detail-dir') })
    const doApply = process.argv.includes('--apply')
    const out = {
      mode: doApply ? 'apply' : 'dry-run',
      sources: result.sources,
      byClassification: result.byClassification,
      proposals: result.proposals,
      skipped: result.skipped,
      conflicts: result.conflicts,
      note: 'Proposals only. A platform administrator confirms or rejects each link in the Core. Email matching is never proof.',
    }
    if (doApply) Object.assign(out, apply(result))
    console.log(JSON.stringify(out, null, 2))
    if (result.detailFile) console.error(`Per-account detail (personal data): ${result.detailFile}`)
    if (!doApply) console.error('Dry run: nothing was written. Re-run with --apply to insert the proposals.')
  } catch (err) {
    console.error(`propose-links failed: ${err.message}`)
    process.exit(1)
  }
}
