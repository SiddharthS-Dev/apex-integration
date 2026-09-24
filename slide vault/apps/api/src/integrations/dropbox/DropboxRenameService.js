/**
 * Bulk rename of generically-named files.
 *
 * This is the only part of the integration that *writes* to Dropbox, so it is
 * the most dangerous. Three rules constrain it:
 *
 *  1. Dry run first. The default is to propose, not to rename; an administrator
 *     sees every "Untitled (12).pptx -> Autonomous Infrastructure.pptx" pair
 *     before anything moves (spec §39).
 *  2. Never overwrite. autorename is off, so Dropbox reports a collision
 *     instead of resolving it silently, and a deterministic " (1)" suffix is
 *     tried instead (spec §40).
 *  3. Never rename on a weak title. The same validation the title pipeline
 *     uses applies here, and a file whose derived title is poor keeps its name.
 */
import { mapPool } from '../../util/async.js';
import { LOCKS } from '../../db/repositories/lockRepository.js';
import { M } from '../../services/metrics/metrics.js';
import { AUDIT } from '../../services/audit/AuditService.js';
import { isGenericName, validateTitle } from './genericNames.js';
import { basename, joinPath, parentOf, toSafeFileName, withCollisionSuffix } from './paths.js';
import { DropboxConflictError, DropboxNotFoundError } from './errors.js';

const MAX_COLLISION_ATTEMPTS = 20;

export class DropboxRenameService {
  constructor({ config, provider, files, audit, metrics, logger, titleResolver, extraction, thumbnails }) {
    this.config = config;
    this.provider = provider;
    this.files = files;
    this.audit = audit;
    this.metrics = metrics;
    this.logger = logger?.child?.({ component: 'DropboxRenameService' }) ?? logger;
    this.titleResolver = titleResolver;
    this.extraction = extraction;
    this.thumbnails = thumbnails;
    this.locks = null;
  }

  /** @param {import('../../db/repositories/lockRepository.js').LockRepository} locks */
  withLocks(locks) {
    this.locks = locks;
    return this;
  }

  /**
   * Finds generically-named files and proposes — or applies — better names.
   *
   * @param {{dryRun?: boolean, limit?: number, actor?: object, ip?: string}} options
   */
  async renameUntitled({ dryRun = true, limit = 50, actor = null, ip = '' } = {}) {
    if (!this.config.dropbox.allowRename) {
      const error = new Error('Renaming is disabled for this deployment.');
      error.status = 403;
      throw error;
    }

    const run = async () => {
      const candidates = (await this.files.listGenericTitled('dropbox'))
        .filter((file) => file.status === 'active')
        .filter((file) => isGenericName(file.name))
        .slice(0, Math.min(Number(limit) || 50, 200));

      const results = await mapPool(candidates, Math.min(4, this.config.sync.maxConcurrentFiles), (file) =>
        this.#proposeFor(file)
      );

      const proposals = [];
      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) proposals.push(result.value);
        else if (result.status === 'rejected') {
          proposals.push({
            id: result.item.id,
            currentName: result.item.name,
            proposedName: null,
            skipped: true,
            reason: result.reason?.userMessage ?? result.reason?.message ?? 'Could not derive a title.',
          });
        }
      }

      if (dryRun) {
        await this.audit?.record({
          actorId: actor?.id,
          actorEmail: actor?.email,
          action: AUDIT.RENAME_PREVIEWED,
          ip,
          details: { candidates: candidates.length, proposed: proposals.filter((p) => p.proposedName).length },
        });
        return { dryRun: true, examined: candidates.length, proposals };
      }

      const applied = [];
      for (const proposal of proposals) {
        if (!proposal.proposedName) {
          applied.push(proposal);
          continue;
        }
        applied.push(await this.#apply(proposal, { actor, ip }));
      }

      return {
        dryRun: false,
        examined: candidates.length,
        renamed: applied.filter((item) => item.renamed).length,
        failed: applied.filter((item) => item.error).length,
        proposals: applied,
      };
    };

    // Renaming while a sync is walking the same folder would race the catalog
    // against Dropbox's own view of it.
    if (!this.locks) return run();
    return this.locks.withLock(LOCKS.RENAME, 15 * 60_000, run, () => {
      const error = new Error('A rename operation is already running.');
      error.status = 409;
      throw error;
    });
  }

  /** Renames a single file to an explicit title, for the per-file admin action. */
  async renameOne(fileId, newTitle, { actor = null, ip = '', dryRun = false } = {}) {
    const file = await this.files.findById(fileId);
    if (!file) throw new DropboxNotFoundError('That presentation is not in the library.');

    const verdict = validateTitle(newTitle, { originalName: file.name });
    if (!verdict.ok) {
      const error = new Error(`That title was rejected (${verdict.reason}).`);
      error.status = 400;
      throw error;
    }

    const proposal = this.#buildProposal(file, verdict.title);
    if (dryRun) return { dryRun: true, ...proposal };
    return this.#apply(proposal, { actor, ip });
  }

  /* ----------------------------------------------------------- internals */

  async #proposeFor(file) {
    // Prefer a title that has already been resolved and accepted.
    if (file.title && file.title_source !== 'filename') {
      const verdict = validateTitle(file.title, { originalName: file.name });
      if (verdict.ok) return this.#buildProposal(file, verdict.title);
    }

    // Otherwise, derive one now — the same pipeline the sync uses.
    let document = null;
    if (this.extraction.supports(file.extension) && file.file_size <= this.config.sync.maxFileSizeBytes) {
      try {
        const object = await this.provider.download(file.external_id);
        document = await this.extraction.extract(await object.buffer(), {
          extension: file.extension,
          name: file.name,
          source: { provider: 'dropbox', externalId: file.external_id, path: file.path_display },
        });
      } catch (error) {
        this.logger?.warn?.('Could not read a file while proposing a rename', {
          file: file.name,
          error: error.message,
        });
      }
    }

    const images = document?.images ?? [];
    if (!images.length) {
      const thumbnail = await this.thumbnails
        .ensure({ externalId: file.external_id, revision: file.revision })
        .catch(() => null);
      const buffer = thumbnail?.buffer ?? (thumbnail?.key ? await this.thumbnails.readCached(thumbnail.key) : null);
      if (buffer) images.push({ mediaType: 'image/jpeg', data: buffer });
    }

    // An explicit admin request to find better names, so the AI tiers are
    // enabled regardless of the sync pipeline's cost-driven default.
    const resolved = await this.titleResolver.resolve(document ?? {}, {
      fileName: file.name,
      images,
      allowAi: true,
    });
    const verdict = validateTitle(resolved.title, { originalName: file.name });

    if (!verdict.ok || resolved.source === 'filename') {
      // Keeping a boring name is the correct outcome here, not a failure.
      return {
        id: file.id,
        currentName: file.name,
        currentPath: file.path_display,
        proposedName: null,
        skipped: true,
        reason: 'No confident title could be derived; the original filename is kept.',
      };
    }

    return this.#buildProposal(file, verdict.title, resolved.source);
  }

  #buildProposal(file, title, titleSource = 'manual') {
    const proposedName = toSafeFileName(title, file.extension);
    return {
      id: file.id,
      externalId: file.external_id,
      currentName: file.name,
      currentPath: file.path_display,
      proposedName,
      proposedPath: joinPath(parentOf(file.path_display), proposedName),
      title,
      titleSource,
      skipped: proposedName === file.name,
      reason: proposedName === file.name ? 'The file is already named this.' : '',
    };
  }

  /**
   * Performs the move, retrying with " (1)", " (2)" … on a collision.
   *
   * The database is updated only after Dropbox confirms — the catalog must
   * never claim a name that Dropbox does not have.
   */
  async #apply(proposal, { actor, ip }) {
    if (proposal.skipped || !proposal.proposedName) return { ...proposal, renamed: false };

    const folder = parentOf(proposal.currentPath);
    let lastError = null;

    for (let attempt = 0; attempt < MAX_COLLISION_ATTEMPTS; attempt += 1) {
      const candidateName = withCollisionSuffix(proposal.proposedName, attempt);
      const candidatePath = joinPath(folder, candidateName);

      if (candidatePath.toLowerCase() === String(proposal.currentPath).toLowerCase()) {
        return { ...proposal, renamed: false, reason: 'The file is already named this.' };
      }

      try {
        const metadata = await this.provider.move(proposal.currentPath, candidatePath);

        await this.files.updateById(proposal.id, {
          name: metadata.name,
          path: metadata.path,
          path_display: metadata.pathDisplay,
          revision: metadata.revision,
          title: proposal.title,
          title_source: proposal.titleSource === 'manual' ? 'manual' : proposal.titleSource,
        });

        this.metrics?.increment(M.renames, { outcome: 'renamed' });
        await this.audit?.record({
          actorId: actor?.id,
          actorEmail: actor?.email,
          action: AUDIT.FILE_RENAMED,
          target: metadata.name,
          ip,
          details: { from: basename(proposal.currentPath), to: metadata.name, fileId: proposal.id },
        });

        return { ...proposal, renamed: true, finalName: metadata.name, finalPath: metadata.pathDisplay };
      } catch (error) {
        lastError = error;
        if (error instanceof DropboxConflictError) continue; // try the next suffix
        break;
      }
    }

    this.metrics?.increment(M.renames, { outcome: 'failed' });
    this.logger?.warn?.('Rename failed', { file: proposal.currentName, error: lastError?.message });
    return {
      ...proposal,
      renamed: false,
      error: lastError?.userMessage ?? lastError?.message ?? 'The rename failed.',
    };
  }
}
