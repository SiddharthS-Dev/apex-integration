import { buildNotification, emailAllowed } from '@academy/shared';
import { log } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { findUserById } from '../repo/users.js';
import { accountEmails, notificationEmail } from './templates.js';
import { drainOutbox, enqueueEmail } from './outbox.js';

// Notifications: an in-app Notification row for the user, plus an email when their
// NotificationPreference allows that kind. A dedupe key makes the whole thing idempotent — the daily
// jobs can run any number of times and each learner still hears about each thing once.

// Sending right away keeps interactive emails (reset links, invites) prompt; the jobs tick picks up
// whatever this misses.
function kickOutbox() {
  drainOutbox().catch((err) => log.warn('email.drain_failed', { error: err.message }));
}

/**
 * Notifies `userId` of `kind` (see NOTIFICATION_KINDS) built from `data`. Never throws: a failed
 * notification must not fail the action that raised it. Returns the Notification row, or null.
 */
export async function notify(userId, kind, data = {}, dedupeKey = '') {
  try {
    if (dedupeKey && (await entities.Notification.findOne({ dedupe_key: dedupeKey }))) return null;
    const user = await findUserById(userId);
    if (!user || user.disabled === true || user.disabled === 1) return null;

    const n = buildNotification(kind, data);
    const row = await entities.Notification.create({ user_id: userId, ...n, read: false, dedupe_key: dedupeKey || undefined });

    const prefs = await entities.NotificationPreference.findOne({ user_id: userId });
    if (user.email && emailAllowed(kind, prefs)) {
      const email = notificationEmail(n);
      await enqueueEmail({ userId, to: user.email, kind, ...email, dedupeKey: dedupeKey ? `n:${dedupeKey}` : null });
      kickOutbox();
    }
    return row;
  } catch (err) {
    log.error('notify.failed', { kind, user_id: userId, error: err.message });
    return null;
  }
}

/** Account email (password reset, invite, test) — sent whatever the preferences. Returns true when queued. */
export async function sendAccountEmail(kind, to, data = {}, { userId, send = true } = {}) {
  const email = accountEmails[kind](data);
  const queued = await enqueueEmail({ userId, to, kind, ...email });
  if (send) kickOutbox();
  return queued;
}
