/**
 * Folder browsing and root-folder selection.
 *
 * The sync folder is never hardcoded (spec §16/§70): an administrator browses
 * the account and picks one, and the choice is persisted on the connection.
 * Until they do, the root is the account root.
 */
import { AUDIT } from '../../services/audit/AuditService.js';
import { assertSafePath, normalizePath, parentOf } from './paths.js';
import { DropboxNotFoundError } from './errors.js';

export class DropboxFolderService {
  constructor({ provider, connections, audit, logger }) {
    this.provider = provider;
    this.connections = connections;
    this.audit = audit;
    this.logger = logger?.child?.({ component: 'DropboxFolderService' }) ?? logger;
  }

  /**
   * One level of the folder tree, with the breadcrumbs for it.
   *
   * @param {string} path "" is the account root
   */
  async browse(path) {
    const target = assertSafePath(path, { field: 'folder path' });
    const entries = await this.provider.listFolders(target);

    return {
      path: target,
      pathDisplay: target || '/',
      parent: target ? parentOf(target) : null,
      breadcrumbs: buildBreadcrumbs(target),
      entries,
    };
  }

  /**
   * Sets the folder the sync walks.
   *
   * The folder is verified to exist before it is stored — persisting a typo
   * would turn every subsequent sync into a failure with no obvious cause.
   */
  async setRootFolder(path, { actor = null, ip = '' } = {}) {
    const root = assertSafePath(path, { field: 'root folder' });

    try {
      await this.provider.listFolders(root);
    } catch (error) {
      if (error instanceof DropboxNotFoundError) {
        throw new DropboxNotFoundError(`The folder "${root || '/'}" does not exist in this Dropbox account.`, {
          status: 400,
          userMessage: `The folder "${root || '/'}" does not exist in the connected Dropbox account.`,
        });
      }
      throw error;
    }

    const previous = (await this.connections.get('dropbox'))?.root_folder ?? '';
    const connection = await this.connections.update('dropbox', { root_folder: root });

    await this.audit?.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: AUDIT.DROPBOX_FOLDER_CHANGED,
      target: root || '/',
      ip,
      details: { from: previous || '/', to: root || '/' },
    });

    return connection;
  }
}

/** ["/A", "/A/B"] for "/A/B" — enough for a clickable path in the UI. */
export function buildBreadcrumbs(path) {
  const normalized = normalizePath(path);
  if (!normalized) return [];
  const segments = normalized.slice(1).split('/');
  return segments.map((name, index) => ({
    name,
    path: `/${segments.slice(0, index + 1).join('/')}`,
  }));
}
