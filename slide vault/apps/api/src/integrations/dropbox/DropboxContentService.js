/**
 * Serving file content to the application.
 *
 * The security rule that shapes this whole service: a normal user never
 * receives a Dropbox URL, a Dropbox token, or anything else that would let
 * them reach Dropbox directly. Content is proxied through the backend, behind
 * the application's own authorization (spec §42).
 *
 *   open a presentation
 *     -> cached preview on disk?  -> serve it
 *     -> PDF?                     -> stream the original through the backend
 *     -> Office format?           -> ask Dropbox to render a PDF, cache it
 *     -> HTML?                    -> stream it
 *
 * Temporary Dropbox links exist in exactly one place — AdminDownloadService —
 * and are gated on the admin role.
 */
import { M } from '../../services/metrics/metrics.js';
import { AUDIT } from '../../services/audit/AuditService.js';
import { DropboxNotFoundError } from './errors.js';
import { parseContentRange, parseRange } from '../../http/range.js';

/** Formats Dropbox can render to PDF for us. */
const RENDERABLE = new Set(['pptx', 'ppt', 'doc', 'docx', 'xls', 'xlsx']);

export class DropboxContentService {
  constructor({ config, provider, files, objectStore, metrics, logger, audit }) {
    this.config = config;
    this.provider = provider;
    this.files = files;
    this.objectStore = objectStore;
    this.metrics = metrics;
    this.audit = audit;
    this.logger = logger?.child?.({ component: 'DropboxContentService' }) ?? logger;
  }

  /**
   * Resolves what the viewer should load for a presentation.
   *
   * @returns {Promise<{kind: 'cached'|'stream', url?: string, contentType: string, fileType: string}>}
   */
  async resolvePreview(fileId, { allowArchived = false } = {}) {
    const file = await this.#findViewable(fileId, { allowArchived });

    const extension = (file.extension || '').toLowerCase();

    /* HTML and PDF are already viewable; they are proxied, not converted. */
    if (extension === 'pdf' || extension === 'html' || extension === 'htm') {
      return {
        kind: 'stream',
        fileType: file.file_type,
        contentType: extension === 'pdf' ? 'application/pdf' : 'text/html',
        streamUrl: `/api/dropbox/files/${file.id}/content`,
      };
    }

    /* Office formats get a Dropbox-rendered PDF, cached by revision. */
    const key = this.objectStore.key(file.external_id, file.revision, 'preview', 'application/pdf');
    if (await this.objectStore.has(key)) {
      this.metrics?.increment(M.previews, { outcome: 'cache_hit' });
      return {
        kind: 'cached',
        fileType: file.file_type,
        contentType: 'application/pdf',
        url: this.objectStore.urlFor(key),
        streamUrl: `/api/dropbox/files/${file.id}/content`,
      };
    }

    if (!RENDERABLE.has(extension)) {
      return {
        kind: 'stream',
        fileType: file.file_type,
        contentType: 'application/octet-stream',
        streamUrl: `/api/dropbox/files/${file.id}/content`,
      };
    }

    const object = await this.provider.getPreview(file.external_id);
    if (!object) {
      this.metrics?.increment(M.previews, { outcome: 'unsupported' });
      return {
        kind: 'stream',
        fileType: file.file_type,
        contentType: 'application/octet-stream',
        streamUrl: `/api/dropbox/files/${file.id}/content`,
      };
    }

    // Streamed to disk rather than buffered: a 200-slide deck renders to a PDF
    // far too large to hold in memory per concurrent viewer.
    const url = await this.objectStore.putStream(key, object.stream);
    await this.files.updateById(file.id, {
      preview_url: url,
      file_url: url,
      preview_cached_at: new Date().toISOString(),
    });
    this.metrics?.increment(M.previews, { outcome: 'generated' });

    return {
      kind: 'cached',
      fileType: file.file_type,
      contentType: 'application/pdf',
      url,
      streamUrl: `/api/dropbox/files/${file.id}/content`,
    };
  }

  /**
   * A record the caller may open, or a not-found error.
   *
   * An archived record is a file that has left Dropbox, and so has left the
   * library: to anyone but an administrator it must be as gone as a file that
   * never existed — including its cached preview, which outlives it on disk.
   */
  async #findViewable(fileId, { allowArchived = false } = {}) {
    const file = await this.files.findById(fileId);
    if (!file) throw new DropboxNotFoundError('That presentation is not in the library.');
    if (file.status !== 'active' && !allowArchived) {
      throw new DropboxNotFoundError('That presentation has been removed from Dropbox.');
    }
    return file;
  }

  /** A cached object as a (possibly partial) stream. */
  async #openCached(key, { contentType, fileName, source, rangeHeader }) {
    const { size } = await this.objectStore.stat(key);
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') return { unsatisfiable: true, size };
    return {
      source,
      stream: this.objectStore.createReadStream(key, range ?? undefined),
      contentType,
      fileName,
      size,
      range,
    };
  }

  /**
   * The bytes themselves, for the proxy endpoint.
   *
   * Returns a node/web stream plus what the route needs for its headers — it
   * pipes the stream straight to the response without the process ever
   * holding the whole file.
   *
   * With a Range header the result carries `range` (serve a 206) or
   * `unsatisfiable` (serve a 416). When the bytes come from Dropbox the range
   * is asked of Dropbox; if it answers with the whole file instead, `slice`
   * tells the route to cut the range out itself.
   *
   * @param {string} fileId
   * @param {{preferPreview?: boolean, allowArchived?: boolean, range?: string}} [options]
   */
  async openContent(fileId, { preferPreview = true, allowArchived = false, range: rangeHeader } = {}) {
    const file = await this.#findViewable(fileId, { allowArchived });

    const extension = (file.extension || '').toLowerCase();

    if (preferPreview && RENDERABLE.has(extension)) {
      const key = this.objectStore.key(file.external_id, file.revision, 'preview', 'application/pdf');
      const cached = {
        contentType: 'application/pdf',
        fileName: `${file.title || file.name}.pdf`,
        rangeHeader,
      };
      if (await this.objectStore.has(key)) {
        return this.#openCached(key, { ...cached, source: 'cache' });
      }
      const rendered = await this.provider.getPreview(file.external_id);
      if (rendered) {
        await this.objectStore.putStream(key, rendered.stream);
        await this.files.updateById(file.id, {
          preview_url: this.objectStore.urlFor(key),
          file_url: this.objectStore.urlFor(key),
          preview_cached_at: new Date().toISOString(),
        });
        return this.#openCached(key, { ...cached, source: 'dropbox' });
      }
    }

    const contentTypeFor = (object) =>
      extension === 'pdf'
        ? 'application/pdf'
        : extension === 'html' || extension === 'htm'
          ? 'text/html; charset=utf-8'
          : object.contentType;

    // A range that starts past the end of the file as we know it is refused
    // without a Dropbox round trip.
    const known = parseRange(rangeHeader, file.file_size || Number.NaN);
    if (known === 'unsatisfiable' && file.file_size > 0) {
      return { unsatisfiable: true, size: file.file_size };
    }
    const wantsRange = parseRange(rangeHeader, Number.MAX_SAFE_INTEGER) !== null;

    const object = await this.provider.download(
      file.external_id,
      wantsRange ? { range: String(rangeHeader).replace(/\s+/g, '') } : {}
    );
    const base = {
      source: 'dropbox',
      stream: object.stream,
      contentType: contentTypeFor(object),
      fileName: file.name,
    };

    if (object.status === 206) {
      const served = parseContentRange(object.contentRange);
      if (served && served.size !== null) {
        return { ...base, size: served.size, range: { start: served.start, end: served.end } };
      }
    }

    const size = object.size || file.file_size;
    if (!wantsRange) return { ...base, size, range: null };

    // Dropbox sent the whole file: honour the range by cutting it out here.
    const range = parseRange(rangeHeader, size);
    if (range === 'unsatisfiable') {
      await object.stream?.cancel?.().catch(() => {});
      return { unsatisfiable: true, size };
    }
    return { ...base, size, range, slice: range };
  }

  /** Drops cached derivatives for a file — used when a preview goes stale. */
  async invalidate(fileId) {
    const file = await this.files.findById(fileId);
    if (!file) return false;
    for (const kind of ['preview', 'thumb-w640h480']) {
      const key = this.objectStore.key(
        file.external_id,
        file.revision,
        kind,
        kind === 'preview' ? 'application/pdf' : 'image/jpeg'
      );
      await this.objectStore.remove(key).catch(() => {});
    }
    await this.files.updateById(fileId, { preview_url: '', file_url: '', preview_cached_at: null });
    return true;
  }
}

/**
 * Short-lived direct Dropbox links, for administrators only.
 *
 * Separated from the content service on purpose: this is the one capability
 * that hands out a URL Dropbox will serve without the application in the loop,
 * so it has its own class, its own audit record and its own feature flag
 * (spec §43).
 */
export class AdminDownloadService {
  constructor({ config, provider, files, audit, logger }) {
    this.config = config;
    this.provider = provider;
    this.files = files;
    this.audit = audit;
    this.logger = logger?.child?.({ component: 'AdminDownloadService' }) ?? logger;
  }

  /** @param {{id: string, email: string, role: string}} actor must be an admin */
  async createLink(fileId, actor, { ip = '' } = {}) {
    if (!this.config.dropbox.allowAdminDownload) {
      const error = new Error('Direct downloads are disabled for this deployment.');
      error.status = 403;
      throw error;
    }
    if (actor?.role !== 'admin') {
      const error = new Error('Administrator role required.');
      error.status = 403;
      throw error;
    }

    const file = await this.files.findById(fileId);
    if (!file) throw new DropboxNotFoundError('That presentation is not in the library.');

    const link = await this.provider.getTemporaryLink(file.external_id);

    await this.audit?.record({
      actorId: actor.id,
      actorEmail: actor.email,
      action: AUDIT.DOWNLOAD_LINK,
      target: file.name,
      ip,
      // The URL itself is a credential — record that a link was made, not
      // which link it was.
      details: { fileId: file.id, externalId: file.external_id },
    });

    return { url: link.url, expiresAt: link.expiresAt, fileName: file.name };
  }
}
