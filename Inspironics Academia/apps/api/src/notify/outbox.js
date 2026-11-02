import { config } from '../config.js';
import { db } from '../db/index.js';
import { withLock } from '../db/locks.js';
import { log } from '../lib/logger.js';
import { newId } from '../repo/entities.js';
import { sendMail } from './mailer.js';

// Email outbox: every message is written to `email_outbox` first and sent by drainOutbox, so a
// provider outage delays mail instead of losing it or failing the request that raised it.
// Failed sends retry with exponential backoff (1, 2, 4, 8… minutes) up to EMAIL_MAX_ATTEMPTS.

const nowIso = () => new Date().toISOString();
const DRAIN_LOCK = 'email:outbox';
const BATCH = 25;

/** Queues a message. Returns false when `dedupeKey` was already queued (nothing is added). */
export async function enqueueEmail({ userId, to, kind, subject, text, html, dedupeKey }) {
  const now = nowIso();
  const r = await db().run(
    `INSERT INTO email_outbox (id, user_id, to_email, kind, subject, text_body, html_body, status, attempts, next_attempt_at, dedupe_key, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)
     ON CONFLICT(dedupe_key) DO NOTHING`,
    [newId(), userId || null, to, kind, subject, text, html || null, now, dedupeKey || null, now],
  );
  return r.changes > 0;
}

async function sendOne(row) {
  try {
    await sendMail({ to: row.to_email, subject: row.subject, text: row.text_body, html: row.html_body });
    await db().run("UPDATE email_outbox SET status = 'sent', attempts = attempts + 1, sent_at = ?, last_error = NULL WHERE id = ?", [nowIso(), row.id]);
    return true;
  } catch (err) {
    const attempts = Number(row.attempts) + 1;
    const final = attempts >= config.email.maxAttempts;
    const retryAt = new Date(Date.now() + 2 ** (attempts - 1) * 60_000).toISOString();
    await db().run(
      'UPDATE email_outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ? WHERE id = ?',
      [final ? 'failed' : 'queued', attempts, retryAt, String(err.message || err).slice(0, 1000), row.id],
    );
    log.warn('email.send_failed', { id: row.id, kind: row.kind, attempts, final, error: err.message });
    return false;
  }
}

/** Sends queued messages that are due. One drain at a time across instances. Returns { sent, failed }. */
export async function drainOutbox() {
  const { acquired, result } = await withLock(DRAIN_LOCK, async () => {
    let sent = 0;
    let failed = 0;
    for (;;) {
      const rows = await db().query(
        "SELECT * FROM email_outbox WHERE status = 'queued' AND next_attempt_at <= ? ORDER BY created_at LIMIT ?",
        [nowIso(), BATCH],
      );
      for (const row of rows) (await sendOne(row)) ? (sent += 1) : (failed += 1);
      if (rows.length < BATCH) break;
    }
    return { sent, failed };
  }, { ttlMs: 10 * 60_000 });
  return acquired ? result : { sent: 0, failed: 0, skipped: true };
}

/** Counts by status and the most recent messages, for the admin Integrations page. */
export async function outboxStatus(limit = 50) {
  const counts = { queued: 0, sent: 0, failed: 0 };
  for (const r of await db().query('SELECT status, COUNT(*) AS n FROM email_outbox GROUP BY status')) counts[r.status] = Number(r.n);
  const recent = await db().query(
    'SELECT id, user_id, to_email, kind, subject, status, attempts, last_error, created_at, sent_at FROM email_outbox ORDER BY created_at DESC LIMIT ?',
    [Math.min(Number(limit) || 50, 200)],
  );
  return { outbox: counts, recent: recent.map((r) => ({ ...r, attempts: Number(r.attempts) })) };
}
