# Database schema

Written for: engineers reading or extending the persistence layer.

Conventions, chosen so one set of SQL runs on both SQLite and PostgreSQL:

- **Ids** are application-generated UUID strings in `TEXT`.
- **Timestamps** are ISO-8601 UTC strings in `TEXT`, so ordering is
  lexicographic in both engines and no driver has to agree about date types.
- **Booleans** are `INTEGER` 0/1.
- **JSON** is `TEXT`, parsed by the repository that owns it.

Migrations are append-only, recorded in `schema_migrations`, and applied at
startup. Running them twice is a no-op.

---

## `storage_connection`

One row per provider — the connection itself.

| Column | Notes |
|---|---|
| `id` | |
| `provider` | **unique**. `dropbox` today; the column is what makes a second provider possible. |
| `account_id`, `account_name`, `account_email` | Display metadata only. No more personal data than is needed to say which account is connected. |
| `refresh_token_encrypted` | AES-256-GCM, `v1.<iv>.<ciphertext>.<tag>`. **The only credential that is ever persisted.** |
| `root_namespace_id` | The account's root namespace, sent as `Dropbox-API-Path-Root`. On a Business account this is the team space; on a personal one it equals `home_namespace_id`. Blank on a connection made before migration 002 — which keeps its old home-namespace behaviour until an admin reconnects. |
| `home_namespace_id` | The member's personal namespace. Differing from the root is precisely what "has a team space" means. |
| `home_path` | Where the member's folder sits inside the team space, e.g. `/Avery Raman`. Blank for personal accounts. |
| `root_folder` | Normalized path. `''` is the account root. Relative to the **root namespace**, so its meaning changes when a team account is reconnected with team-space support. |
| `connection_status` | `connected` \| `disconnected` \| `error` |
| `sync_status` | `idle` \| `running` \| `success` \| `error` |
| `last_connected_at`, `last_token_refresh_at`, `last_sync_at` | |
| `last_sync_status`, `last_error` | What the admin UI shows. |
| `created_at`, `updated_at` | |

There is deliberately no `access_token` column. Access tokens live in process
memory and nowhere else.

---

## `stored_file`

The indexed catalog — the application's copy of what is in Dropbox.

| Column | Notes |
|---|---|
| `id` | |
| `provider`, `external_id` | **unique together**. Identity. The Dropbox file id survives renames, which is why it is the key and the path is not. |
| `path`, `path_display`, `name`, `extension` | |
| `file_type` | `pdf` \| `pptx` \| `html` \| … |
| `file_size`, `revision`, `content_hash` | `revision` drives incremental sync. |
| `modified_at`, `client_modified_at` | |
| `title`, `title_source` | `title_source` is one of `metadata`, `text`, `ai_text`, `ai_vision`, `filename`, `manual`. It is what stops the sync overwriting a title a human chose. |
| `description`, `ai_summary`, `ai_confidence` | |
| `primary_domain`, `sub_domain`, `category` | |
| `tags_json`, `keywords_json`, `learning_objectives_json` | |
| `slide_count`, `author` | |
| `thumbnail_url`, `preview_url`, `file_url`, `preview_cached_at` | **Derived cache.** Safe to clear; regenerated on demand. |
| `view_count`, `trend_score` | |
| `status` | `active` \| `archived`. Files removed from Dropbox are archived, never deleted. |
| `processing_state` | `pending` \| `processing` \| `success` \| `failed` |
| `last_error`, `last_synced_at`, `archived_at` | |
| `created_at`, `updated_at` | |

Indexes: `uq_stored_file_external (provider, external_id)` — the uniqueness that
makes sync idempotent — plus `status`, `path` and `last_synced_at`.

---

## `sync_log`

One row per run, opened when it starts and closed when it ends. A crashed run
therefore leaves a visible `running` row rather than no evidence at all; the
next startup marks it failed.

`id`, `connection_id`, `started_at`, `completed_at`, `status`
(`running` | `success` | `partial` | `error`), `trigger`
(`manual` | `scheduled` | `startup` | `admin` | `webhook`), `actor_email`,
`root_folder`, `total_files`, `new_files`, `updated_files`, `deleted_files`,
`skipped_files`, `failed_files`, `duration_ms`, `error`, `details_json`.

`details_json` carries the per-file errors, capped so one catastrophic run
cannot write a hundred megabytes.

---

## `oauth_state`

CSRF protection for the callback. `state_hash` is **unique** and holds a
SHA-256, never the value itself. `used_at` makes consumption a compare-and-set:
two concurrent callbacks race on `UPDATE … WHERE used_at IS NULL` and exactly
one wins.

`id`, `provider`, `state_hash`, `user_id`, `redirect_after`, `expires_at`,
`used_at`, `created_at`.

## `oauth_code_exchange`

Single-use authorization codes. `code_hash` is the primary key, so claiming a
code is an `INSERT … ON CONFLICT DO NOTHING` — whoever inserts owns the
exchange, and everyone else reads the recorded result instead of burning the
code a second time.

`code_hash`, `provider`, `outcome` (`pending` | `success` | `failed`),
`result_json`, `created_at`.

---

## `advisory_lock`

Cross-instance mutual exclusion without Redis. `name` is the primary key;
`expires_at` is what lets a lock held by a killed process be reclaimed rather
than held forever. Releases are scoped by `owner`, so a lock already stolen
after an expiry is not released out from under its new holder.

Names in use: `dropbox:sync`, `dropbox:token-refresh`, `dropbox:rename`.

---

## `audit_log`

`id`, `actor_id`, `actor_email`, `action`, `target`, `outcome`, `ip`,
`details_json`, `created_at`.

`details_json` is redacted before it is written. Actions are the constants in
`services/audit/AuditService.js`.

---

## `app_user`, `user_session`, `login_history`

The backend's own identity, so RBAC is enforced server-side.

- `app_user` — `email` is **unique**; `password_hash` is scrypt with its
  parameters embedded (`scrypt$N$r$p$salt$hash`); `role` is `admin` or `user`.
- `user_session` — `token_hash` is **unique** and holds a SHA-256; the cookie
  carries the raw value. `expires_at` and `revoked_at` are both honoured.
- `login_history` — one row per sign-in attempt, successful or not.

## `presentation_analytics`

One row per presentation, created on first view. `presentation_id` is
**unique**. `daily_breakdown_json` is a rolling 60-day window, and `trend_score`
weights recent views so a deck read this week outranks one read heavily two
years ago.

---

## Entity relationships

```
storage_connection ──< sync_log
                   (connection_id; not a foreign key, so a purged
                    connection cannot take the history with it)

stored_file ──1:1── presentation_analytics   (presentation_id)

app_user ──< user_session
         ──< login_history
         ──< audit_log                        (actor_id)
```

Foreign keys are deliberately not declared between the catalog and the logs:
retention deletes old logs on its own schedule, and a cascade would make that
delete rows nobody asked it to.
