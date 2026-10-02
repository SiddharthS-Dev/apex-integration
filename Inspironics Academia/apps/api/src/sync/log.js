import { db } from '../db/index.js';

// sync_log rows: one per synchronization run.

const COUNT_FIELDS = ['discovered', 'added', 'updated', 'unchanged', 'archived', 'failed'];

function toRow(r) {
  if (!r) return null;
  let errors = [];
  try { errors = r.errors ? JSON.parse(r.errors) : []; } catch { errors = []; }
  const out = { ...r, errors, duration_ms: r.duration_ms === null ? null : Number(r.duration_ms) };
  for (const f of COUNT_FIELDS) out[f] = Number(r[f] || 0);
  return out;
}

export async function insertSyncLog({ id, trigger, startedAt }) {
  await db().run('INSERT INTO sync_log (id, trigger, status, started_at, errors) VALUES (?, ?, ?, ?, ?)', [id, trigger, 'running', startedAt, '[]']);
}

export async function finishSyncLog(id, { status, counts, errors, finishedAt, durationMs }) {
  await db().run(
    `UPDATE sync_log SET status = ?, finished_at = ?, duration_ms = ?, ${COUNT_FIELDS.map((f) => `${f} = ?`).join(', ')}, errors = ? WHERE id = ?`,
    [status, finishedAt, durationMs, ...COUNT_FIELDS.map((f) => counts[f] || 0), JSON.stringify(errors.slice(0, 200)), id],
  );
}

export async function recentSyncLogs(limit = 50) {
  const n = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const rows = await db().query('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ?', [n]);
  return rows.map(toRow);
}

export async function latestSyncLog() {
  const [row] = await recentSyncLogs(1);
  return row || null;
}

// A run marked 'running' whose process died never gets finished; closed out at server startup (when
// the sync lock is free) and before each new run.
export async function closeStaleRuns() {
  await db().run("UPDATE sync_log SET status = 'failed', finished_at = ?, errors = ? WHERE status = 'running'", [
    new Date().toISOString(), JSON.stringify(['Run was interrupted (process restarted)']),
  ]);
}
