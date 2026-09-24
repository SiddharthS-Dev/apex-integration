/**
 * Provider-neutral shapes.
 *
 * Everything above the StorageProvider interface speaks these, so a change in
 * Dropbox's response format is absorbed by one adapter instead of rippling
 * through the sync engine, the title pipeline and the database schema.
 */

/**
 * @typedef {object} FileMetadata
 * @property {string} externalId  stable id, survives renames
 * @property {string} path        normalized, lower-cased path for comparison
 * @property {string} pathDisplay path as the user typed it
 * @property {string} name        file name with extension
 * @property {string} extension   lower-case, no dot
 * @property {number} size        bytes
 * @property {string} revision    changes whenever the content changes
 * @property {string} contentHash provider content hash, "" when unavailable
 * @property {string|null} modifiedAt        ISO — server-side modification
 * @property {string|null} clientModifiedAt  ISO — as claimed by the client
 */

/** Builds a FileMetadata from a Dropbox `files/*` entry. */
export function fromDropboxEntry(entry) {
  const name = entry.name ?? '';
  const dot = name.lastIndexOf('.');
  return {
    externalId: entry.id ?? '',
    path: entry.path_lower ?? '',
    pathDisplay: entry.path_display ?? entry.path_lower ?? '',
    name,
    extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : '',
    size: Number(entry.size ?? 0),
    revision: entry.rev ?? '',
    contentHash: entry.content_hash ?? '',
    modifiedAt: entry.server_modified ?? null,
    clientModifiedAt: entry.client_modified ?? null,
  };
}

/**
 * @typedef {object} StorageObject
 * @property {ReadableStream|null} stream
 * @property {number} size
 * @property {string} contentType
 * @property {string} [fileName]
 */

/** Wraps a fetch Response as a StorageObject without buffering the body. */
export function toStorageObject(response, { contentType, fileName } = {}) {
  return {
    stream: response.body,
    size: Number(response.headers.get('content-length') ?? 0),
    contentType: contentType || response.headers.get('content-type') || 'application/octet-stream',
    fileName,
    /** Buffers the whole body. Only for files already known to be small. */
    async buffer() {
      return Buffer.from(await response.arrayBuffer());
    },
  };
}
