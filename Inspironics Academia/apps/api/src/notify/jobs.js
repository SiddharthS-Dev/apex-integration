import { actionItemReminders, addDays, dueReviewCounts, runComplianceChecks, utcToday } from '@academy/shared';
import { config } from '../config.js';
import { withLock } from '../db/locks.js';
import { log } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { getSetting, setSetting } from '../repo/settings.js';
import { store } from '../repo/store.js';
import { notify } from './index.js';
import { drainOutbox } from './outbox.js';

// Background jobs: the email outbox drains every minute; the daily pass (flashcard review reminders,
// certificate expiry, recertification reminders, action items due or overdue, old read notifications)
// runs once per UTC day from JOBS_HOUR_UTC on.
// Timers are unref'd, a lock keeps instances from overlapping, and every notice has a dedupe key.

const DAILY_LOCK = 'jobs:daily';
const LAST_RUN = 'jobs.daily_last_run';
const KEEP_READ_DAYS = 90;

let outboxTimer = null;
let dailyTimer = null;

/** The daily pass. Returns what it did; safe to run repeatedly on the same day. */
export async function runDailyJobs({ today = utcToday() } = {}) {
  const { acquired, result } = await withLock(DAILY_LOCK, async () => {
    let reminders = 0;
    for (const { user_id: userId, count } of await dueReviewCounts(store, today)) {
      if (await notify(userId, 'review_due', { count }, `review_due:${userId}:${today}`)) reminders += 1;
    }
    const compliance = await runComplianceChecks(store, { today, notify });
    const actions = await actionItemReminders(store, { today, notify });
    // Read notifications are kept for KEEP_READ_DAYS; unread ones stay until read.
    const { deleted } = await entities.Notification.deleteMany({ read: true, created_date: { $lt: addDays(today, -KEEP_READ_DAYS) } });
    await setSetting(LAST_RUN, today);
    return {
      today, review_reminders: reminders, ...compliance,
      action_items_due: actions.due_soon, action_items_overdue: actions.overdue, notifications_purged: deleted,
    };
  }, { ttlMs: 30 * 60_000 });
  if (!acquired) return { skipped: true };
  log.info('jobs.daily_done', result);
  return result;
}

async function dailyTick() {
  try {
    if (new Date().getUTCHours() < config.jobsHourUtc) return;
    if ((await getSetting(LAST_RUN)) === utcToday()) return;
    await runDailyJobs();
  } catch (err) {
    log.error('jobs.daily_failed', { error: err.message });
  }
}

export function startJobs() {
  if (!config.jobsEnabled || outboxTimer) return;
  outboxTimer = setInterval(() => drainOutbox().catch((err) => log.warn('email.drain_failed', { error: err.message })), 60_000);
  outboxTimer.unref();
  dailyTimer = setInterval(dailyTick, 15 * 60_000);
  dailyTimer.unref();
  setTimeout(dailyTick, 10_000).unref();
  log.info('jobs.started', { daily_hour_utc: config.jobsHourUtc });
}

export function stopJobs() {
  clearInterval(outboxTimer);
  clearInterval(dailyTimer);
  outboxTimer = null;
  dailyTimer = null;
}
