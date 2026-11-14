import { ENTITY_NAMES } from '@academy/shared';
import { log } from '../lib/logger.js';
import { columnsFor, quote, sqlType, tableName } from './schema.js';
import { runDataMigrations } from './dataMigrations.js';

// Ordered, append-only core migrations. Entity tables are reconciled separately from the shared schema.
const CORE_MIGRATIONS = [
  {
    id: '001_core_auth',
    sql: (d) => `
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        full_name TEXT,
        role TEXT NOT NULL DEFAULT 'user',
        password_hash TEXT,
        disabled ${d === 'postgres' ? 'BOOLEAN NOT NULL DEFAULT FALSE' : 'INTEGER NOT NULL DEFAULT 0'},
        created_date TEXT NOT NULL,
        updated_date TEXT NOT NULL,
        last_login_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        ip TEXT,
        user_agent TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS password_resets (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS login_history (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        email TEXT,
        success ${d === 'postgres' ? 'BOOLEAN' : 'INTEGER'} NOT NULL,
        reason TEXT,
        ip TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_history_created ON login_history(created_at);
    `,
  },
  {
    id: '002_settings_locks_sync',
    sql: () => `
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS locks (
        name TEXT PRIMARY KEY,
        owner TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sync_log (
        id TEXT PRIMARY KEY,
        trigger TEXT NOT NULL,
        status TEXT NOT NULL,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms ${'INTEGER'},
        discovered INTEGER DEFAULT 0,
        added INTEGER DEFAULT 0,
        updated INTEGER DEFAULT 0,
        unchanged INTEGER DEFAULT 0,
        archived INTEGER DEFAULT 0,
        failed INTEGER DEFAULT 0,
        errors TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_sync_log_started ON sync_log(started_at);
    `,
  },
  {
    // Profile photo as a small client-resized data URL ('' = none).
    id: '003_user_avatar',
    sql: () => 'ALTER TABLE users ADD COLUMN avatar_url TEXT',
  },
  {
    // Outgoing email, sent by the outbox worker with retries. dedupe_key makes a notification's email
    // go out at most once however often the job that raised it runs.
    id: '004_email_outbox',
    sql: () => `
      CREATE TABLE IF NOT EXISTS email_outbox (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        to_email TEXT NOT NULL,
        kind TEXT NOT NULL,
        subject TEXT NOT NULL,
        text_body TEXT NOT NULL,
        html_body TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT NOT NULL,
        last_error TEXT,
        dedupe_key TEXT UNIQUE,
        created_at TEXT NOT NULL,
        sent_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_email_outbox_due ON email_outbox(status, next_attempt_at);
      CREATE INDEX IF NOT EXISTS idx_email_outbox_created ON email_outbox(created_at)
    `,
  },
  {
    // Who a user is in the organisation (intern | employee | leadership): which playbooks they see.
    id: '005_user_audience',
    sql: () => "ALTER TABLE users ADD COLUMN audience TEXT NOT NULL DEFAULT 'employee'",
  },
  {
    // Every paid (or cached) generation: AI text, voice-over and video renders, with what it used.
    id: '006_generation_log',
    sql: (dialect) => `
      CREATE TABLE IF NOT EXISTS generation_log (
        id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        kind TEXT NOT NULL,
        operation TEXT,
        provider TEXT,
        model TEXT,
        status TEXT NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        characters INTEGER NOT NULL DEFAULT 0,
        seconds ${dialect === 'postgres' ? 'DOUBLE PRECISION' : 'REAL'} NOT NULL DEFAULT 0,
        cost_usd ${dialect === 'postgres' ? 'DOUBLE PRECISION' : 'REAL'},
        duration_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        ref_type TEXT,
        ref_id TEXT,
        user_id TEXT,
        output_ref TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_generation_log_created ON generation_log(created_at);
      CREATE INDEX IF NOT EXISTS idx_generation_log_kind ON generation_log(kind, created_at)
    `,
  },
  {
    // Background jobs (video rendering): one active job per dedupe key.
    id: '007_jobs',
    sql: () => `
      CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        payload TEXT NOT NULL,
        result TEXT,
        error TEXT,
        progress INTEGER NOT NULL DEFAULT 0,
        message TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        max_attempts INTEGER NOT NULL DEFAULT 2,
        dedupe_key TEXT,
        ref_type TEXT,
        ref_id TEXT,
        cancel_requested INTEGER NOT NULL DEFAULT 0,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        run_after TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, run_after);
      CREATE INDEX IF NOT EXISTS idx_jobs_dedupe ON jobs(dedupe_key, status);
      CREATE INDEX IF NOT EXISTS idx_jobs_ref ON jobs(ref_type, ref_id)
    `,
  },
  {
    // APEX Core identity (R1 contract §1, ADR 0001/0003/0004): organisations, memberships, scoped and
    // dated role assignments, reviewed identity links, external sign-in identities and an append-only
    // audit log. Real constraints, not generic entities. No existing table is altered, so dropping these
    // six tables (src/core/cli/rollback-identity.js) restores the pre-R1 schema exactly.
    // Statements are split on ';' — none may appear inside a statement. Valid on SQLite and Postgres.
    id: '008_core_identity',
    sql: () => `
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('internal', 'partner', 'institution')),
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        organization_id TEXT NOT NULL REFERENCES organizations(id),
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        title TEXT,
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_active ON organization_memberships(organization_id, user_id) WHERE valid_to IS NULL;
      CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);
      CREATE TABLE IF NOT EXISTS role_assignments (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK (role IN ('platform_admin', 'org_admin', 'staff', 'assessor', 'app_admin', 'learner', 'mentor', 'student', 'intern', 'alumni')),
        scope_type TEXT NOT NULL CHECK (scope_type IN ('platform', 'organization', 'app')),
        scope_id TEXT NOT NULL DEFAULT '',
        valid_from TEXT NOT NULL,
        valid_to TEXT,
        granted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        granted_via TEXT NOT NULL CHECK (granted_via IN ('api', 'migration', 'cli')),
        revoked_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reason TEXT,
        created_at TEXT NOT NULL,
        CHECK ((scope_type = 'platform' AND scope_id = '') OR (scope_type <> 'platform' AND scope_id <> '')),
        CHECK (scope_type <> 'app' OR scope_id IN ('showcase', 'slidesvault')),
        CHECK (
          (role = 'platform_admin' AND scope_type = 'platform')
          OR (role IN ('org_admin', 'staff') AND scope_type = 'organization')
          OR (role = 'app_admin' AND scope_type = 'app')
          OR (role IN ('assessor', 'learner', 'mentor', 'student', 'intern', 'alumni') AND scope_type IN ('platform', 'organization'))
        ),
        CHECK (valid_to IS NULL OR valid_to >= valid_from)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_role_assignments_active ON role_assignments(user_id, role, scope_type, scope_id) WHERE valid_to IS NULL;
      CREATE INDEX IF NOT EXISTS idx_role_assignments_user ON role_assignments(user_id);
      CREATE INDEX IF NOT EXISTS idx_role_assignments_scope ON role_assignments(scope_type, scope_id);
      CREATE TABLE IF NOT EXISTS identity_links (
        id TEXT PRIMARY KEY,
        core_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        app TEXT NOT NULL CHECK (app IN ('showcase', 'slidesvault')),
        app_user_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'rejected')),
        evidence TEXT NOT NULL CHECK (evidence IN ('admin_review', 'import_consistent', 'possession')),
        proposed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        proposed_at TEXT NOT NULL,
        reviewed_by TEXT REFERENCES users(id) ON DELETE SET NULL,
        reviewed_at TEXT,
        note TEXT,
        CHECK (status = 'proposed' OR reviewed_at IS NOT NULL)
      );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_links_app_user ON identity_links(app, app_user_id) WHERE status <> 'rejected';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_identity_links_confirmed ON identity_links(core_user_id, app) WHERE status = 'confirmed';
      CREATE INDEX IF NOT EXISTS idx_identity_links_status ON identity_links(status);
      CREATE TABLE IF NOT EXISTS external_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL CHECK (provider IN ('google')),
        subject TEXT NOT NULL,
        verified_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE (provider, subject)
      );
      CREATE INDEX IF NOT EXISTS idx_external_identities_user ON external_identities(user_id);
      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        at TEXT NOT NULL,
        actor_user_id TEXT,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('user', 'gateway', 'system', 'cli')),
        action TEXT NOT NULL,
        target_type TEXT,
        target_id TEXT,
        organization_id TEXT,
        detail TEXT,
        ip TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_events_at ON audit_events(at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_action ON audit_events(action, at);
      CREATE INDEX IF NOT EXISTS idx_audit_events_target ON audit_events(target_id);
      CREATE INDEX IF NOT EXISTS idx_audit_events_org ON audit_events(organization_id)
    `,
  },
  {
    // Security review L1: when the Core ends a user's sessions (password change or reset, disable), the
    // gateway must end the Apex session too. resolve returns valid_after; older Apex sessions are revoked.
    id: '009_user_session_epochs',
    sql: () => `
      CREATE TABLE IF NOT EXISTS user_session_epochs (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        valid_after TEXT NOT NULL
      )
    `,
  },
];

async function existingColumns(db, table) {
  if (db.dialect === 'postgres') {
    const rows = await db.query('SELECT column_name FROM information_schema.columns WHERE table_name = ?', [table]);
    return new Set(rows.map((r) => r.column_name));
  }
  const rows = await db.query(`PRAGMA table_info(${quote(table)})`);
  return new Set(rows.map((r) => r.name));
}

// Creates entity tables and adds any columns introduced by schema changes (never drops).
async function reconcileEntityTables(db) {
  for (const entity of ENTITY_NAMES) {
    const table = tableName(entity);
    const cols = columnsFor(entity);
    const defs = cols.map((c) => `${quote(c.name)} ${c.name === 'id' ? 'TEXT PRIMARY KEY' : sqlType(c.kind, db.dialect)}`);
    await db.exec(`CREATE TABLE IF NOT EXISTS ${quote(table)} (${defs.join(', ')})`);
    const have = await existingColumns(db, table);
    for (const c of cols) {
      if (!have.has(c.name)) {
        await db.exec(`ALTER TABLE ${quote(table)} ADD COLUMN ${quote(c.name)} ${sqlType(c.kind, db.dialect)}`);
        log.info('db.column_added', { table, column: c.name });
      }
    }
    for (const c of cols) {
      if (c.name.endsWith('_id') || c.name === 'status' || c.name === 'created_date') {
        await db.exec(`CREATE INDEX IF NOT EXISTS ${quote(`idx_${table}_${c.name}`)} ON ${quote(table)} (${quote(c.name)})`);
      }
    }
  }
}

// `exclude` (tests only) skips the named core/data migrations, e.g. to build a pre-R1 database.
export async function migrate(db, { exclude = [] } = {}) {
  const skip = new Set(exclude);
  await db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const applied = new Set((await db.query('SELECT id FROM schema_migrations')).map((r) => r.id));
  for (const m of CORE_MIGRATIONS) {
    if (applied.has(m.id) || skip.has(m.id)) continue;
    await db.transaction(async (tx) => {
      for (const stmt of m.sql(db.dialect).split(';').map((s) => s.trim()).filter(Boolean)) await tx.exec(stmt);
      await tx.run('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)', [m.id, new Date().toISOString()]);
    });
    log.info('db.migration_applied', { id: m.id });
  }
  await reconcileEntityTables(db);
  await runDataMigrations(db, { exclude: skip });
}
