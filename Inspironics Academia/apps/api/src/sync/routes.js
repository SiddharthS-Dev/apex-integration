import express from 'express';
import { config, dropboxConfigured } from '../config.js';
import { requireAdmin } from '../auth/sessions.js';
import { isLocked } from '../db/locks.js';
import { loadConnection } from '../dropbox/connection.js';
import { HttpError, asyncHandler } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { latestSyncLog, recentSyncLogs } from './log.js';
import { ALREADY_RUNNING, SYNC_LOCK, runSync } from './pipeline.js';
import { nextRunAt } from './scheduler.js';

const router = express.Router();
router.use(requireAdmin);

router.get('/status', asyncHandler(async (_req, res) => {
  const connected = dropboxConfigured() && !!(await loadConnection());
  res.json({
    running: await isLocked(SYNC_LOCK),
    last: await latestSyncLog(),
    next_run_at: connected ? nextRunAt() : null,
    interval_minutes: config.syncIntervalMinutes,
    connected,
  });
}));

router.post('/run', asyncHandler(async (req, res) => {
  if (!dropboxConfigured()) throw new HttpError(503, 'Dropbox is not configured');
  if (!(await loadConnection())) throw new HttpError(409, 'Dropbox is not connected');
  if (await isLocked(SYNC_LOCK)) return res.status(409).json({ error: ALREADY_RUNNING });
  // Background run; the lock inside runSync is the real guard against a race with another trigger.
  runSync({ trigger: 'manual' })
    .then((r) => { if (!r.started) log.info('sync.manual_skipped', { reason: r.reason, by: req.user.id }); })
    .catch((err) => log.error('sync.manual_failed', { error: err.message }));
  res.status(202).json({ started: true });
}));

router.get('/logs', asyncHandler(async (req, res) => {
  res.json(await recentSyncLogs(req.query.limit));
}));

export default router;
