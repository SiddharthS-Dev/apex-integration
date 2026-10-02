import { config, dropboxConfigured } from '../config.js';
import { db } from '../db/index.js';
import { loadConnection } from '../dropbox/connection.js';
import { log } from '../lib/logger.js';
import { SYNC_LOCK, runSync } from './pipeline.js';

// Periodic Dropbox sync. Timers are unref'd so they never keep the process alive. Each tick checks
// the connection afresh, so connecting Dropbox later starts syncing without a restart. A tick while
// a run is in progress (here or on another instance) is skipped silently by the sync lock.

let timer = null;
let startupTimer = null;
let nextAt = null;

const intervalMs = () => Math.max(1, Number(config.syncIntervalMinutes) || 30) * 60_000;

async function tick(trigger) {
  try {
    if (!dropboxConfigured() || !(await loadConnection())) return;
    const r = await runSync({ trigger });
    if (!r.started) log.debug('sync.skipped', { trigger, reason: r.reason });
  } catch (err) {
    log.error('sync.scheduler_error', { trigger, error: err.message });
  }
}

function schedule() {
  nextAt = new Date(Date.now() + intervalMs());
  timer = setTimeout(async () => {
    await tick('scheduled');
    if (timer) schedule();
  }, intervalMs());
  timer.unref();
}

export function startScheduler() {
  if (timer || !dropboxConfigured()) return;
  // SQLite is single-host: a sync lease left by a crashed previous process can't still be live.
  (async () => {
    try {
      if (db().dialect === 'sqlite') await db().run('DELETE FROM locks WHERE name = ?', [SYNC_LOCK]);
    } catch { /* table not ready — ignore */ }
  })();
  schedule();
  if (config.syncOnStartup) {
    startupTimer = setTimeout(() => tick('startup'), 5_000);
    startupTimer.unref();
  }
  log.info('sync.scheduler_started', { interval_minutes: config.syncIntervalMinutes, on_startup: config.syncOnStartup });
}

export function stopScheduler() {
  clearTimeout(timer);
  clearTimeout(startupTimer);
  timer = null;
  startupTimer = null;
  nextAt = null;
}

export function nextRunAt() {
  return nextAt ? nextAt.toISOString() : null;
}
