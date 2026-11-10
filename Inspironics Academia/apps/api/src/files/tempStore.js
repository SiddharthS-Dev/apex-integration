import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { log } from '../lib/logger.js';

// Temporary processing storage (TEMP_PROCESSING_DIR): one unique directory per processing run, with an
// owner file naming the job that uses it. Directories are removed when their run finishes (success or
// failure), and abandoned ones — older than TEMP_MAX_AGE_HOURS whose job is no longer active — are
// cleaned on startup and by the storage clean-up. Permanent outputs never live here.

const OWNER = '.owner.json';
const live = new Set(); // directories in use by this process

/** Creates a unique temporary directory for `purpose` (and job, when there is one). */
export async function createTempDir(purpose, { jobId = null } = {}) {
  await fsp.mkdir(config.storage.tempDir, { recursive: true });
  const name = `${String(purpose).replace(/[^a-z0-9-]/gi, '-').slice(0, 30)}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const dir = path.join(config.storage.tempDir, name);
  await fsp.mkdir(dir);
  await fsp.writeFile(path.join(dir, OWNER), JSON.stringify({ purpose, jobId, pid: process.pid, created_at: new Date().toISOString() }));
  live.add(dir);
  return dir;
}

/** Removes a temporary directory (logs, never throws). */
export async function releaseTempDir(dir) {
  live.delete(dir);
  if (!dir || !path.resolve(dir).startsWith(path.resolve(config.storage.tempDir))) return;
  try {
    await fsp.rm(dir, { recursive: true, force: true });
  } catch (err) {
    log.warn('storage.temp_cleanup_failed', { dir: path.basename(dir), error: err.message });
  }
}

/** Runs `fn(dir)` with a temporary directory that is removed afterwards, whatever happens. */
export async function withTempDir(purpose, fn, opts) {
  const dir = await createTempDir(purpose, opts);
  try {
    return await fn(dir);
  } finally {
    await releaseTempDir(dir);
  }
}

async function dirSize(dir) {
  let total = 0;
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const p = path.join(dir, e.name);
    total += e.isDirectory() ? await dirSize(p) : (await fsp.stat(p).catch(() => ({ size: 0 }))).size;
  }
  return total;
}

async function activeJobIds() {
  try {
    return new Set((await db().query("SELECT id FROM jobs WHERE status IN ('queued', 'processing')")).map((r) => r.id));
  } catch {
    return new Set();
  }
}

/** What is in temporary storage: directories, bytes, and which are abandoned (safe to remove). */
export async function inspectTempStorage({ maxAgeHours = config.storage.tempMaxAgeHours } = {}) {
  const root = config.storage.tempDir;
  const entries = await fsp.readdir(root, { withFileTypes: true }).catch(() => []);
  const active = await activeJobIds();
  const cutoff = Date.now() - maxAgeHours * 3600_000;
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    let owner = {};
    try { owner = JSON.parse(await fsp.readFile(path.join(dir, OWNER), 'utf8')); } catch { /* unknown owner */ }
    const created = Date.parse(owner.created_at || '') || (await fsp.stat(dir)).mtimeMs;
    const inUse = live.has(dir) || (owner.jobId && active.has(owner.jobId));
    dirs.push({ dir, name: e.name, purpose: owner.purpose || 'unknown', jobId: owner.jobId || null, bytes: await dirSize(dir), created_at: new Date(created).toISOString(), in_use: !!inUse, abandoned: !inUse && created < cutoff });
  }
  return { root, dirs, bytes: dirs.reduce((n, d) => n + d.bytes, 0) };
}

/** Removes abandoned temporary directories (never ones in use by this process or an active job). */
export async function cleanupAbandonedTemp({ maxAgeHours, dryRun = false } = {}) {
  const { dirs } = await inspectTempStorage({ maxAgeHours });
  const victims = dirs.filter((d) => d.abandoned);
  if (!dryRun) for (const d of victims) await releaseTempDir(d.dir);
  return { removed: victims.length, bytes: victims.reduce((n, d) => n + d.bytes, 0), dry_run: dryRun };
}
