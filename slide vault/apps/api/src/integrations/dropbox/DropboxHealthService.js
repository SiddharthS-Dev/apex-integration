/**
 * Connection health and the connection test.
 *
 * Two different questions, deliberately:
 *  - health() is cheap and reads only local state, so a load balancer or an
 *    uptime check can poll it without generating Dropbox traffic;
 *  - testConnection() actually talks to Dropbox, so it is an explicit admin
 *    action rather than something a monitor hammers.
 *
 * Neither ever returns a credential.
 */
import { ConnectionRepository } from '../../db/repositories/connectionRepository.js';
import { AUDIT } from '../../services/audit/AuditService.js';
import { LOCKS } from '../../db/repositories/lockRepository.js';

export class DropboxHealthService {
  constructor({ config, provider, auth, connections, syncLogs, files, locks, audit, logger }) {
    this.config = config;
    this.provider = provider;
    this.auth = auth;
    this.connections = connections;
    this.syncLogs = syncLogs;
    this.files = files;
    this.locks = locks;
    this.audit = audit;
    this.logger = logger?.child?.({ component: 'DropboxHealthService' }) ?? logger;
  }

  /** Local-state health. No Dropbox calls. */
  async health() {
    const connection = await this.connections.get('dropbox');
    const safe = ConnectionRepository.sanitize(connection);
    const lastSync = await this.syncLogs.latest();
    const configured = Boolean(this.config.dropbox.appKey && this.config.dropbox.appSecret);

    const status = deriveStatus({ configured, connection: safe, lastSync, sync: this.config.sync });

    return {
      connected: safe.connection_status === 'connected',
      configured,
      account: safe.account_email || null,
      accountName: safe.account_name || null,
      rootFolder: safe.root_folder || '/',
      // Whether folder paths are team-space-relative or personal. Worth being
      // explicit about: it changes what a given path means.
      teamSpace: safe.team_space,
      homePath: safe.home_path || null,
      lastSync: safe.last_sync_at,
      lastSyncStatus: safe.last_sync_status || null,
      lastTokenRefresh: safe.last_token_refresh_at,
      lastError: safe.last_error || null,
      syncRunning: await this.locks.isHeld(LOCKS.SYNC),
      scheduler: {
        enabled: this.config.sync.enabled,
        intervalMinutes: this.config.sync.intervalMinutes,
      },
      indexedFiles: await this.files.count('active'),
      archivedFiles: await this.files.count('archived'),
      tokenCache: this.auth.tokenCacheState(),
      status,
    };
  }

  /**
   * A live check: authenticate, then read the configured root.
   *
   * Reports the two halves separately so "the token works but the folder was
   * deleted" is distinguishable from "the authorization was revoked".
   */
  async testConnection({ actor = null, ip = '' } = {}) {
    const connection = await this.connections.get('dropbox');
    const result = await this.provider.testConnection(connection?.root_folder ?? '');

    if (result.connected && result.folderAccessible) {
      await this.connections.update('dropbox', {
        connection_status: 'connected',
        account_name: result.account?.name ?? connection?.account_name ?? '',
        account_email: result.account?.email ?? connection?.account_email ?? '',
        last_error: '',
      });
    } else {
      await this.connections.update('dropbox', {
        connection_status: result.authenticated ? 'connected' : 'error',
        last_error: result.error?.message ?? 'The connection test failed.',
      });
    }

    await this.audit?.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: AUDIT.DROPBOX_TEST,
      outcome: result.connected && result.folderAccessible ? 'success' : 'failure',
      ip,
      details: {
        authenticated: result.authenticated,
        folderAccessible: result.folderAccessible,
        rootFolder: result.rootFolder || '/',
      },
    });

    /* A connection made before team-space support was added has no stored
       namespace. Enabling it silently would reinterpret every stored path
       against a different root, so the reconnect is left to the administrator
       — but they are told it is available, which they could not otherwise
       know. */
    const teamSpaceAvailable = Boolean(result.account?.isTeamSpace);
    const teamSpaceEnabled = Boolean(connection?.root_namespace_id);

    return {
      ok: result.connected && result.folderAccessible,
      connected: result.connected,
      authenticated: result.authenticated,
      folderAccessible: result.folderAccessible,
      accountName: result.account?.name ?? '',
      accountEmail: result.account?.email ?? '',
      rootFolder: result.rootFolder || '/',
      teamSpaceAvailable,
      teamSpaceEnabled: teamSpaceAvailable && teamSpaceEnabled,
      hint:
        teamSpaceAvailable && !teamSpaceEnabled
          ? 'This account has a Dropbox Business team space. Reconnect Dropbox to browse and sync ' +
            'it directly; until then only the member’s own folder is visible.'
          : null,
      error: result.error,
    };
  }
}

/**
 * healthy / warning / error / disconnected, from local state alone.
 *
 * "Warning" is the interesting one: the connection works, but something needs
 * an operator's attention — a sync that has not completed in several intervals,
 * or a last run that failed.
 */
export function deriveStatus({ configured, connection, lastSync, sync, nowMs = Date.now() }) {
  if (!configured) return 'unconfigured';
  if (connection.connection_status === 'error') return 'error';
  if (connection.connection_status !== 'connected') return 'disconnected';
  if (connection.last_error) return 'warning';
  if (lastSync?.status === 'error') return 'warning';

  if (sync.enabled && connection.last_sync_at) {
    const staleAfterMs = sync.intervalMinutes * 60_000 * 3;
    if (nowMs - Date.parse(connection.last_sync_at) > staleAfterMs) return 'warning';
  }
  if (sync.enabled && !connection.last_sync_at) return 'warning';

  return 'healthy';
}
