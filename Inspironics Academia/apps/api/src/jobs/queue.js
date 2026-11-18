import crypto from 'node:crypto';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { HttpError, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { runWithGeneration } from '../usage/context.js';

// A small database-backed job queue for heavy work (video rendering), run inside the API process.
// Statuses: queued → processing → completed | failed | cancelled. One active job per dedupe key (a
// second request for the same video returns the running job). Workers run at most MAX_CONCURRENT_JOBS
// at a time; progress, messages and results are stored so the web app shows real status. A job that
// fails is retried (with a delay) up to max_attempts unless it was cancelled or cannot succeed; a job
// interrupted by a restart is queued again.

const handlers = new Map();
const running = new Map(); // job id → AbortController
const ACTIVE = ['queued', 'processing'];
let timer = null;

export function registerJobHandler(type, fn) {
  handlers.set(type, fn);
}

const now = () => new Date().toISOString();
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch { return null; } };

export function publicJob(row) {
  if (!row) return null;
  return {
    id: row.id, type: row.type, status: row.status, progress: Number(row.progress) || 0, message: row.message || '',
    error: row.error || null, result: parse(row.result), attempts: Number(row.attempts) || 0, max_attempts: Number(row.max_attempts) || 1,
    ref_type: row.ref_type, ref_id: row.ref_id, created_by: row.created_by, created_at: row.created_at, updated_at: row.updated_at,
    started_at: row.started_at, finished_at: row.finished_at, cancel_requested: !!Number(row.cancel_requested),
  };
}

export async function getJob(id) {
  const [row] = await db().query('SELECT * FROM jobs WHERE id = ?', [id]);
  return publicJob(row);
}

export async function listJobs({ refType, refId, status, limit = 50 } = {}) {
  const where = [];
  const args = [];
  if (refType) { where.push('ref_type = ?'); args.push(refType); }
  if (refId) { where.push('ref_id = ?'); args.push(refId); }
  if (status) { where.push('status = ?'); args.push(status); }
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const rows = await db().query(`SELECT * FROM jobs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ${lim}`, args);
  return rows.map(publicJob);
}

/** Creates a job, or returns the active one with the same dedupe key ({ ...job, deduplicated: true }). */
export async function enqueueJob({ type, payload = {}, dedupeKey = null, refType = null, refId = null, userId = null, maxAttempts = 2 }) {
  if (!handlers.has(type)) throw new Error(`No handler for job type ${type}`);
  if (dedupeKey) {
    const [active] = await db().query(`SELECT * FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'processing') ORDER BY created_at DESC LIMIT 1`, [dedupeKey]);
    if (active) return { ...publicJob(active), deduplicated: true };
  }
  const id = crypto.randomUUID();
  const t = now();
  await db().run(
    `INSERT INTO jobs (id, type, status, payload, progress, message, attempts, max_attempts, dedupe_key, ref_type, ref_id, cancel_requested, created_by, created_at, updated_at, run_after)
     VALUES (?, ?, 'queued', ?, 0, 'Waiting to start', 0, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
    [id, type, JSON.stringify(payload), maxAttempts, dedupeKey, refType, refId, userId, t, t, t],
  );
  setImmediate(tick);
  return getJob(id);
}

export async function cancelJob(id) {
  const job = await getJob(id);
  if (!job) throw notFound('Job not found');
  if (job.status === 'queued') {
    await db().run("UPDATE jobs SET status = 'cancelled', message = 'Cancelled', finished_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'", [now(), now(), id]);
  } else if (job.status === 'processing') {
    await db().run('UPDATE jobs SET cancel_requested = 1, message = ?, updated_at = ? WHERE id = ?', ['Cancelling…', now(), id]);
    running.get(id)?.abort();
  } else {
    throw new HttpError(409, `This job is already ${job.status}`);
  }
  return getJob(id);
}

export async function retryJob(id) {
  const job = await getJob(id);
  if (!job) throw notFound('Job not found');
  if (!['failed', 'cancelled'].includes(job.status)) throw new HttpError(409, `Only failed or cancelled jobs can be retried (this one is ${job.status})`);
  const [row] = await db().query('SELECT dedupe_key FROM jobs WHERE id = ?', [id]);
  if (row?.dedupe_key) {
    const [active] = await db().query("SELECT id FROM jobs WHERE dedupe_key = ? AND status IN ('queued', 'processing')", [row.dedupe_key]);
    if (active) return { ...(await getJob(active.id)), deduplicated: true };
  }
  await db().run(
    "UPDATE jobs SET status = 'queued', error = NULL, result = NULL, progress = 0, message = 'Waiting to start', attempts = 0, cancel_requested = 0, finished_at = NULL, started_at = NULL, run_after = ?, updated_at = ? WHERE id = ?",
    [now(), now(), id],
  );
  setImmediate(tick);
  return getJob(id);
}

async function claimNext() {
  const [row] = await db().query("SELECT * FROM jobs WHERE status = 'queued' AND (run_after IS NULL OR run_after <= ?) ORDER BY created_at LIMIT 1", [now()]);
  if (!row) return null;
  const t = now();
  const r = await db().run("UPDATE jobs SET status = 'processing', attempts = attempts + 1, started_at = ?, updated_at = ?, message = 'Starting' WHERE id = ? AND status = 'queued'", [t, t, row.id]);
  return r.changes ? { ...row, attempts: Number(row.attempts) + 1 } : null;
}

async function runJob(row) {
  const controller = new AbortController();
  running.set(row.id, controller);
  const progress = async (pct, message) => {
    await db().run('UPDATE jobs SET progress = ?, message = ?, updated_at = ? WHERE id = ?', [Math.max(0, Math.min(100, Math.round(pct))), String(message || '').slice(0, 300), now(), row.id]).catch(() => {});
  };
  try {
    const handler = handlers.get(row.type);
    if (!handler) throw new Error(`No handler for job type ${row.type}`);
    const result = await runWithGeneration(
      { operation: row.type, userId: row.created_by, refType: row.ref_type, refId: row.ref_id },
      () => handler(parse(row.payload) || {}, { progress, signal: controller.signal, jobId: row.id }),
    );
    await db().run("UPDATE jobs SET status = 'completed', progress = 100, message = 'Done', result = ?, finished_at = ?, updated_at = ? WHERE id = ?", [JSON.stringify(result ?? null), now(), now(), row.id]);
  } catch (err) {
    const cancelled = controller.signal.aborted || err?.cancelled;
    const final = cancelled || err?.status === 400 || err?.status === 404 || err?.code === 'usage_limit' || row.attempts >= Number(row.max_attempts || 1);
    if (cancelled) {
      await db().run("UPDATE jobs SET status = 'cancelled', message = 'Cancelled', finished_at = ?, updated_at = ? WHERE id = ?", [now(), now(), row.id]);
    } else if (final) {
      await db().run("UPDATE jobs SET status = 'failed', error = ?, message = 'Failed', finished_at = ?, updated_at = ? WHERE id = ?", [String(err?.message || err).slice(0, 1000), now(), now(), row.id]);
    } else {
      const delayMs = 15_000 * row.attempts;
      await db().run("UPDATE jobs SET status = 'queued', error = ?, message = ?, run_after = ?, updated_at = ? WHERE id = ?",
        [String(err?.message || err).slice(0, 1000), `Retrying (attempt ${row.attempts + 1} of ${row.max_attempts})`, new Date(Date.now() + delayMs).toISOString(), now(), row.id]);
    }
    log.warn('jobs.failed', { id: row.id, type: row.type, error: err?.message, final: !!final, cancelled: !!cancelled });
  } finally {
    running.delete(row.id);
  }
}

async function tick() {
  if (!timer) return; // the worker is not running (e.g. stopped for maintenance or tests)
  try {
    // Cancellation requested from another instance / request: abort the local run.
    for (const [id, controller] of running) {
      const [row] = await db().query('SELECT cancel_requested FROM jobs WHERE id = ?', [id]);
      if (Number(row?.cancel_requested)) controller.abort();
    }
    while (running.size < config.maxConcurrentJobs) {
      const row = await claimNext();
      if (!row) break;
      runJob(row).finally(() => setImmediate(tick));
    }
  } catch (err) {
    log.error('jobs.tick_failed', { error: err.message });
  }
}

export async function startJobWorker({ intervalMs = 2000 } = {}) {
  if (timer) return;
  // Jobs that were running when the server stopped start again.
  await db().run("UPDATE jobs SET status = 'queued', message = 'Restarting after a server restart', updated_at = ? WHERE status = 'processing'", [now()]).catch(() => {});
  timer = setInterval(tick, intervalMs);
  timer.unref();
  setImmediate(tick);
}

export function stopJobWorker() {
  clearInterval(timer);
  timer = null;
  for (const c of running.values()) c.abort();
}

/** Waits until a job finishes (for tests and scripts). */
export async function waitForJob(id, { timeoutMs = 300_000, pollMs = 200 } = {}) {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const job = await getJob(id);
    if (!job || !ACTIVE.includes(job.status)) return job;
    if (Date.now() > until) throw new Error(`Job ${id} did not finish in time`);
    await new Promise((r) => setTimeout(r, pollMs));
  }
}
