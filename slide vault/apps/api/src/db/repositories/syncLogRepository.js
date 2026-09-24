/**
 * Sync run history.
 *
 * A row is opened when a run starts and closed when it ends, so a crashed or
 * killed run leaves a visible `running` row rather than no evidence at all.
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

export class SyncLogRepository {
  constructor(db) {
    this.db = db;
  }

  async start({ connectionId = '', trigger = 'manual', actorEmail = '', rootFolder = '' }) {
    const id = crypto.randomUUID();
    const startedAt = now();
    await this.db.execute(
      `INSERT INTO sync_log (id, connection_id, started_at, status, trigger, actor_email, root_folder, created_at)
       VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`,
      [id, connectionId, startedAt, trigger, actorEmail, rootFolder, startedAt]
    );
    return { id, startedAt };
  }

  async finish(id, { status, counts = {}, error = '', details = {} }) {
    const row = await this.db.queryOne('SELECT started_at FROM sync_log WHERE id = ?', [id]);
    const completedAt = now();
    const durationMs = row ? Date.parse(completedAt) - Date.parse(row.started_at) : 0;

    await this.db.execute(
      `UPDATE sync_log SET
         completed_at = ?, status = ?, total_files = ?, new_files = ?, updated_files = ?,
         deleted_files = ?, skipped_files = ?, failed_files = ?, duration_ms = ?,
         error = ?, details_json = ?
       WHERE id = ?`,
      [
        completedAt,
        status,
        counts.total ?? 0,
        counts.new ?? 0,
        counts.updated ?? 0,
        counts.deleted ?? 0,
        counts.skipped ?? 0,
        counts.failed ?? 0,
        Math.max(0, durationMs),
        String(error || '').slice(0, 2000),
        JSON.stringify(details ?? {}).slice(0, 100_000),
        id,
      ]
    );
    return this.findById(id);
  }

  async findById(id) {
    const row = await this.db.queryOne('SELECT * FROM sync_log WHERE id = ?', [id]);
    return row ? SyncLogRepository.hydrate(row) : null;
  }

  async list({ limit = 25, offset = 0 } = {}) {
    const rows = await this.db.query(
      'SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ? OFFSET ?',
      [Math.min(Number(limit) || 25, 200), Math.max(Number(offset) || 0, 0)]
    );
    return rows.map(SyncLogRepository.hydrate);
  }

  async latest() {
    const rows = await this.list({ limit: 1 });
    return rows[0] ?? null;
  }

  /**
   * Marks runs abandoned by a crashed process.
   *
   * Called at startup: a `running` row older than the lock TTL cannot belong to
   * a live run, and leaving it would make the dashboard claim a sync is in
   * flight forever.
   */
  async failStaleRuns(olderThanMs) {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const result = await this.db.execute(
      `UPDATE sync_log SET status = 'error', completed_at = ?, error = ?
       WHERE status = 'running' AND started_at < ?`,
      [now(), 'The process running this sync stopped before it completed.', cutoff]
    );
    return result.changes;
  }

  async purgeOlderThan(days) {
    const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    const result = await this.db.execute('DELETE FROM sync_log WHERE started_at < ?', [cutoff]);
    return result.changes;
  }

  static hydrate(row) {
    let details = {};
    try {
      details = JSON.parse(row.details_json || '{}');
    } catch {
      details = {};
    }
    return {
      ...row,
      total_files: Number(row.total_files ?? 0),
      new_files: Number(row.new_files ?? 0),
      updated_files: Number(row.updated_files ?? 0),
      deleted_files: Number(row.deleted_files ?? 0),
      skipped_files: Number(row.skipped_files ?? 0),
      failed_files: Number(row.failed_files ?? 0),
      duration_ms: Number(row.duration_ms ?? 0),
      details,
    };
  }
}
