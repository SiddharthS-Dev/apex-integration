/**
 * The storage abstraction the synchronization engine is written against.
 *
 * The sync service, the content service and the title pipeline must not know
 * that Dropbox exists — they know `StorageProvider`. Adding OneDrive, S3 or
 * SharePoint later is then a new implementation of this interface plus a line
 * in the composition root, not a rewrite of the application logic (spec §19).
 *
 * Methods are documented in terms of the normalized shapes in this folder;
 * every implementation is responsible for translating its provider's own
 * vocabulary into them.
 */

/* eslint-disable no-unused-vars */

export class StorageProvider {
  /** @returns {string} stable provider key, e.g. "dropbox" */
  get name() {
    throw new Error('StorageProvider.name must be implemented.');
  }

  /** Account identity for display. @returns {Promise<{id: string, name: string, email: string}>} */
  async getAccount() {
    throw new Error('getAccount() must be implemented.');
  }

  /** Is the provider reachable and authorized right now? */
  async testConnection(rootFolder) {
    throw new Error('testConnection() must be implemented.');
  }

  /** Immediate subfolders of a path, for a folder browser. */
  async listFolders(path) {
    throw new Error('listFolders() must be implemented.');
  }

  /**
   * Every file under `path`, recursively and paginated.
   * @returns {AsyncGenerator<import('./FileMetadata.js').FileMetadata>}
   */
  async *listFiles(path, options) {
    throw new Error('listFiles() must be implemented.');
  }

  /** Metadata for one object. */
  async getMetadata(idOrPath) {
    throw new Error('getMetadata() must be implemented.');
  }

  /**
   * The bytes of an object.
   * @returns {Promise<{stream: ReadableStream, size: number, contentType: string}>}
   */
  async download(idOrPath, options) {
    throw new Error('download() must be implemented.');
  }

  /** A rendered preview (usually PDF), or null when the provider cannot make one. */
  async getPreview(idOrPath) {
    throw new Error('getPreview() must be implemented.');
  }

  /** A rendered thumbnail image, or null. */
  async getThumbnail(idOrPath, options) {
    throw new Error('getThumbnail() must be implemented.');
  }

  /** Renames/moves an object. @returns {Promise<import('./FileMetadata.js').FileMetadata>} */
  async move(fromPath, toPath) {
    throw new Error('move() must be implemented.');
  }

  async delete(path) {
    throw new Error('delete() must be implemented.');
  }

  /** A short-lived direct URL. Administrative use only. */
  async getTemporaryLink(idOrPath) {
    throw new Error('getTemporaryLink() must be implemented.');
  }
}
