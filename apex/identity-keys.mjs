/**
 * The keys the gateway signs identity assertions with (R1 identity contract §4.1).
 *
 *   node apex/identity-keys.mjs            show the key ids (never the keys)
 *   node apex/identity-keys.mjs init       create the file if it does not exist
 *   node apex/identity-keys.mjs rotate     add a new current kid, keep the previous one for overlap
 *   node apex/identity-keys.mjs prune      drop every kid but the current one
 *
 * File: apex/.identity-keys.json (gitignored, mode 0600; APEX_IDENTITY_KEYS_FILE
 * overrides the location):
 *
 *   { "current": "<kid>", "keys": { "<kid>": { "core": "<b64>", "showcase": "<b64>", "slidesvault": "<b64>" } } }
 *
 * Each value is 32 random bytes. One key per audience, so a leaked application
 * key lets nobody impersonate users to another application.
 *
 * Keys are read when a process starts. After rotate or prune, restart Apex
 * (start.bat / stop.bat), so the gateway and every application agree; see
 * docs/operations/IDENTITY_ASSERTION.md. Dependency-free.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))

export const AUDIENCES = Object.freeze(['core', 'showcase', 'slidesvault'])
export const keysFile = () => process.env.APEX_IDENTITY_KEYS_FILE || path.join(HERE, '.identity-keys.json')

const KID_RE = /^[A-Za-z0-9_-]{1,64}$/

const newKid = () => `k${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${crypto.randomBytes(4).toString('hex')}`
const newKeySet = () => Object.fromEntries(AUDIENCES.map((a) => [a, crypto.randomBytes(32).toString('base64')]))

/** Throws unless `store` has the shape above, with 32-byte keys for every audience. */
export function validateStore(store) {
  if (!store || typeof store !== 'object' || !store.keys || typeof store.keys !== 'object') throw new Error('identity keys: missing "keys"')
  if (!KID_RE.test(String(store.current)) || !store.keys[store.current]) throw new Error('identity keys: "current" does not name a key')
  for (const [kid, set] of Object.entries(store.keys)) {
    if (!KID_RE.test(kid)) throw new Error(`identity keys: bad kid "${kid}"`)
    for (const audience of AUDIENCES) {
      if (typeof set?.[audience] !== 'string' || Buffer.from(set[audience], 'base64').length !== 32) {
        throw new Error(`identity keys: kid "${kid}" has no 32-byte "${audience}" key`)
      }
    }
  }
  return store
}

/** The stored keys, or null when the file does not exist. Throws on a malformed file. */
export function readKeys(file = keysFile()) {
  let text
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
  return validateStore(JSON.parse(text))
}

/** Replaces the file atomically, owner-only. */
function writeKeys(file, store) {
  validateStore(store)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 })
  fs.renameSync(tmp, file)
  try {
    fs.chmodSync(file, 0o600)
  } catch {
    /* not supported on this filesystem (Windows ignores it) */
  }
  return store
}

/**
 * The keys, created on first use. Several Apex processes start at once, so
 * creation is exclusive (`wx`): whoever loses the race reads the winner's file.
 */
export function loadKeys(file = keysFile()) {
  const existing = readKeys(file)
  if (existing) return existing
  const kid = newKid()
  const fresh = { current: kid, keys: { [kid]: newKeySet() } }
  try {
    fs.writeFileSync(file, `${JSON.stringify(fresh, null, 2)}\n`, { mode: 0o600, flag: 'wx' })
    return fresh
  } catch (error) {
    if (error.code === 'EEXIST') return readKeys(file)
    throw error
  }
}

/**
 * The keys a gateway process signs with: APEX_IDENTITY_KEYS_STORE when set — the whole store as
 * JSON, in the file's format — else the file (created on first use, as loadKeys does).
 *
 * The variable exists for containers (deploy/staging), where the store arrives from the
 * orchestrator's secrets rather than a file the process may write. It is validated exactly like
 * the file; a malformed value throws, so the gateway refuses to start rather than run unsigned.
 * Unset (the default), nothing changes. Rotation there means replacing the value and restarting
 * every service (docs/operations/STAGING_RUNBOOK.md).
 */
export function loadKeyStore({ env = process.env, file = keysFile() } = {}) {
  const inline = String(env.APEX_IDENTITY_KEYS_STORE ?? '').trim()
  if (!inline) return loadKeys(file)
  let parsed
  try {
    parsed = JSON.parse(inline)
  } catch {
    throw new Error('identity keys: APEX_IDENTITY_KEYS_STORE is not valid JSON')
  }
  return validateStore(parsed)
}

/** Adds a new current kid and keeps the one it replaces; anything older is dropped. */
export function rotate(file = keysFile()) {
  const store = loadKeys(file)
  let kid = newKid()
  while (store.keys[kid]) kid = newKid()
  return writeKeys(file, { current: kid, keys: { [store.current]: store.keys[store.current], [kid]: newKeySet() } })
}

/** Drops every kid but the current one. */
export function prune(file = keysFile()) {
  const store = loadKeys(file)
  return writeKeys(file, { current: store.current, keys: { [store.current]: store.keys[store.current] } })
}

/**
 * What one process is given as APEX_IDENTITY_KEYS: `{ kid: b64 }` for its own
 * audience only, current and previous.
 */
export function keysFor(store, audience) {
  if (!AUDIENCES.includes(audience)) throw new Error(`identity keys: unknown audience "${audience}"`)
  return Object.fromEntries(Object.entries(store.keys).map(([kid, set]) => [kid, set[audience]]))
}

/** The current kid and key the gateway signs with for `audience`. */
export function signingKey(store, audience) {
  if (!AUDIENCES.includes(audience)) throw new Error(`identity keys: unknown audience "${audience}"`)
  return { kid: store.current, key: Buffer.from(store.keys[store.current][audience], 'base64') }
}

/* ------------------------------------------------------------------ CLI -- */

const isMain = (() => {
  try {
    const a = path.resolve(process.argv[1] || '')
    const b = fileURLToPath(import.meta.url)
    return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b
  } catch {
    return false
  }
})()

if (isMain) {
  const command = process.argv[2] || 'show'
  const file = keysFile()
  const describe = (store) => {
    console.log(`  file     ${file}`)
    console.log(`  current  ${store.current}`)
    for (const kid of Object.keys(store.keys)) if (kid !== store.current) console.log(`  previous ${kid}`)
  }
  try {
    if (command === 'show') {
      const store = readKeys(file)
      if (!store) console.log(`  No identity keys yet (${file}). Run: node apex/identity-keys.mjs init`)
      else describe(store)
    } else if (command === 'init') describe(loadKeys(file))
    else if (command === 'rotate') {
      describe(rotate(file))
      console.log('\n  Restart Apex so the gateway and every application pick the new key up.')
      console.log('  Once every process runs with it, prune the previous kid: node apex/identity-keys.mjs prune')
    } else if (command === 'prune') {
      describe(prune(file))
      console.log('\n  Restart Apex. Assertions signed with a pruned kid are refused from now on.')
    } else {
      console.error(`  Unknown command "${command}". Use show, init, rotate or prune.`)
      process.exit(2)
    }
  } catch (error) {
    console.error(`  ${error.message}`)
    process.exit(1)
  }
}

/**
 * Variables only the gateway may hold: the whole key store (every audience's keys) and the gateway's
 * own secret files. A child app inheriting them could forge assertions for other apps or service
 * calls to the Core (security review L2). Each child gets only its own keys via identityEnv().
 */
export const GATEWAY_ONLY_ENV = Object.freeze(['APEX_IDENTITY_KEYS_STORE', 'APEX_IDENTITY_KEYS_FILE', 'APEX_SESSION_SECRET_FILE'])

/** The environment for a child process: the parent's, minus gateway-only variables, plus its own. */
export function childEnv(parent, own = {}) {
  const env = { ...parent }
  for (const name of GATEWAY_ONLY_ENV) delete env[name]
  return { ...env, ...own }
}
