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
  async resolvePreview(fileId) {
    const file = await this.files.findById(fileId);
    if (!file) throw new DropboxNotFoundError('That presentation is not in the library.');
    if (file.status === 'archived') {
      throw new DropboxNotFoundError('That presentation has been removed from Dropbox.');
    }

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
   * The bytes themselves, for the proxy endpoint.
   *
   * Returns a node/web stream plus the headers to copy — the route pipes it
   * straight to the response without the process ever holding the whole file.
   */
  async openContent(fileId, { preferPreview = true } = {}) {
    const file = await this.files.findById(fileId);
    if (!file) throw new DropboxNotFoundError('That presentation is not in the library.');

    const extension = (file.extension || '').toLowerCase();

    if (preferPreview && RENDERABLE.has(extension)) {
      const key = this.objectStore.key(file.external_id, file.revision, 'preview', 'application/pdf');
      if (await this.objectStore.has(key)) {
        return {
          source: 'cache',
          stream: this.objectStore.createReadStream(key),
          contentType: 'application/pdf',
          fileName: `${file.title || file.name}.pdf`,
        };
      }
      const rendered = await this.provider.getPreview(file.external_id);
      if (rendered) {
        await this.objectStore.putStream(key, rendered.stream);
        await this.files.updateById(file.id, {
          preview_url: this.objectStore.urlFor(key),
          file_url: this.objectStore.urlFor(key),
          preview_cached_at: new Date().toISOString(),
        });
        return {
          source: 'dropbox',
          stream: this.objectStore.createReadStream(key),
          contentType: 'application/pdf',
          fileName: `${file.title || file.name}.pdf`,
        };
      }
    }

    const object = await this.provider.download(file.external_id);
    return {
      source: 'dropbox',
      stream: object.stream,
      contentType:
        extension === 'pdf'
          ? 'application/pdf'
          : extension === 'html' || extension === 'htm'
            ? 'text/html; charset=utf-8'
            : object.contentType,
      contentLength: object.size || file.file_size,
      fileName: file.name,
    };
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
