/**
 * stored_file (the indexed library), sync_log, and plate_events (analytics).
 */
import { FILE_STATUS, PLATE_DEFAULTS, SYNC_STATUS, UNCLASSIFIED, tagForCategory } from '@inspironics/shared'
import { nowIso, parseJson } from '../db/index.js'
import { randomId } from '../lib/crypto.js'

/* ------------------------------------------------------ stored_file ------ */

export function createFilesRepo(db) {
  return {
    /** external_id -> { id, rev, processedRev, status } for every file ever seen. */
    async index() {
      const rows = await db.all(
        'SELECT id, external_id, rev, processed_rev, status, classification_status, title, title_source, meta, width, height FROM stored_file'
      )
      return new Map(
        rows.map((r) => [
          r.external_id,
          {
            id: r.id,
            rev: r.rev,
            processedRev: r.processed_rev,
            status: r.status,
            classificationStatus: r.classification_status,
            title: r.title,
            titleSource: r.title_source,
            meta: parseJson(r.meta, {}),
            width: r.width,
            height: r.height,
          },
        ])
      )
    },

    /** Refresh last-seen for files discovered unchanged, so the archive pass stays truthful. */
    async markSeen(ids, syncId) {
      const now = nowIso()
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500)
        await db.run(
          `UPDATE stored_file SET last_seen_sync_id = ?, last_seen_at = ?, status = ?, archived_at = NULL
           WHERE id IN (${chunk.map(() => '?').join(',')})`,
          [syncId, now, FILE_STATUS.ACTIVE, ...chunk]
        )
      }
    },

    /** Insert or replace a processed file. */
    async upsert(f) {
      const now = nowIso()
      await db.run(
        `INSERT INTO stored_file (id, external_id, path_lower, path_display, name, ext, kind, size, rev, content_hash,
            server_modified, status, processed_rev, title, title_source, meta, classification_status, confidence,
            width, height, warnings, error, last_seen_sync_id, first_seen_at, last_seen_at, updated_at, archived_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
         ON CONFLICT(external_id) DO UPDATE SET path_lower = excluded.path_lower, path_display = excluded.path_display,
            name = excluded.name, ext = excluded.ext, kind = excluded.kind, size = excluded.size, rev = excluded.rev,
            content_hash = excluded.content_hash, server_modified = excluded.server_modified, status = excluded.status,
            processed_rev = excluded.processed_rev, title = excluded.title, title_source = excluded.title_source,
            meta = excluded.meta, classification_status = excluded.classification_status, confidence = excluded.confidence,
            width = excluded.width, height = excluded.height, warnings = excluded.warnings, error = excluded.error,
            last_seen_sync_id = excluded.last_seen_sync_id, last_seen_at = excluded.last_seen_at,
            updated_at = excluded.updated_at, archived_at = NULL`,
        [
          f.id || randomId(),
          f.externalId,
          f.pathLower,
          f.pathDisplay,
          f.name,
          f.ext,
          f.kind,
          f.size,
          f.rev,
          f.contentHash || null,
          f.serverModified || null,
          FILE_STATUS.ACTIVE,
          f.processedRev,
          f.title,
          f.titleSource,
          JSON.stringify(f.meta || {}),
          f.classificationStatus,
          f.confidence ?? null,
          f.width ?? null,
          f.height ?? null,
          JSON.stringify(f.warnings || []),
          f.error || null,
          f.syncId,
          now,
          now,
          now,
        ]
      )
    },

    /**
     * Archive every active file this run did not see. Never deletes: the row,
     * its analytics and its classification survive, and a file that reappears
     * is simply reactivated.
     */
    async archiveUnseen(syncId) {
      const r = await db.run(
        `UPDATE stored_file SET status = ?, archived_at = ?
         WHERE status = ? AND (last_seen_sync_id IS NULL OR last_seen_sync_id <> ?)`,
        [FILE_STATUS.ARCHIVED, nowIso(), FILE_STATUS.ACTIVE, syncId]
      )
      return r.changes
    },

    get: (id) => db.get('SELECT * FROM stored_file WHERE id = ?', [id]),

    listActive: () => db.all('SELECT * FROM stored_file WHERE status = ? ORDER BY path_lower', [FILE_STATUS.ACTIVE]),

    incrementViews: (id) => db.run('UPDATE stored_file SET views = views + 1 WHERE id = ?', [id]),

    /** Admin edit of a plate's metadata; an admin's word outranks the classifier. */
    async updateMeta(id, { title, meta }) {
      const row = await db.get('SELECT meta, title, title_source FROM stored_file WHERE id = ?', [id])
      if (!row) return false
      const merged = { ...parseJson(row.meta, {}), ...(meta || {}) }
      await db.run(
        `UPDATE stored_file SET meta = ?, title = ?, title_source = ?,
           classification_status = 'admin', confidence = 1, updated_at = ? WHERE id = ?`,
        [JSON.stringify(merged), title || row.title, title ? 'admin' : row.title_source, nowIso(), id]
      )
      return true
    },

    async counts() {
      const rows = await db.all('SELECT status, CAST(COUNT(*) AS INTEGER) AS n FROM stored_file GROUP BY status')
      return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]))
    },
  }
}

/**
 * A stored_file row as the gallery's plate record. URLs are same-origin paths
 * on this API — never a Dropbox link.
 * @returns {import('@inspironics/shared').Plate}
 */
export function toPlate(row) {
  const meta = parseJson(row.meta, {})
  const cat = meta.cat || UNCLASSIFIED
  const rev = encodeURIComponent(row.rev)
  return {
    ...PLATE_DEFAULTS,
    ...meta,
    id: row.id,
    f: row.name,
    title: row.title,
    cat,
    tag: meta.tag || tagForCategory(cat),
    w: row.width || meta.w || undefined,
    h: row.height || meta.h || undefined,
    kind: row.kind,
    ext: row.ext,
    size: Number(row.size) || 0,
    path: row.path_display,
    confidence: row.confidence ?? null,
    titleSource: row.title_source,
    classification: row.classification_status,
    views: Number(row.views) || 0,
    modifiedAt: row.server_modified,
    // the rev in the query string makes each revision its own cache entry in the browser
    thumbUrl: `/api/dropbox/files/${row.id}/thumbnail?v=${rev}`,
    fullUrl: `/api/dropbox/files/${row.id}/preview?v=${rev}`,
    contentUrl: `/api/dropbox/files/${row.id}/content?v=${rev}`,
  }
}

/* --------------------------------------------------------- sync_log ------ */

const toSyncLog = (r) =>
  r && {
    id: r.id,
    trigger: r.trigger_kind,
    triggeredBy: r.triggered_by,
    status: r.status,
    rootPath: r.root_path,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    durationMs: r.duration_ms,
    discovered: r.discovered,
    added: r.added,
    updated: r.updated,
    unchanged: r.unchanged,
    archived: r.archived,
    failed: r.failed,
    skipped: r.skipped,
    errors: parseJson(r.errors, []),
    warnings: parseJson(r.warnings, []),
  }

export function createSyncLogRepo(db) {
  return {
    async start({ trigger, triggeredBy = null, rootPath }) {
      const id = randomId()
      await db.run('INSERT INTO sync_log (id, trigger_kind, triggered_by, status, root_path, started_at) VALUES (?, ?, ?, ?, ?, ?)', [
        id,
        trigger,
        triggeredBy,
        SYNC_STATUS.RUNNING,
        rootPath,
        nowIso(),
      ])
      return id
    },

    async finish(id, s) {
      await db.run(
        `UPDATE sync_log SET status = ?, finished_at = ?, duration_ms = ?, discovered = ?, added = ?, updated = ?,
           unchanged = ?, archived = ?, failed = ?, skipped = ?, errors = ?, warnings = ? WHERE id = ?`,
        [
          s.status,
          nowIso(),
          s.durationMs,
          s.discovered,
          s.added,
          s.updated,
          s.unchanged,
          s.archived,
          s.failed,
          s.skipped,
          JSON.stringify(s.errors.slice(0, 200)),
          JSON.stringify(s.warnings.slice(0, 200)),
          id,
        ]
      )
    },

    /** Runs left 'running' by a process that died mid-sync. */
    failAbandoned: () =>
      db.run(`UPDATE sync_log SET status = ?, finished_at = ?, errors = ? WHERE status = ?`, [
        SYNC_STATUS.FAILED,
        nowIso(),
        JSON.stringify([{ message: 'The server stopped before this run finished.' }]),
        SYNC_STATUS.RUNNING,
      ]),

    async list({ limit = 25, offset = 0 } = {}) {
      const rows = await db.all('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT ? OFFSET ?', [limit, offset])
      const total = await db.get('SELECT CAST(COUNT(*) AS INTEGER) AS n FROM sync_log')
      return { total: Number(total?.n || 0), items: rows.map(toSyncLog) }
    },

    latest: async () => toSyncLog(await db.get('SELECT * FROM sync_log ORDER BY started_at DESC LIMIT 1')),
    lastSuccess: async () =>
      toSyncLog(await db.get('SELECT * FROM sync_log WHERE status IN (?, ?) ORDER BY started_at DESC LIMIT 1', [SYNC_STATUS.SUCCESS, SYNC_STATUS.PARTIAL])),
  }
}

/* ----------------------------------------------------- plate_events ------ */

export const EVENT_KINDS = ['view', 'download', 'favourite', 'offline']

export function createEventsRepo(db) {
  return {
    record: (fileId, userId, kind) =>
      db.run('INSERT INTO plate_events (id, file_id, user_id, kind, created_at) VALUES (?, ?, ?, ?, ?)', [randomId(), fileId, userId, kind, nowIso()]),

    async byDay(sinceIso) {
      return db.all(
        `SELECT SUBSTR(created_at, 1, 10) AS day, kind, CAST(COUNT(*) AS INTEGER) AS n
         FROM plate_events WHERE created_at >= ? GROUP BY SUBSTR(created_at, 1, 10), kind ORDER BY day`,
        [sinceIso]
      )
    },

    async top(kind, limit = 10) {
      return db.all(
        `SELECT e.file_id, f.title, CAST(COUNT(*) AS INTEGER) AS n
         FROM plate_events e JOIN stored_file f ON f.id = e.file_id
         WHERE e.kind = ? AND f.status = 'active'
         GROUP BY e.file_id, f.title ORDER BY n DESC LIMIT ?`,
        [kind, limit]
      )
    },

    async loginsByDay(sinceIso) {
      return db.all(
        `SELECT SUBSTR(created_at, 1, 10) AS day, success, CAST(COUNT(*) AS INTEGER) AS n
         FROM login_history WHERE created_at >= ? GROUP BY SUBSTR(created_at, 1, 10), success ORDER BY day`,
        [sinceIso]
      )
    },
  }
}
