/**
 * Encrypted backups of the APEX private staging stack, with retention.
 *
 *   node deploy/staging/backup.mjs                      back up now (all three databases, roles, volumes)
 *   node deploy/staging/backup.mjs --retention-days 30  keep 30 days of backups (default 14; at least 3 sets are always kept)
 *   node deploy/staging/backup.mjs --out D:\apex-backups
 *   node deploy/staging/backup.mjs --no-volumes         databases and roles only
 *   node deploy/staging/backup.mjs decrypt <file.enc> <out>   for a restore (STAGING_RUNBOOK.md §7)
 *   node deploy/staging/backup.mjs verify [<set dir>]   check every file of a set against its manifest and the key
 *
 * One set per run, in <out>/<UTC timestamp>/:
 *   core.dump.enc, showcase.dump.enc, slidesvault.dump.enc   pg_dump -Fc of each database
 *   globals.sql.enc                                          pg_dumpall --globals-only (roles)
 *   core-data.tgz.enc, gateway-state.tgz.enc                 the volumes that are not regenerable
 *   manifest.json                                            names, sizes, SHA-256 of each encrypted file
 *
 * Every file is AES-256-GCM encrypted while it streams (nothing unencrypted touches the disk) with
 * BACKUP_ENCRYPTION_KEY: 32 random bytes, base64, from the environment or deploy/staging/.env.staging
 * (generate-secrets.mjs creates it; `--add-missing` adds it to an existing file). Keep a copy of the key
 * somewhere other than the backups: without it they cannot be read.
 *
 * Key rotation (generate-secrets.mjs --rotate BACKUP_ENCRYPTION_KEY): new sets use the current key;
 * `decrypt` and `verify` also try BACKUP_ENCRYPTION_KEY_PREVIOUS (comma-separated, newest first), so
 * older sets stay restorable. Keep a previous key until the last set encrypted with it has aged out
 * of retention (STAGING_RUNBOOK.md, "Key rotation").
 *
 * Scheduling is the host's job (cron, Task Scheduler): see STAGING_RUNBOOK.md §7. Copy the sets off the
 * host as well; a backup on the same disk as the data does not survive losing that disk.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from './generate-secrets.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const MAGIC = Buffer.from('APEXBK1\n')
const IV_BYTES = 12
const TAG_BYTES = 16
const HEADER_BYTES = MAGIC.length + IV_BYTES
export const DATABASES = ['core', 'showcase', 'slidesvault']
/** Volumes holding state that cannot be regenerated (the Showcase and SlidesVault ones are caches). */
export const VOLUMES = ['core-data', 'gateway-state']
const SET_NAME = /^\d{8}T\d{6}Z$/

/** The 32-byte key from base64, or a clear error (naming the variable, never the value). */
export function parseKey(value, name = 'BACKUP_ENCRYPTION_KEY') {
  const key = Buffer.from(String(value || '').trim(), 'base64')
  if (key.length !== 32) throw new Error(`${name} must be 32 random bytes, base64 (run generate-secrets.mjs --add-missing)`)
  return key
}

/** BACKUP_ENCRYPTION_KEY_PREVIOUS: zero or more retired keys, comma-separated, each validated like the current one. */
export function parsePreviousKeys(value, name = 'BACKUP_ENCRYPTION_KEY_PREVIOUS') {
  const entries = String(value || '').split(',').map((s) => s.trim()).filter(Boolean)
  return entries.map((entry, i) => parseKey(entry, entries.length > 1 ? `${name} entry ${i + 1}` : name))
}

const keyList = (keys) => (Array.isArray(keys) ? keys : [keys])

/** A cipher stream that writes MAGIC + IV first and the GCM tag last. */
export function encryptStream(key) {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  let headerSent = false
  return new Transform({
    transform(chunk, _enc, done) {
      if (!headerSent) {
        this.push(Buffer.concat([MAGIC, iv]))
        headerSent = true
      }
      done(null, cipher.update(chunk))
    },
    flush(done) {
      if (!headerSent) this.push(Buffer.concat([MAGIC, iv]))
      this.push(cipher.final())
      done(null, cipher.getAuthTag())
    },
  })
}

/** Encrypts a readable stream into `dest` (written as dest.partial, renamed when complete). */
export async function encryptTo(source, dest, key) {
  const partial = `${dest}.partial`
  try {
    await pipeline(source, encryptStream(key), fs.createWriteStream(partial, { mode: 0o600 }))
    fs.renameSync(partial, dest)
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw error
  }
}

/**
 * Decrypts `src` into `dest` with the first of `keys` (a Buffer, or [current, ...previous]) that
 * authenticates it. Fails (and leaves no output) if no key fits or the file was altered.
 */
export async function decryptFile(src, dest, keys) {
  const list = keyList(keys)
  let last
  for (const key of list) {
    try {
      return await decryptFileWith(src, dest, key)
    } catch (error) {
      last = error
      if (!error.authFailure) throw error
    }
  }
  throw new Error(`${last.message}${list.length > 1 ? ` (tried ${list.length} keys)` : ''}`)
}

async function decryptFileWith(src, dest, key) {
  const size = fs.statSync(src).size
  if (size < HEADER_BYTES + TAG_BYTES) throw new Error(`${src}: too short to be a backup file`)
  const fd = fs.openSync(src, 'r')
  const header = Buffer.alloc(HEADER_BYTES)
  const tag = Buffer.alloc(TAG_BYTES)
  try {
    fs.readSync(fd, header, 0, HEADER_BYTES, 0)
    fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES)
  } finally {
    fs.closeSync(fd)
  }
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error(`${src}: not an APEX backup file`)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length))
  decipher.setAuthTag(tag)
  const partial = `${dest}.partial`
  const body = size - HEADER_BYTES - TAG_BYTES
  const input = body > 0 ? fs.createReadStream(src, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 }) : Readable.from([])
  try {
    await pipeline(input, decipher, fs.createWriteStream(partial, { mode: 0o600 }))
    fs.renameSync(partial, dest)
  } catch (error) {
    fs.rmSync(partial, { force: true })
    throw Object.assign(new Error(`${src}: cannot decrypt (wrong key or altered file): ${error.message}`), { authFailure: true })
  }
}

/** Streams a file through GCM without writing anything: true when one of `keys` and the tag match. */
export async function verifyFile(src, keys) {
  for (const key of keyList(keys)) if (await verifyFileWith(src, key)) return true
  return false
}

async function verifyFileWith(src, key) {
  const size = fs.statSync(src).size
  if (size < HEADER_BYTES + TAG_BYTES) return false
  const fd = fs.openSync(src, 'r')
  const header = Buffer.alloc(HEADER_BYTES)
  const tag = Buffer.alloc(TAG_BYTES)
  fs.readSync(fd, header, 0, HEADER_BYTES, 0)
  fs.readSync(fd, tag, 0, TAG_BYTES, size - TAG_BYTES)
  fs.closeSync(fd)
  if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return false
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, header.subarray(MAGIC.length))
  decipher.setAuthTag(tag)
  const body = size - HEADER_BYTES - TAG_BYTES
  try {
    if (body > 0) for await (const chunk of fs.createReadStream(src, { start: HEADER_BYTES, end: size - TAG_BYTES - 1 })) decipher.update(chunk)
    decipher.final()
    return true
  } catch {
    return false
  }
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (c) => hash.update(c)).on('error', reject).on('end', () => resolve(hash.digest('hex')))
  })
}

/** The UTC timestamp a set is named after, e.g. 20261118T020000Z. */
export function setName(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

function setTime(name) {
  const m = name.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN
}

/**
 * The sets to delete: older than `retentionDays`, never the newest `keepMin` (so a stopped schedule
 * cannot age every backup away), and only directories named like a set.
 */
export function expiredSets(names, { now = Date.now(), retentionDays = 14, keepMin = 3 } = {}) {
  const sets = names.filter((n) => SET_NAME.test(n)).sort().reverse()
  const cutoff = now - retentionDays * 86_400_000
  return sets.slice(keepMin).filter((n) => setTime(n) < cutoff)
}

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.on('data', (c) => (stderr += c))
  const done = new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.slice(0, 6).join(' ')} … exited ${code}: ${stderr.trim().slice(-400)}`))))
  })
  return { stdout: child.stdout, done }
}

async function capture(dest, key, cmd, args) {
  const { stdout, done } = run(cmd, args)
  await Promise.all([encryptTo(stdout, dest, key), done])
}

function loadSettings(argv) {
  const arg = (name) => {
    const i = argv.indexOf(name)
    return i >= 0 ? argv[i + 1] : undefined
  }
  const envFile = arg('--env-file') || path.join(HERE, '.env.staging')
  const fileVars = fs.existsSync(envFile) ? parseEnv(fs.readFileSync(envFile, 'utf8')) : {}
  const retentionDays = Number(arg('--retention-days') || process.env.BACKUP_RETENTION_DAYS || 14)
  if (!Number.isFinite(retentionDays) || retentionDays < 1) throw new Error('--retention-days must be at least 1')
  return {
    envFile,
    key: parseKey(process.env.BACKUP_ENCRYPTION_KEY || fileVars.BACKUP_ENCRYPTION_KEY),
    // Retired keys, for decrypt and verify only; a malformed one is an error.
    previousKeys: parsePreviousKeys(process.env.BACKUP_ENCRYPTION_KEY_PREVIOUS || fileVars.BACKUP_ENCRYPTION_KEY_PREVIOUS),
    out: path.resolve(arg('--out') || process.env.BACKUP_DIR || path.join(HERE, 'backups')),
    retentionDays,
    volumes: !argv.includes('--no-volumes'),
    project: arg('--project') || 'apex-staging',
  }
}

async function backup(argv) {
  const s = loadSettings(argv)
  const compose = ['compose', '-f', path.join(HERE, 'compose.yml'), '--env-file', s.envFile]
  const name = setName()
  const dir = path.join(s.out, name)
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
  const files = []
  const step = async (file, args) => {
    const dest = path.join(dir, file)
    await capture(dest, s.key, 'docker', args)
    files.push({ file, bytes: fs.statSync(dest).size, sha256: await sha256File(dest) })
    console.log(`  ${file}`)
  }
  try {
    for (const db of DATABASES) await step(`${db}.dump.enc`, [...compose, 'exec', '-T', 'postgres', 'pg_dump', '-U', 'postgres', '-Fc', db])
    await step('globals.sql.enc', [...compose, 'exec', '-T', 'postgres', 'pg_dumpall', '-U', 'postgres', '--globals-only'])
    if (s.volumes) {
      for (const v of VOLUMES) await step(`${v}.tgz.enc`, ['run', '--rm', '--network', 'none', '-v', `${s.project}_${v}:/v:ro`, 'alpine:3.20', 'tar', 'czf', '-', '-C', '/v', '.'])
    }
  } catch (error) {
    fs.rmSync(dir, { recursive: true, force: true })
    throw new Error(`backup failed, incomplete set removed: ${error.message}`)
  }
  const manifest = { set: name, created: new Date().toISOString(), cipher: 'aes-256-gcm', format: 'APEXBK1', files }
  fs.writeFileSync(path.join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  console.log(`  Backup set ${dir} (${files.length} files)`)

  const expired = expiredSets(fs.readdirSync(s.out), { retentionDays: s.retentionDays })
  for (const old of expired) {
    fs.rmSync(path.join(s.out, old), { recursive: true, force: true })
    console.log(`  Removed expired set ${old} (retention ${s.retentionDays} days)`)
  }
}

async function verify(argv) {
  const s = loadSettings(argv)
  const target = argv[1] && !argv[1].startsWith('--') ? path.resolve(argv[1]) : path.join(s.out, fs.readdirSync(s.out).filter((n) => SET_NAME.test(n)).sort().pop() || '')
  const manifest = JSON.parse(fs.readFileSync(path.join(target, 'manifest.json'), 'utf8'))
  let ok = true
  for (const f of manifest.files) {
    const file = path.join(target, f.file)
    const good = fs.existsSync(file) && (await sha256File(file)) === f.sha256 && (await verifyFile(file, [s.key, ...s.previousKeys]))
    console.log(`  ${good ? 'ok  ' : 'FAIL'} ${f.file}`)
    ok &&= good
  }
  if (!ok) throw new Error(`set ${target} failed verification`)
  console.log(`  Set ${manifest.set} verified: ${manifest.files.length} files`)
}

export async function main(argv) {
  if (argv[0] === 'decrypt') {
    if (!argv[1] || !argv[2]) throw new Error('usage: backup.mjs decrypt <file.enc> <out>')
    const s = loadSettings(argv.slice(3))
    await decryptFile(argv[1], argv[2], [s.key, ...s.previousKeys])
    console.log(`  Decrypted ${argv[1]} -> ${argv[2]}`)
    return
  }
  if (argv[0] === 'verify') return verify(argv)
  return backup(argv)
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`  backup: ${error.message}`)
    process.exit(1)
  })
}
