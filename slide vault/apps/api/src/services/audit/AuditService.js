/**
 * Audit logging for administrative actions.
 *
 * The list of what is logged comes from the spec (§48); the list of what is
 * *not* logged matters more: no refresh token, no access token, no app secret,
 * no authorization code. The repository redacts as a second line of defence,
 * but callers are expected not to pass them in the first place.
 *
 * An audit write must never fail the operation being audited — a full disk
 * should not prevent an administrator from disconnecting Dropbox.
 */

export const AUDIT = {
  DROPBOX_CONNECTED: 'dropbox.connected',
  DROPBOX_RECONNECTED: 'dropbox.reconnected',
  DROPBOX_DISCONNECTED: 'dropbox.disconnected',
  DROPBOX_FOLDER_CHANGED: 'dropbox.folder_changed',
  DROPBOX_TEST: 'dropbox.connection_tested',
  SYNC_STARTED: 'sync.started',
  SYNC_COMPLETED: 'sync.completed',
  SYNC_FAILED: 'sync.failed',
  FILE_RENAMED: 'file.renamed',
  RENAME_PREVIEWED: 'file.rename_previewed',
  DOWNLOAD_LINK: 'file.download_link_generated',
  LOGIN: 'auth.login',
  LOGIN_FAILED: 'auth.login_failed',
  LOGOUT: 'auth.logout',
};

export class AuditService {
  constructor({ repository, logger }) {
    this.repository = repository;
    this.logger = logger?.child?.({ component: 'AuditService' }) ?? logger;
  }

  /**
   * @param {{actorId?: string, actorEmail?: string, action: string, target?: string,
   *          outcome?: 'success'|'failure'|'partial', ip?: string, details?: object}} event
   */
  async record(event) {
    try {
      await this.repository.record(event);
      this.logger?.info?.('audit', {
        action: event.action,
        actor: event.actorEmail,
        target: event.target,
        outcome: event.outcome ?? 'success',
      });
    } catch (error) {
      this.logger?.error?.('Could not write an audit record', {
        action: event?.action,
        error: error.message,
      });
    }
  }

  list(options) {
    return this.repository.list(options);
  }
}
