/**
 * Synchronization.
 *
 *   list (recursive, paginated)
 *     -> revision unchanged and title fine?  -> skip, cheaply
 *     -> otherwise: download, extract, resolve title, thumbnail, classify
 *     -> upsert by (provider, external_id)
 *   files that vanished from Dropbox        -> archived, never deleted
 *   the whole run                           -> one SyncLog row
 *
 * Three properties the implementation is built around:
 *
 *  - **Idempotent.** Identity is the provider file id, and writes are upserts,
 *    so running sync three times produces one record per file, not three.
 *  - **Incremental.** An unchanged revision skips the download, the AI calls
 *    and the thumbnail entirely — which is the difference between a 40-second
 *    sync and a 40-minute one on a library of ten thousand decks.
 *  - **Partially failable.** One unreadable file fails that file and no more;
 *    197 of 200 processed is reported as 197 processed and 3 failed, not as a
 *    rolled-back run (§56).
 */
import { mapPool } from '../../util/async.js';
import { LOCKS } from '../../db/repositories/lockRepository.js';
import { M } from '../../services/metrics/metrics.js';
import { AUDIT } from '../../services/audit/AuditService.js';
import { TitleResolver } from '../../services/title-resolution/TitleResolver.js';
import { isGenericName } from './genericNames.js';
import { supportsThumbnail } from './DropboxThumbnailService.js';
import { normalizePath } from './paths.js';
import { DropboxConfigurationError, DropboxNotFoundError } from './errors.js';

/** Dropbox file types the application can actually present. */
const FILE_TYPE_BY_EXTENSION = {
  pdf: 'pdf',
  pptx: 'pptx',
  ppt: 'pptx',
  html: 'html',
  htm: 'html',
  docx: 'docx',
  xlsx: 'xlsx',
  mp4: 'mp4',
};

export class DropboxSyncService {
  constructor({
    config,
    provider,
    connections,
    files,
    syncLogs,
    locks,
    audit,
    metrics,
    logger,
    extraction,
    titleResolver,
    analysis,
    thumbnails,
  }) {
    this.config = config;
    this.provider = provider;
    this.connections = connections;
    this.files = files;
    this.syncLogs = syncLogs;
    this.locks = locks;
    this.audit = audit;
    this.metrics = metrics;
    this.logger = logger?.child?.({ component: 'DropboxSyncService' }) ?? logger;
    this.extraction = extraction;
    this.titleResolver = titleResolver;
    this.analysis = analysis;
    this.thumbnails = thumbnails;
  }

  /** True when a sync is in flight anywhere in the deployment. */
  async isRunning() {
    return this.locks.isHeld(LOCKS.SYNC);
  }

  /**
   * Runs one synchronization.
   *
   * @param {{trigger?: string, actor?: object, force?: boolean}} [options]
   *        force reprocesses every file, ignoring revision equality.
   */
  async run({ trigger = 'manual', actor = null, force = false } = {}) {
    // The lock is the only thing standing between a 30-minute scheduler tick
    // and an admin pressing "Run sync now": both would otherwise download the
    // same library at the same time.
    return this.locks.withLock(
      LOCKS.SYNC,
      this.config.sync.lockTtlMinutes * 60_000,
      (lock) => this.#execute({ trigger, actor, force, lock }),
      () => ({
        status: 'skipped',
        reason: 'A synchronization is already running.',
        counts: emptyCounts(),
      })
    );
  }

  async #execute({ trigger, actor, force, lock }) {
    const connection = await this.connections.get('dropbox');
    if (!connection?.refreshToken) {
      throw new DropboxConfigurationError('Dropbox is not connected.', {
        userMessage: 'Dropbox is not connected. Connect it in the admin settings first.',
      });
    }

    const rootFolder = normalizePath(connection.root_folder);
    const started = process.hrtime.bigint();
    const { id: syncId } = await this.syncLogs.start({
      connectionId: connection.id,
      trigger,
      actorEmail: actor?.email ?? '',
      rootFolder,
    });
    const log = this.logger?.child?.({ syncId, trigger });

    await this.connections.update('dropbox', { sync_status: 'running' });
    await this.audit?.record({
      actorId: actor?.id,
      actorEmail: actor?.email,
      action: AUDIT.SYNC_STARTED,
      target: rootFolder || '/',
      details: { trigger, syncId, force },
    });

    const counts = emptyCounts();
    const errors = [];
    const seenExternalIds = [];

    try {
      /* ------------------------------------------------ 1. discovery */
      const discovered = [];
      for await (const metadata of this.provider.listFiles(rootFolder, {
        extensions: this.config.sync.supportedExtensions,
      })) {
        discovered.push(metadata);
        seenExternalIds.push(metadata.externalId);
      }
      counts.total = discovered.length;
      log?.info?.('Discovery complete', { discovered: discovered.length, rootFolder: rootFolder || '/' });

      /* ------------------------- 2. compare against what we already hold */
      const existing = await this.files.indexByExternalId('dropbox');

      const work = [];
      for (const metadata of discovered) {
        const current = existing.get(metadata.externalId);
        const decision = decideWork(metadata, current, { force });
        if (decision.action === 'skip') {
          counts.skipped += 1;
          this.metrics?.increment(M.filesSkipped, { reason: decision.reason });
          // A skipped file is still present: refresh its "last seen" stamp so
          // the archive pass and the admin UI both stay truthful.
          await this.files.updateById(current.id, {
            last_synced_at: new Date().toISOString(),
            status: 'active',
          });
          continue;
        }
        work.push({ metadata, current, decision });
      }

      /* ----------------------------- 3. process, with bounded concurrency */
      // Unbounded concurrency here would open one socket per file and run one
      // AI call per file at the same instant; the pool is what keeps a large
      // library from taking the process (or the Dropbox quota) down with it.
      const results = await mapPool(work, this.config.sync.maxConcurrentFiles, async (item) => {
        // A long run must not let its own lock expire underneath it.
        await lock?.renew?.(this.config.sync.lockTtlMinutes * 60_000).catch(() => {});
        return this.#processFile(item, log);
      });

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value.created) counts.new += 1;
          else counts.updated += 1;
          this.metrics?.increment(M.filesProcessed, { outcome: 'success' });
        } else {
          counts.failed += 1;
          this.metrics?.increment(M.filesFailed, { kind: result.reason?.name ?? 'Error' });
          const name = result.item?.metadata?.name ?? 'unknown file';
          errors.push({ file: name, error: result.reason?.message ?? String(result.reason) });
          log?.warn?.('File failed to process', { file: name, error: result.reason?.message });
        }
      }

      /* ----------------------------------------- 4. archive what is gone */
      // Only when discovery actually succeeded: an empty listing caused by a
      // transient failure would otherwise archive the entire library.
      counts.deleted = await this.files.archiveMissing(seenExternalIds, 'dropbox');
      if (counts.deleted) this.metrics?.increment(M.filesArchived, {}, counts.deleted);

      /* --------------------------------------------------- 5. bookkeeping */
      const status = counts.failed ? 'partial' : 'success';
      const durationSeconds = Number(process.hrtime.bigint() - started) / 1e9;

      const record = await this.syncLogs.finish(syncId, {
        status,
        counts,
        details: {
          rootFolder: rootFolder || '/',
          trigger,
          force,
          errors: errors.slice(0, 50),
          errorCount: errors.length,
        },
      });

      await this.connections.update('dropbox', {
        sync_status: status === 'success' ? 'success' : 'error',
        last_sync_at: new Date().toISOString(),
        last_sync_status: status,
        last_error: counts.failed ? `${counts.failed} file(s) failed to process.` : '',
      });

      this.metrics?.increment(M.syncTotal, { trigger, status });
      if (counts.failed) this.metrics?.increment(M.syncFailures, { trigger, kind: 'partial' });
      this.metrics?.observe(M.syncDuration, durationSeconds, { trigger });

      await this.audit?.record({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: AUDIT.SYNC_COMPLETED,
        target: rootFolder || '/',
        outcome: status === 'success' ? 'success' : 'partial',
        details: { syncId, ...counts, durationSeconds: Math.round(durationSeconds) },
      });

      log?.info?.('Sync complete', { ...counts, durationSeconds: Math.round(durationSeconds) });
      return { status, syncId, counts, errors: errors.slice(0, 20), log: record };
    } catch (error) {
      await this.syncLogs.finish(syncId, {
        status: 'error',
        counts,
        error: error.message,
        details: { rootFolder: rootFolder || '/', trigger, errors: errors.slice(0, 50) },
      });
      await this.connections.update('dropbox', {
        sync_status: 'error',
        last_sync_at: new Date().toISOString(),
        last_sync_status: 'error',
        last_error: (error.userMessage ?? error.message ?? '').slice(0, 500),
      });

      this.metrics?.increment(M.syncTotal, { trigger, status: 'error' });
      this.metrics?.increment(M.syncFailures, { trigger, kind: error.name ?? 'Error' });

      await this.audit?.record({
        actorId: actor?.id,
        actorEmail: actor?.email,
        action: AUDIT.SYNC_FAILED,
        target: rootFolder || '/',
        outcome: 'failure',
        details: { syncId, error: error.message },
      });

      this.logger?.error?.('Sync failed', { syncId, error: error.message });
      throw error;
    }
  }

  /**
   * The per-file pipeline.
   *
   *   metadata -> (download -> extract -> title -> thumbnail -> classify) -> upsert
   *
   * Each stage is allowed to come up empty; only a failure to write the record
   * counts as a failed file.
   */
  async #processFile({ metadata, current, decision }, log) {
    const started = process.hrtime.bigint();
    const created = !current;

    // Mark it in flight so a crashed run is visible as "processing", not as a
    // record that silently never updated.
    if (current) {
      await this.files.updateById(current.id, { processing_state: 'processing' });
    }

    const patch = {
      path: metadata.path,
      path_display: metadata.pathDisplay,
      name: metadata.name,
      extension: metadata.extension,
      file_type: FILE_TYPE_BY_EXTENSION[metadata.extension] ?? metadata.extension,
      file_size: metadata.size,
      revision: metadata.revision,
      content_hash: metadata.contentHash,
      modified_at: metadata.modifiedAt,
      client_modified_at: metadata.clientModifiedAt,
      status: 'active',
      last_synced_at: new Date().toISOString(),
      last_error: '',
      processing_state: 'success',
    };

    try {
      /* ------------------------------------------------------- thumbnail */
      // First, because the rendered image is also the vision fallback input.
      let thumbnailBuffer = null;
      if (supportsThumbnail(metadata.extension)) {
        try {
          const thumbnail = await this.thumbnails.ensure({
            externalId: metadata.externalId,
            revision: metadata.revision,
          });
          if (thumbnail.url) patch.thumbnail_url = thumbnail.url;
          thumbnailBuffer = thumbnail.buffer;
        } catch (error) {
          log?.warn?.('Thumbnail generation failed', { file: metadata.name, error: error.message });
        }
      }

      /* -------------------------------------------------------- content */
      const needsTitle = TitleResolver.needsResolution({
        fileName: metadata.name,
        currentTitle: current?.title,
        titleSource: current?.title_source,
      });
      const needsContent = needsTitle || !current?.primary_domain || decision.action === 'update';

      let document = null;
      if (needsContent && this.#isDownloadable(metadata)) {
        document = await this.#extract(metadata, log);
      }

      if (document?.slideCount) patch.slide_count = document.slideCount;
      if (document?.metadata?.author) patch.author = String(document.metadata.author).slice(0, 200);

      /* ---------------------------------------------------------- title */
      if (needsTitle) {
        const images = [];
        if (document?.images?.length) images.push(...document.images);
        // An image-only deck whose embedded pictures could not be read still
        // has the Dropbox render of slide 1 — use it rather than give up.
        if (!images.length && thumbnailBuffer) {
          images.push({ mediaType: 'image/jpeg', data: thumbnailBuffer });
        }

        const resolved = await this.titleResolver.resolve(document ?? {}, {
          fileName: metadata.name,
          images,
        });
        patch.title = resolved.title;
        patch.title_source = resolved.source;
      } else if (current?.title) {
        patch.title = current.title;
        patch.title_source = current.title_source;
      } else {
        patch.title = metadata.name;
        patch.title_source = 'filename';
      }

      /* ------------------------------------------------- classification */
      if (document && this.analysis?.available && (created || !current?.primary_domain || decision.action === 'update')) {
        const classification = await this.analysis.classify(document, { title: patch.title });
        if (classification) {
          patch.primary_domain = classification.primary_domain;
          patch.sub_domain = classification.sub_domain;
          patch.category = classification.category;
          patch.tags_json = JSON.stringify(classification.tags);
          patch.keywords_json = JSON.stringify(classification.keywords);
          patch.learning_objectives_json = JSON.stringify(classification.learning_objectives);
          patch.ai_summary = classification.summary;
          patch.description = classification.summary;
          patch.ai_confidence = classification.confidence;
        }
      }

      const record = await this.files.upsert(metadata.externalId, patch, 'dropbox');
      this.metrics?.observe(M.fileProcessing, Number(process.hrtime.bigint() - started) / 1e9, {
        type: patch.file_type,
      });
      return { created, record };
    } catch (error) {
      // Record the failure against the file so the admin can see *which* file
      // is broken, then rethrow for the run-level tally.
      await this.files
        .upsert(
          metadata.externalId,
          {
            ...patch,
            processing_state: 'failed',
            last_error: (error.userMessage ?? error.message ?? '').slice(0, 500),
            title: current?.title || metadata.name,
          },
          'dropbox'
        )
        .catch(() => {});
      throw error;
    }
  }

  /** Files too large to buffer are indexed by metadata only (spec §57). */
  #isDownloadable(metadata) {
    if (metadata.size > this.config.sync.maxFileSizeBytes) {
      this.logger?.info?.('Skipping content extraction for an oversized file', {
        file: metadata.name,
        size: metadata.size,
        limit: this.config.sync.maxFileSizeBytes,
      });
      return false;
    }
    return this.extraction.supports(metadata.extension);
  }

  async #extract(metadata, log) {
    try {
      const object = await this.provider.download(metadata.externalId);
      const buffer = await object.buffer();
      return this.extraction.extract(buffer, {
        extension: metadata.extension,
        name: metadata.name,
        source: { provider: 'dropbox', externalId: metadata.externalId, path: metadata.pathDisplay },
      });
    } catch (error) {
      if (error instanceof DropboxNotFoundError) throw error;
      // A download failure degrades the record; it does not fail the file,
      // because the metadata alone is still worth indexing.
      log?.warn?.('Could not download for extraction', { file: metadata.name, error: error.message });
      return null;
    }
  }
}

/**
 * The incremental-sync decision (spec §24/§25).
 *
 * An unchanged revision is skipped — unless the record's title is still a
 * generic filename, which is the one condition that justifies reprocessing a
 * file that has not changed: the AI pipeline may have been unavailable, or the
 * file may have been indexed before vision was configured.
 */
export function decideWork(metadata, current, { force = false } = {}) {
  if (force) return { action: 'update', reason: 'forced' };
  if (!current) return { action: 'create', reason: 'new' };
  if (current.status === 'archived') return { action: 'update', reason: 'restored' };
  if (current.revision !== metadata.revision) return { action: 'update', reason: 'revision_changed' };
  if (current.processing_state === 'failed') return { action: 'update', reason: 'retry_failed' };
  if (current.title_source === 'filename' && isGenericName(current.title || current.name)) {
    return { action: 'update', reason: 'generic_title' };
  }
  // Only chase a missing thumbnail for a format Dropbox can actually render.
  // Otherwise an .html file, which never gets one, would be re-downloaded and
  // re-extracted on every run for the rest of the library's life.
  if (!current.thumbnail_url && supportsThumbnail(metadata.extension || current.extension)) {
    return { action: 'update', reason: 'missing_thumbnail' };
  }
  return { action: 'skip', reason: 'unchanged' };
}

const emptyCounts = () => ({ total: 0, new: 0, updated: 0, deleted: 0, skipped: 0, failed: 0 });
