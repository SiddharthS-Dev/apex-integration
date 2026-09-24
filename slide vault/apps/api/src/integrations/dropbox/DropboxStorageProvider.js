/**
 * Dropbox as a StorageProvider.
 *
 * The adapter layer: Dropbox vocabulary in, provider-neutral shapes out. It is
 * the last file in the stack that mentions `rev`, `path_lower` or
 * `get_thumbnail_v2`; everything above it is portable.
 */
import { StorageProvider } from '../../domain/storage/StorageProvider.js';
import { fromDropboxEntry, toStorageObject } from '../../domain/storage/FileMetadata.js';
import { DropboxNotFoundError, DropboxApiError } from './errors.js';
import { normalizePath } from './paths.js';

export class DropboxStorageProvider extends StorageProvider {
  /** @param {{client: import('./DropboxClient.js').DropboxClient}} deps */
  constructor({ client, logger }) {
    super();
    this.client = client;
    this.logger = logger?.child?.({ component: 'DropboxStorageProvider' }) ?? logger;
  }

  get name() {
    return 'dropbox';
  }

  async getAccount() {
    const account = await this.client.getCurrentAccount();
    const rootInfo = account.root_info ?? {};
    const rootNamespaceId = String(rootInfo.root_namespace_id ?? '');
    const homeNamespaceId = String(rootInfo.home_namespace_id ?? '');

    return {
      id: account.account_id ?? '',
      name: account.name?.display_name ?? '',
      email: account.email ?? '',
      rootNamespaceId,
      homeNamespaceId,
      // Where the member's personal folder sits inside the team space.
      homePath: String(rootInfo.home_path ?? ''),
      isTeamSpace: Boolean(rootNamespaceId && homeNamespaceId && rootNamespaceId !== homeNamespaceId),
    };
  }

  /**
   * A cheap liveness check: identify the account, then confirm the configured
   * root is actually readable. Both are reported separately so the admin UI can
   * say *which* half is broken (spec §51).
   */
  async testConnection(rootFolder) {
    const result = {
      connected: false,
      authenticated: false,
      folderAccessible: false,
      account: null,
      rootFolder: normalizePath(rootFolder),
      error: null,
    };

    try {
      result.account = await this.getAccount();
      result.authenticated = true;
      result.connected = true;
    } catch (error) {
      result.error = { code: error.name, message: error.userMessage ?? error.message };
      return result;
    }

    try {
      await this.client.listFolder(result.rootFolder, { recursive: false, limit: 1 });
      result.folderAccessible = true;
    } catch (error) {
      result.error = {
        code: error.name,
        message:
          error instanceof DropboxNotFoundError
            ? `The folder "${result.rootFolder || '/'}" does not exist in this Dropbox account.`
            : error.userMessage ?? error.message,
      };
    }

    return result;
  }

  async listFolders(path) {
    return this.client.listFolders(path);
  }

  /**
   * Every file under `path`, one at a time.
   *
   * Folders and deleted tombstones are filtered out here so callers never have
   * to know about Dropbox's `.tag` discriminator.
   */
  async *listFiles(path, { extensions = null } = {}) {
    const allowed = extensions ? new Set(extensions.map((e) => e.toLowerCase())) : null;

    for await (const entry of this.client.iterateFolder(path, { recursive: true })) {
      if (entry['.tag'] !== 'file') continue;
      const metadata = fromDropboxEntry(entry);
      if (allowed && !allowed.has(metadata.extension)) continue;
      yield metadata;
    }
  }

  async getMetadata(idOrPath) {
    const entry = await this.client.getMetadata(idOrPath);
    if (entry['.tag'] === 'deleted') {
      throw new DropboxNotFoundError(`"${idOrPath}" has been deleted in Dropbox.`);
    }
    return fromDropboxEntry(entry);
  }

  async download(idOrPath) {
    const response = await this.client.download(idOrPath);
    // Dropbox echoes the metadata in a header — useful for the file name
    // without paying for a second metadata round trip.
    let fileName;
    try {
      fileName = JSON.parse(response.headers.get('dropbox-api-result') ?? '{}').name;
    } catch {
      fileName = undefined;
    }
    return toStorageObject(response, { fileName });
  }

  /**
   * A PDF rendering. Dropbox can do this for Office formats only; for anything
   * else it answers with an "unsupported extension" error, which is a normal
   * outcome here rather than a fault, so it returns null.
   */
  async getPreview(idOrPath) {
    try {
      const response = await this.client.getPreview(idOrPath);
      return toStorageObject(response, { contentType: 'application/pdf' });
    } catch (error) {
      if (error?.dropboxTag?.includes('unsupported_extension') || error?.dropboxTag?.includes('unsupported_content')) {
        return null;
      }
      throw error;
    }
  }

  async getThumbnail(idOrPath, options = {}) {
    try {
      const response = await this.client.getThumbnail(idOrPath, options);
      return toStorageObject(response, {
        contentType: options.format === 'png' ? 'image/png' : 'image/jpeg',
      });
    } catch (error) {
      // A deck Dropbox cannot render has no thumbnail. That is not a failure
      // of the sync — the record simply carries no thumbnail_url.
      if (error?.dropboxTag?.includes('unsupported_extension') || error?.dropboxTag?.includes('conversion_error')) {
        return null;
      }
      throw error;
    }
  }

  async move(fromPath, toPath) {
    const result = await this.client.move(fromPath, toPath);
    if (!result?.metadata) {
      throw new DropboxApiError('Dropbox accepted the move but returned no metadata.');
    }
    return fromDropboxEntry(result.metadata);
  }

  async delete(path) {
    await this.client.delete(path);
    return true;
  }

  async getTemporaryLink(idOrPath) {
    const result = await this.client.getTemporaryLink(idOrPath);
    return {
      url: result.link,
      // Dropbox does not state the expiry; it is documented as four hours.
      expiresAt: new Date(Date.now() + 4 * 3600_000).toISOString(),
      metadata: result.metadata ? fromDropboxEntry(result.metadata) : null,
    };
  }
}
