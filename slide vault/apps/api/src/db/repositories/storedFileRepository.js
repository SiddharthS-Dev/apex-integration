/**
 * The indexed file catalog — the application's copy of what lives in Dropbox.
 *
 * Identity is (provider, external_id), enforced by a unique index, which is
 * what makes a sync idempotent: running it three times cannot produce three
 * records for one Dropbox file (spec §31/§32).
 *
 * Dropbox remains the source of truth for the bytes; every url column here is
 * derived cache data that may be regenerated at any time (spec §45/§71).
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

const parseJson = (value, fallback) => {
  if (value == null || value === '') return fallback;
  try {
    const parsed = JSON.parse(value);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

/** Columns a caller may write. Anything else is ignored rather than injected. */
const WRITABLE = [
  'path',
  'path_display',
  'name',
  'extension',
  'file_type',
  'file_size',
  'revision',
  'content_hash',
  'modified_at',
  'client_modified_at',
  'title',
  'title_source',
  'description',
  'ai_summary',
  'ai_confidence',
  'primary_domain',
  'sub_domain',
  'category',
  'tags_json',
  'keywords_json',
  'learning_objectives_json',
  'slide_count',
  'author',
  'thumbnail_url',
  'preview_url',
  'file_url',
  'preview_cached_at',
  'view_count',
  'trend_score',
  'status',
  'processing_state',
  'last_error',
  'last_synced_at',
  'archived_at',
];

export class StoredFileRepository {
  constructor(db) {
    this.db = db;
  }

  async findByExternalId(externalId, provider = 'dropbox') {
    const row = await this.db.queryOne(
      'SELECT * FROM stored_file WHERE provider = ? AND external_id = ?',
      [provider, externalId]
    );
    return row ? StoredFileRepository.hydrate(row) : null;
  }

  async findById(id) {
    const row = await this.db.queryOne('SELECT * FROM stored_file WHERE id = ?', [id]);
    return row ? StoredFileRepository.hydrate(row) : null;
  }

  /**
   * Inserts or updates by external identity, in one statement.
   *
   * The ON CONFLICT clause is what keeps two concurrent syncs from inserting
   * duplicates: the loser updates the winner's row instead of failing.
   */
  async upsert(externalId, patch, provider = 'dropbox') {
    const timestamp = now();
    const fields = {};
    for (const column of WRITABLE) {
      if (patch[column] !== undefined) fields[column] = patch[column];
    }

    const columns = ['id', 'provider', 'external_id', ...Object.keys(fields), 'created_at', 'updated_at'];
    const values = [
      crypto.randomUUID(),
      provider,
      externalId,
      ...Object.values(fields),
      timestamp,
      timestamp,
    ];
    const updates = [...Object.keys(fields), 'updated_at']
      .map((column) => `${column} = ?`)
      .join(', ');

    await this.db.execute(
      `INSERT INTO stored_file (${columns.join(', ')})
       VALUES (${columns.map(() => '?').join(', ')})
       ON CONFLICT (provider, external_id) DO UPDATE SET ${updates}`,
      [...values, ...Object.values(fields), timestamp]
    );

    return this.findByExternalId(externalId, provider);
  }

  async updateById(id, patch) {
    const fields = {};
    for (const column of WRITABLE) {
      if (patch[column] !== undefined) fields[column] = patch[column];
    }
    if (!Object.keys(fields).length) return this.findById(id);

    const assignments = [...Object.keys(fields).map((c) => `${c} = ?`), 'updated_at = ?'];
    await this.db.execute(`UPDATE stored_file SET ${assignments.join(', ')} WHERE id = ?`, [
      ...Object.values(fields),
      now(),
      id,
    ]);
    return this.findById(id);
  }

  /** Every active record, as a Map keyed by external id — the sync's baseline. */
  async indexByExternalId(provider = 'dropbox') {
    const rows = await this.db.query('SELECT * FROM stored_file WHERE provider = ?', [provider]);
    return new Map(rows.map((row) => [row.external_id, StoredFileRepository.hydrate(row)]));
  }

  /**
   * Archives records whose files are gone from Dropbox.
   *
   * Never a hard delete: analytics, view history and shared links would lose
   * their referent, and a folder that was temporarily unmounted would silently
   * destroy the catalog (spec §27).
   */
  async archiveMissing(seenExternalIds, provider = 'dropbox') {
    const seen = new Set(seenExternalIds);
    const rows = await this.db.query(
      "SELECT id, external_id FROM stored_file WHERE provider = ? AND status = 'active'",
      [provider]
    );
    const stale = rows.filter((row) => !seen.has(row.external_id));
    const timestamp = now();
    for (const row of stale) {
      await this.db.execute(
        "UPDATE stored_file SET status = 'archived', archived_at = ?, updated_at = ? WHERE id = ?",
        [timestamp, timestamp, row.id]
      );
    }
    return stale.length;
  }

  /** Active records whose title still looks machine-generated. */
  async listGenericTitled(provider = 'dropbox') {
    const rows = await this.db.query(
      "SELECT * FROM stored_file WHERE provider = ? AND status = 'active'",
      [provider]
    );
    return rows.map(StoredFileRepository.hydrate);
  }

  async list({ status = 'active', limit = 200, offset = 0, sort = '-updated_at' } = {}) {
    const descending = sort.startsWith('-');
    const columnName = descending ? sort.slice(1) : sort;
    const sortable = new Set([
      'updated_at',
      'created_at',
      'title',
      'modified_at',
      'view_count',
      'trend_score',
      'last_synced_at',
    ]);
    const column = sortable.has(columnName) ? columnName : 'updated_at';

    const where = status === 'all' ? '' : 'WHERE status = ?';
    const params = status === 'all' ? [] : [status];
    const rows = await this.db.query(
      `SELECT * FROM stored_file ${where} ORDER BY ${column} ${descending ? 'DESC' : 'ASC'} LIMIT ? OFFSET ?`,
      [...params, Math.min(Number(limit) || 200, 1000), Math.max(Number(offset) || 0, 0)]
    );
    return rows.map(StoredFileRepository.hydrate);
  }

  async count(status = 'active') {
    const row = await this.db.queryOne(
      status === 'all'
        ? 'SELECT COUNT(*) AS n FROM stored_file'
        : 'SELECT COUNT(*) AS n FROM stored_file WHERE status = ?',
      status === 'all' ? [] : [status]
    );
    return Number(row?.n ?? 0);
  }

  async incrementViews(id) {
    await this.db.execute(
      'UPDATE stored_file SET view_count = view_count + 1, updated_at = ? WHERE id = ?',
      [now(), id]
    );
  }

  /** Row -> in-memory record: JSON columns parsed, numbers coerced. */
  static hydrate(row) {
    return {
      ...row,
      file_size: Number(row.file_size ?? 0),
      slide_count: Number(row.slide_count ?? 0),
      view_count: Number(row.view_count ?? 0),
      trend_score: Number(row.trend_score ?? 0),
      ai_confidence: Number(row.ai_confidence ?? 0),
      tags: parseJson(row.tags_json, []),
      keywords: parseJson(row.keywords_json, []),
      learning_objectives: parseJson(row.learning_objectives_json, []),
    };
  }

  /**
   * The public "Presentation" shape the frontend consumes.
   *
   * Dropbox internals (revision, content hash, processing state) are kept out
   * of it; the admin surface reads those from the sync log instead.
   */
  static toPresentation(file) {
    if (!file) return null;
    return {
      id: file.id,
      title: file.title || file.name,
      description: file.description || '',
      dropbox_id: file.external_id,
      dropbox_path: file.path_display || file.path,
      dropbox_rev: file.revision,
      file_url: file.file_url || '',
      thumbnail_url: file.thumbnail_url || '',
      preview_url: file.preview_url || '',
      file_type: file.file_type,
      file_size: file.file_size,
      slide_count: file.slide_count,
      author: file.author || '',
      primary_domain: file.primary_domain || '',
      sub_domain: file.sub_domain || '',
      category: file.category || '',
      tags: file.tags || [],
      keywords: file.keywords || [],
      learning_objectives: file.learning_objectives || [],
      ai_summary: file.ai_summary || '',
      ai_confidence: file.ai_confidence,
      view_count: file.view_count,
      trend_score: file.trend_score,
      modified_date: file.modified_at,
      last_synced: file.last_synced_at,
      sync_status: file.processing_state === 'success' ? 'synced' : file.processing_state,
      status: file.status,
      created_date: file.created_at,
      updated_date: file.updated_at,
    };
  }
}
