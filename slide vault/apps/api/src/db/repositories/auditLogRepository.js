/**
 * Administrative audit trail.
 *
 * Details are redacted before they are written: an audit row records *that* a
 * connection happened and who did it, never the credential that was exchanged.
 */
import crypto from 'node:crypto';
import { redact } from '../../util/redact.js';

export class AuditLogRepository {
  constructor(db) {
    this.db = db;
  }

  async record({ actorId = '', actorEmail = '', action, target = '', outcome = 'success', ip = '', details = {} }) {
    const id = crypto.randomUUID();
    await this.db.execute(
      `INSERT INTO audit_log (id, actor_id, actor_email, action, target, outcome, ip, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        actorId,
        actorEmail,
        action,
        String(target).slice(0, 500),
        outcome,
        ip,
        JSON.stringify(redact(details ?? {})).slice(0, 20_000),
        new Date().toISOString(),
      ]
    );
    return id;
  }

  async list({ limit = 50, offset = 0, action = null } = {}) {
    const where = action ? 'WHERE action = ?' : '';
    const params = action ? [action] : [];
    const rows = await this.db.query(
      `SELECT * FROM audit_log ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [...params, Math.min(Number(limit) || 50, 500), Math.max(Number(offset) || 0, 0)]
    );
    return rows.map((row) => {
      let details = {};
      try {
        details = JSON.parse(row.details_json || '{}');
      } catch {
        details = {};
      }
      return { ...row, details };
    });
  }

  async purgeOlderThan(days) {
    const cutoff = new Date(Date.now() - days * 24 * 3600_000).toISOString();
    const result = await this.db.execute('DELETE FROM audit_log WHERE created_at < ?', [cutoff]);
    return result.changes;
  }
}
