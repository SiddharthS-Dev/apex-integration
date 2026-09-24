/**
 * Schema migrations, applied in order and recorded in `schema_migrations`.
 *
 * Append only: never edit a migration that has shipped — add the next one.
 * Each is plain SQL that both SQLite and Postgres accept, or a
 * `{ sqlite, postgres }` pair where they genuinely differ.
 */
export const MIGRATIONS = [
  {
    id: '001_init',
    sql: `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT,
  role TEXT NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,
  provider TEXT NOT NULL DEFAULT 'password',
  picture TEXT,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);

CREATE TABLE auth_codes (
  email TEXT NOT NULL,
  kind TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (email, kind)
);

CREATE TABLE login_history (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  email TEXT,
  method TEXT NOT NULL,
  success INTEGER NOT NULL,
  reason TEXT,
  ip TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX login_history_created ON login_history(created_at);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);

CREATE TABLE dropbox_connection (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_id TEXT NOT NULL,
  email TEXT,
  display_name TEXT,
  refresh_token_enc TEXT NOT NULL,
  root_namespace_id TEXT,
  home_namespace_id TEXT,
  is_team INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'ok',
  last_error TEXT,
  connected_by TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE oauth_states (
  state_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE stored_file (
  id TEXT PRIMARY KEY,
  external_id TEXT NOT NULL UNIQUE,
  path_lower TEXT NOT NULL,
  path_display TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL,
  kind TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  rev TEXT NOT NULL,
  content_hash TEXT,
  server_modified TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  processed_rev TEXT,
  title TEXT NOT NULL,
  title_source TEXT NOT NULL DEFAULT 'filename',
  meta TEXT NOT NULL DEFAULT '{}',
  classification_status TEXT NOT NULL DEFAULT 'unclassified',
  confidence REAL,
  width INTEGER,
  height INTEGER,
  warnings TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  views INTEGER NOT NULL DEFAULT 0,
  last_seen_sync_id TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  archived_at TEXT
);
CREATE INDEX stored_file_status ON stored_file(status);
CREATE INDEX stored_file_seen ON stored_file(last_seen_sync_id);

CREATE TABLE sync_log (
  id TEXT PRIMARY KEY,
  trigger_kind TEXT NOT NULL,
  triggered_by TEXT,
  status TEXT NOT NULL,
  root_path TEXT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  duration_ms INTEGER,
  discovered INTEGER NOT NULL DEFAULT 0,
  added INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  unchanged INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  errors TEXT NOT NULL DEFAULT '[]',
  warnings TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX sync_log_started ON sync_log(started_at);

CREATE TABLE plate_events (
  id TEXT PRIMARY KEY,
  file_id TEXT NOT NULL,
  user_id TEXT,
  kind TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX plate_events_file ON plate_events(file_id);
CREATE INDEX plate_events_created ON plate_events(created_at);

CREATE TABLE app_locks (
  name TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  expires_at BIGINT NOT NULL
);
`,
  },
]
