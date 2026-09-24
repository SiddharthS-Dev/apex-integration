/**
 * Schema migrations.
 *
 * Written in the SQL subset both SQLite and Postgres accept:
 *  - TEXT for ids (application-generated UUIDs) and for timestamps (ISO-8601
 *    UTC strings), so ordering is lexicographic in both engines and no driver
 *    has to agree about date types;
 *  - INTEGER for counters and booleans (0/1);
 *  - JSON kept as TEXT, parsed by the repositories.
 *
 * Migrations are append-only and recorded in schema_migrations. Running them
 * twice is a no-op, which is what makes container restarts safe.
 */

export const MIGRATIONS = [
  {
    id: '001_initial_schema',
    statements: [
      /* ------------------------------------------------------------ users */
      `CREATE TABLE IF NOT EXISTS app_user (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        last_login_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      `CREATE TABLE IF NOT EXISTS user_session (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        ip TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_user_session_user ON user_session (user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_user_session_expiry ON user_session (expires_at)`,

      `CREATE TABLE IF NOT EXISTS login_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT '',
        user_name TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'success',
        ip TEXT NOT NULL DEFAULT '',
        login_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_login_history_at ON login_history (login_at)`,

      /* ----------------------------------------------- storage connection */
      `CREATE TABLE IF NOT EXISTS storage_connection (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL UNIQUE,
        account_id TEXT NOT NULL DEFAULT '',
        account_name TEXT NOT NULL DEFAULT '',
        account_email TEXT NOT NULL DEFAULT '',
        refresh_token_encrypted TEXT NOT NULL DEFAULT '',
        root_folder TEXT NOT NULL DEFAULT '',
        connection_status TEXT NOT NULL DEFAULT 'disconnected',
        sync_status TEXT NOT NULL DEFAULT 'idle',
        last_connected_at TEXT,
        last_token_refresh_at TEXT,
        last_sync_at TEXT,
        last_sync_status TEXT NOT NULL DEFAULT '',
        last_error TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,

      /* ------------------------------------------------------ oauth state */
      `CREATE TABLE IF NOT EXISTS oauth_state (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'dropbox',
        state_hash TEXT NOT NULL UNIQUE,
        user_id TEXT NOT NULL DEFAULT '',
        redirect_after TEXT NOT NULL DEFAULT '',
        expires_at TEXT NOT NULL,
        used_at TEXT,
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_oauth_state_expiry ON oauth_state (expires_at)`,

      // Authorization codes are single-use; a replayed code returns the first
      // result instead of a second exchange attempt (spec §76).
      `CREATE TABLE IF NOT EXISTS oauth_code_exchange (
        code_hash TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'dropbox',
        outcome TEXT NOT NULL DEFAULT 'success',
        result_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,

      /* ------------------------------------------------------ stored file */
      `CREATE TABLE IF NOT EXISTS stored_file (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL DEFAULT 'dropbox',
        external_id TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '',
        path_display TEXT NOT NULL DEFAULT '',
        name TEXT NOT NULL DEFAULT '',
        extension TEXT NOT NULL DEFAULT '',
        file_type TEXT NOT NULL DEFAULT 'pdf',
        file_size INTEGER NOT NULL DEFAULT 0,
        revision TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL DEFAULT '',
        modified_at TEXT,
        client_modified_at TEXT,
        title TEXT NOT NULL DEFAULT '',
        title_source TEXT NOT NULL DEFAULT 'filename',
        description TEXT NOT NULL DEFAULT '',
        ai_summary TEXT NOT NULL DEFAULT '',
        ai_confidence REAL NOT NULL DEFAULT 0,
        primary_domain TEXT NOT NULL DEFAULT '',
        sub_domain TEXT NOT NULL DEFAULT '',
        category TEXT NOT NULL DEFAULT '',
        tags_json TEXT NOT NULL DEFAULT '[]',
        keywords_json TEXT NOT NULL DEFAULT '[]',
        learning_objectives_json TEXT NOT NULL DEFAULT '[]',
        slide_count INTEGER NOT NULL DEFAULT 0,
        author TEXT NOT NULL DEFAULT '',
        thumbnail_url TEXT NOT NULL DEFAULT '',
        preview_url TEXT NOT NULL DEFAULT '',
        file_url TEXT NOT NULL DEFAULT '',
        preview_cached_at TEXT,
        view_count INTEGER NOT NULL DEFAULT 0,
        trend_score REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'active',
        processing_state TEXT NOT NULL DEFAULT 'pending',
        last_error TEXT NOT NULL DEFAULT '',
        last_synced_at TEXT,
        archived_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      // One Dropbox file is exactly one application record (spec §31/§32).
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_stored_file_external
        ON stored_file (provider, external_id)`,
      `CREATE INDEX IF NOT EXISTS idx_stored_file_status ON stored_file (status)`,
      `CREATE INDEX IF NOT EXISTS idx_stored_file_path ON stored_file (path)`,
      `CREATE INDEX IF NOT EXISTS idx_stored_file_synced ON stored_file (last_synced_at)`,

      /* --------------------------------------------------------- sync log */
      `CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        connection_id TEXT NOT NULL DEFAULT '',
        started_at TEXT NOT NULL,
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'running',
        trigger TEXT NOT NULL DEFAULT 'manual',
        actor_email TEXT NOT NULL DEFAULT '',
        root_folder TEXT NOT NULL DEFAULT '',
        total_files INTEGER NOT NULL DEFAULT 0,
        new_files INTEGER NOT NULL DEFAULT 0,
        updated_files INTEGER NOT NULL DEFAULT 0,
        deleted_files INTEGER NOT NULL DEFAULT 0,
        skipped_files INTEGER NOT NULL DEFAULT 0,
        failed_files INTEGER NOT NULL DEFAULT 0,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log (started_at)`,

      /* -------------------------------------------------------- audit log */
      `CREATE TABLE IF NOT EXISTS audit_log (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL DEFAULT '',
        actor_email TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        outcome TEXT NOT NULL DEFAULT 'success',
        ip TEXT NOT NULL DEFAULT '',
        details_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log (created_at)`,
      `CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log (action)`,

      /* --------------------------------------------------- advisory locks */
      // Cross-instance mutual exclusion for sync runs and token refresh,
      // without requiring Redis for a small deployment.
      `CREATE TABLE IF NOT EXISTS advisory_lock (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,

      /* ---------------------------------------------------- view tracking */
      `CREATE TABLE IF NOT EXISTS presentation_analytics (
        id TEXT PRIMARY KEY,
        presentation_id TEXT NOT NULL UNIQUE,
        presentation_title TEXT NOT NULL DEFAULT '',
        total_views INTEGER NOT NULL DEFAULT 0,
        unique_views INTEGER NOT NULL DEFAULT 0,
        viewer_ids_json TEXT NOT NULL DEFAULT '[]',
        online_views INTEGER NOT NULL DEFAULT 0,
        offline_views INTEGER NOT NULL DEFAULT 0,
        avg_reading_time REAL NOT NULL DEFAULT 0,
        completion_pct REAL NOT NULL DEFAULT 0,
        bookmarks INTEGER NOT NULL DEFAULT 0,
        favorites INTEGER NOT NULL DEFAULT 0,
        trend_score REAL NOT NULL DEFAULT 0,
        daily_breakdown_json TEXT NOT NULL DEFAULT '[]',
        last_viewed_at TEXT,
        last_viewed_by TEXT NOT NULL DEFAULT '',
        last_viewed_by_name TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
  },

  {
    /**
     * Dropbox Business team spaces.
     *
     * A team member has two namespaces: their personal home folder, and the
     * team space. By default the API operates in the home namespace, so a
     * library living in the team space is invisible unless the member has
     * mounted it. These columns hold what the `Dropbox-API-Path-Root` header
     * needs to reach the team space directly.
     *
     * Blank on an existing connection, which is deliberate: an established
     * sync keeps its current path semantics until an administrator reconnects,
     * rather than having every stored path silently reinterpreted against a
     * different namespace root.
     */
    id: '002_team_namespace',
    statements: [
      `ALTER TABLE storage_connection ADD COLUMN root_namespace_id TEXT NOT NULL DEFAULT ''`,
      `ALTER TABLE storage_connection ADD COLUMN home_namespace_id TEXT NOT NULL DEFAULT ''`,
      // Where the member's personal folder sits inside the team space, e.g.
      // "/Avery Raman". Dropbox returns it only for team accounts.
      `ALTER TABLE storage_connection ADD COLUMN home_path TEXT NOT NULL DEFAULT ''`,
    ],
  },
];

/** Applies every migration that has not been recorded yet. */
export async function runMigrations(db, logger) {
  await db.execute(
    `CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )`
  );

  const applied = new Set((await db.query('SELECT id FROM schema_migrations')).map((row) => row.id));

  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;

    await db.transaction(async (tx) => {
      for (const statement of migration.statements) {
        await tx.execute(statement);
      }
      await tx.execute('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [
        migration.id,
        new Date().toISOString(),
      ]);
    });

    logger?.info?.('Applied migration', { migration: migration.id });
  }

  return MIGRATIONS.length;
}
