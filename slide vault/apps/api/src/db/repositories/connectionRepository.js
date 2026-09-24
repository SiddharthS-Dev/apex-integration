/**
 * The storage connection record — one row per provider.
 *
 * This repository is the *only* code that touches refresh_token_encrypted. It
 * encrypts on the way in and decrypts on the way out, so no service above it
 * can accidentally persist a plaintext credential, and the sanitized view used
 * by the API is defined here next to the column it must never expose.
 */
import crypto from 'node:crypto';

const now = () => new Date().toISOString();

export class ConnectionRepository {
  /**
   * @param {import('../index.js').Database} db
   * @param {import('../../crypto/tokenCipher.js').TokenCipher} cipher
   */
  constructor(db, cipher) {
    this.db = db;
    this.cipher = cipher;
  }

  /** The connection row for a provider, or null. `refreshToken` is decrypted. */
  async get(provider = 'dropbox') {
    const row = await this.db.queryOne('SELECT * FROM storage_connection WHERE provider = ?', [provider]);
    return row ? this.#hydrate(row) : null;
  }

  /** Creates the row on first use so callers never deal with "no row yet". */
  async ensure(provider = 'dropbox') {
    const existing = await this.get(provider);
    if (existing) return existing;

    const timestamp = now();
    await this.db.execute(
      `INSERT INTO storage_connection
         (id, provider, connection_status, sync_status, created_at, updated_at)
       VALUES (?, ?, 'disconnected', 'idle', ?, ?)
       ON CONFLICT (provider) DO NOTHING`,
      [crypto.randomUUID(), provider, timestamp, timestamp]
    );
    return this.get(provider);
  }

  /**
   * Patches the connection. `refreshToken` (plaintext) is encrypted here;
   * callers never pass refresh_token_encrypted themselves.
   */
  async update(provider, patch) {
    await this.ensure(provider);

    const columns = [];
    const values = [];
    const set = (column, value) => {
      columns.push(`${column} = ?`);
      values.push(value);
    };

    const allowed = [
      'account_id',
      'account_name',
      'account_email',
      'root_namespace_id',
      'home_namespace_id',
      'home_path',
      'root_folder',
      'connection_status',
      'sync_status',
      'last_connected_at',
      'last_token_refresh_at',
      'last_sync_at',
      'last_sync_status',
      'last_error',
    ];
    for (const column of allowed) {
      if (patch[column] !== undefined) set(column, patch[column]);
    }

    if (patch.refreshToken !== undefined) {
      set('refresh_token_encrypted', patch.refreshToken ? this.cipher.encrypt(patch.refreshToken) : '');
    }

    if (!columns.length) return this.get(provider);

    set('updated_at', now());
    values.push(provider);
    await this.db.execute(
      `UPDATE storage_connection SET ${columns.join(', ')} WHERE provider = ?`,
      values
    );
    return this.get(provider);
  }

  /** Clears every credential and account field. Used by disconnect. */
  async clearCredentials(provider = 'dropbox') {
    return this.update(provider, {
      refreshToken: '',
      account_id: '',
      account_name: '',
      account_email: '',
      // The next connection may be a different account with a different
      // namespace topology, so none of this may survive a disconnect.
      root_namespace_id: '',
      home_namespace_id: '',
      home_path: '',
      connection_status: 'disconnected',
      last_connected_at: null,
      last_token_refresh_at: null,
      last_error: '',
    });
  }

  #hydrate(row) {
    let refreshToken = '';
    let credentialError = '';
    if (row.refresh_token_encrypted) {
      try {
        refreshToken = this.cipher.decrypt(row.refresh_token_encrypted);
      } catch (error) {
        // A key rotation or a tampered row. Surface it as a connection problem
        // rather than throwing from every read of the connection.
        credentialError = error.message;
      }
    }
    return { ...row, refreshToken, credentialError };
  }

  /**
   * True when the account's root namespace differs from its home namespace —
   * that is precisely what "this member has a team space" means.
   */
  static isTeamSpace(connection) {
    const root = connection?.root_namespace_id ?? '';
    const home = connection?.home_namespace_id ?? '';
    return Boolean(root) && Boolean(home) && root !== home;
  }

  /**
   * The exact shape the API is allowed to return.
   *
   * An allow-list, not a delete-list: a column added to the table later cannot
   * leak by being forgotten here.
   */
  static sanitize(connection) {
    if (!connection) {
      return {
        provider: 'dropbox',
        connection_status: 'disconnected',
        sync_status: 'idle',
        account_id: '',
        account_name: '',
        account_email: '',
        root_namespace_id: '',
        home_namespace_id: '',
        home_path: '',
        team_space: false,
        root_folder: '',
        last_connected_at: null,
        last_token_refresh_at: null,
        last_sync_at: null,
        last_sync_status: '',
        last_error: '',
      };
    }
    return {
      provider: connection.provider,
      connection_status: connection.credentialError ? 'error' : connection.connection_status,
      sync_status: connection.sync_status ?? 'idle',
      account_id: connection.account_id ?? '',
      account_name: connection.account_name ?? '',
      account_email: connection.account_email ?? '',
      // Namespace ids are opaque account topology, not credentials — the admin
      // UI shows them so "which Dropbox am I actually syncing" is answerable.
      root_namespace_id: connection.root_namespace_id ?? '',
      home_namespace_id: connection.home_namespace_id ?? '',
      home_path: connection.home_path ?? '',
      team_space: ConnectionRepository.isTeamSpace(connection),
      root_folder: connection.root_folder ?? '',
      last_connected_at: connection.last_connected_at ?? null,
      last_token_refresh_at: connection.last_token_refresh_at ?? null,
      last_sync_at: connection.last_sync_at ?? null,
      last_sync_status: connection.last_sync_status ?? '',
      last_error: connection.credentialError || connection.last_error || '',
    };
  }
}
