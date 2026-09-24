/**
 * Thumbnails.
 *
 * Dropbox renders them, we cache them. The cache key includes the file's
 * revision, so an unchanged file is never re-fetched (spec §44) and a changed
 * one automatically misses the cache instead of serving a stale picture.
 *
 * The cached image doubles as the vision input for title resolution: it is a
 * render of slide 1, which is exactly what the vision prompt wants, and it
 * costs nothing extra once it has been fetched.
 */
import { M } from '../../services/metrics/metrics.js';

/**
 * Formats Dropbox will render a thumbnail for.
 *
 * This list is load-bearing, not documentation. Without it, a file Dropbox
 * cannot render — an .html export, say — would have an empty `thumbnail_url`
 * forever, the sync would read that as "thumbnail missing, reprocess", and it
 * would re-download and re-extract that file on every single run, for ever.
 */
const THUMBNAILABLE = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'tif', 'tiff',
  'ppt', 'pptx', 'doc', 'docx', 'xls', 'xlsx', 'rtf', 'pdf',
]);

/** True when it is worth asking Dropbox for a thumbnail at all. */
export function supportsThumbnail(extension) {
  return THUMBNAILABLE.has(String(extension ?? '').toLowerCase());
}

export class DropboxThumbnailService {
  /**
   * @param {{provider: import('../../domain/storage/StorageProvider.js').StorageProvider,
   *          objectStore: import('../../services/storage/ObjectStore.js').ObjectStore}} deps
   */
  constructor({ provider, objectStore, metrics, logger }) {
    this.provider = provider;
    this.objectStore = objectStore;
    this.metrics = metrics;
    this.logger = logger?.child?.({ component: 'DropboxThumbnailService' }) ?? logger;
  }

  /**
   * Returns the cached thumbnail URL, fetching it only on a miss.
   *
   * @returns {Promise<{url: string, cached: boolean, buffer: Buffer|null}>}
   */
  async ensure({ externalId, revision, size = 'w640h480' }) {
    const key = this.objectStore.key(externalId, revision, `thumb-${size}`, 'image/jpeg');

    if (await this.objectStore.has(key)) {
      this.metrics?.increment(M.thumbnails, { outcome: 'cache_hit' });
      return { url: this.objectStore.urlFor(key), cached: true, buffer: null, key };
    }

    const object = await this.provider.getThumbnail(externalId, { format: 'jpeg', size });
    if (!object) {
      // Dropbox cannot render this format. Not an error: the record simply has
      // no thumbnail and the UI falls back to a generated cover.
      this.metrics?.increment(M.thumbnails, { outcome: 'unsupported' });
      return { url: '', cached: false, buffer: null, key: null };
    }

    // Thumbnails are small and are needed in memory anyway for the vision
    // fallback, so this is the one place buffering is the right call.
    const buffer = await object.buffer();
    const url = await this.objectStore.putBuffer(key, buffer);
    this.metrics?.increment(M.thumbnails, { outcome: 'generated' });

    return { url, cached: false, buffer, key };
  }

  /** The cached bytes for a thumbnail, when it is already on disk. */
  async readCached(key) {
    if (!key || !(await this.objectStore.has(key))) return null;
    return this.objectStore.readBuffer(key);
  }
}
