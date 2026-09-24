/**
 * The sync pipeline: Dropbox folder -> indexed, titled, classified library.
 *
 *   1. Discover  files/list_folder, recursive and paginated, filtered to the
 *                supported types.
 *   2. Compare   match each entry to its stored record by Dropbox id and
 *                revision. Unchanged files are skipped, but their last-seen
 *                stamp is refreshed so the archive pass stays truthful — which
 *                is also why an interrupted sync is cheap to resume.
 *   3. Process   changed and new files through a bounded pool: thumbnail
 *                first (it doubles as the vision input), then extraction,
 *                then classification and title resolution.
 *   4. Archive   anything active that this run did not see is archived, never
 *                deleted — and only when discovery genuinely succeeded and the
 *                run finished, so a transient failure cannot wipe the library.
 *   5. Record    counts, duration and errors to sync_log: success, or partial
 *                if any file failed.
 *
 * Only one run at a time across every instance: the run holds a DB lock,
 * renewed by a heartbeat, for its whole duration.
 */
import { SYNC_STATUS, fileTypeOf, extensionOf, isSupported } from '@inspironics/shared'
import { mapPool } from '../lib/concurrency.js'
import { HttpError } from '../lib/http.js'
import { DropboxApiError } from '../dropbox/client.js'
import { extractContent, imageSize } from './extract.js'
import { resolveTitle } from './titles.js'

export const THUMB_SIZE = 'w640h480'
export const SETTINGS_ROOT_KEY = 'dropbox.rootPath'

export class SyncBusyError extends HttpError {
  constructor() {
    super(409, 'A synchronization is already running.', 'SYNC_RUNNING')
  }
}

export function createSyncService({ config, repos, dropbox, dropboxAuth, store, enricher, seeds, log, metrics }) {
  /** In-process view of the run this instance owns, for the progress bar. */
  let current = null
  let stopping = false

  const rootPath = async () => {
    const saved = await repos.settings.get(SETTINGS_ROOT_KEY, null)
    return saved ?? config.dropbox.rootPath
  }

  /* ------------------------------------------------------- discovery -- */

  async function discover(path) {
    const files = []
    for await (const page of dropbox.listFolder(path)) {
      for (const e of page) {
        if (e['.tag'] !== 'file' || !isSupported(e.name)) continue
        files.push({
          externalId: e.id,
          name: e.name,
          pathLower: e.path_lower,
          pathDisplay: e.path_display,
          rev: e.rev,
          size: Number(e.size) || 0,
          contentHash: e.content_hash,
          serverModified: e.server_modified,
          ext: extensionOf(e.name),
          kind: fileTypeOf(e.name).kind,
        })
      }
      if (current) current.discovered = files.length
    }
    return files
  }

  /** Does this stored record need (re)processing? */
  function needsWork(entry, existing) {
    if (!existing) return true
    if (existing.processedRev !== entry.rev) return true
    if (existing.classificationStatus === 'failed') return true
    // AI switched on since this file was indexed: classify what was left unclassified
    if (enricher.enabled && existing.classificationStatus === 'unclassified') return true
    return false
  }

  /* --------------------------------------------------------- process -- */

  async function processFile(entry, existing, syncId) {
    const warnings = []
    const warn = (message) => warnings.push(message)

    // thumbnail first: it is both the gallery image and the vision input
    let thumb = null
    try {
      thumb = await dropbox.thumbnail(entry.externalId, THUMB_SIZE)
      await store.put(entry.externalId, entry.rev, 'thumb', thumb, 'image/jpeg')
    } catch (error) {
      if (error instanceof DropboxApiError && error.status === 409) warn(`No thumbnail: ${error.summary.split('/')[0] || 'unsupported'}`)
      else if (error instanceof DropboxApiError) warn(`Thumbnail failed: ${error.message}`)
      else throw error
    }

    let dims = thumb ? imageSize(thumb) : null
    let content = null
    if (entry.kind === 'document') {
      if (entry.size > config.sync.maxExtractMb * 1048576) {
        warn(`Content extraction skipped: ${(entry.size / 1048576).toFixed(0)} MB exceeds the ${config.sync.maxExtractMb} MB limit`)
      } else {
        try {
          content = await extractContent(entry.ext, await dropbox.downloadBuffer(entry.externalId))
        } catch (error) {
          warn(`Content extraction failed: ${error.message}`)
        }
      }
    }

    const seed = seeds.match(entry.name)
    let meta = {}
    let classificationStatus = 'unclassified'
    let confidence = null
    let aiTitle = ''

    if (existing?.classificationStatus === 'admin') {
      // an administrator's edits outrank everything, including a new revision
      meta = existing.meta
      classificationStatus = 'admin'
      confidence = 1
    } else if (seed) {
      meta = seed.meta
      classificationStatus = 'seed'
      confidence = 1
    } else if (enricher.enabled) {
      try {
        const result = await enricher.enrich({ filename: entry.name, text: content?.text || '', image: thumb || undefined, hint: entry.pathDisplay })
        if (result) {
          meta = result.meta
          aiTitle = result.title
          confidence = result.confidence
          classificationStatus = 'classified'
        } else {
          classificationStatus = 'failed'
          warn('The model declined to classify this file')
        }
      } catch (error) {
        classificationStatus = 'failed'
        warn(`Classification failed: ${error.message}`)
      }
    }

    const hasText = !!content?.text?.trim()
    const { title, source } =
      existing?.classificationStatus === 'admin' && existing.titleSource === 'admin'
        ? { title: existing.title, source: 'admin' }
        : resolveTitle({
            filename: entry.name,
            seed: seed?.title,
            metadata: content?.metadataTitle,
            text: content?.text,
            model: hasText ? aiTitle : '',
            vision: hasText ? '' : aiTitle,
          })

    if (meta.w && meta.h) dims = { width: meta.w, height: meta.h }

    await repos.files.upsert({
      id: existing?.id,
      ...entry,
      processedRev: entry.rev,
      title,
      titleSource: source,
      meta,
      classificationStatus,
      confidence,
      width: dims?.width,
      height: dims?.height,
      warnings,
      syncId,
    })
    metrics?.inc('sync_files_processed_total', { kind: entry.kind, classification: classificationStatus })
    return { added: !existing, warnings }
  }

  /* ------------------------------------------------------------- run -- */

  async function execute({ syncId, lock, path, started }) {
    const summary = { discovered: 0, added: 0, updated: 0, unchanged: 0, archived: 0, failed: 0, skipped: 0, errors: [], warnings: [] }
    let status = SYNC_STATUS.SUCCESS
    const heartbeat = setInterval(async () => {
      try {
        if (!(await lock.renew())) log.error('Lost the sync lock mid-run', { syncId })
      } catch (error) {
        log.error('Sync lock heartbeat failed', { error })
      }
    }, (config.sync.lockTtlSeconds * 1000) / 3)

    try {
      let discovered
      try {
        discovered = await discover(path)
      } catch (error) {
        const message =
          error instanceof DropboxApiError && error.is('path/not_found')
            ? `The sync folder "${path || '/'}" does not exist in Dropbox.`
            : error.message
        summary.errors.push({ stage: 'discovery', message })
        status = SYNC_STATUS.FAILED
        log.error('Sync discovery failed; nothing archived', { syncId, error })
        return
      }
      summary.discovered = discovered.length

      const index = await repos.files.index()
      const unchanged = []
      const work = []
      for (const entry of discovered) {
        const existing = index.get(entry.externalId)
        if (needsWork(entry, existing)) work.push({ entry, existing })
        else unchanged.push(existing.id)
      }
      await repos.files.markSeen(unchanged, syncId)
      summary.unchanged = unchanged.length
      current.total = work.length
      log.info('Sync plan', { syncId, discovered: discovered.length, toProcess: work.length, unchanged: unchanged.length })

      const results = await mapPool(
        work,
        config.sync.concurrency,
        async ({ entry, existing }) => {
          try {
            return await processFile(entry, existing, syncId)
          } finally {
            current.done++
          }
        },
        { shouldStop: () => stopping }
      )

      const failedExisting = []
      results.forEach((r, i) => {
        const { entry, existing } = work[i]
        if (!r) {
          summary.skipped++
          if (existing) failedExisting.push(existing.id)
        } else if (!r.ok) {
          summary.failed++
          summary.errors.push({ file: entry.pathDisplay, message: r.error?.message || String(r.error) })
          log.warn('File failed to process', { file: entry.pathDisplay, error: r.error })
          // it is still in Dropbox: keep its old record alive rather than archive it
          if (existing) failedExisting.push(existing.id)
        } else {
          if (r.value.added) summary.added++
          else summary.updated++
          for (const w of r.value.warnings) summary.warnings.push({ file: entry.pathDisplay, message: w })
        }
      })
      await repos.files.markSeen(failedExisting, syncId)

      if (stopping) {
        status = SYNC_STATUS.PARTIAL
        summary.errors.push({ stage: 'shutdown', message: 'Stopped before finishing; archiving was skipped.' })
      } else {
        summary.archived = await repos.files.archiveUnseen(syncId)
        if (summary.failed > 0) status = SYNC_STATUS.PARTIAL
      }
    } catch (error) {
      status = SYNC_STATUS.FAILED
      summary.errors.push({ stage: 'run', message: error.message })
      log.error('Sync failed', { syncId, error })
    } finally {
      clearInterval(heartbeat)
      const durationMs = Date.now() - started
      await repos.syncLog.finish(syncId, { ...summary, status, durationMs }).catch((error) => log.error('Could not write sync_log', { error }))
      await lock.release().catch(() => {})
      metrics?.inc('sync_runs_total', { status })
      metrics?.observe('sync_duration_ms', {}, durationMs)
      log.info('Sync finished', { syncId, status, durationMs, ...summary, errors: summary.errors.length, warnings: summary.warnings.length })
      current = null
    }
  }

  return {
    /**
     * Take the lock and begin a run. Resolves once the run has *started*
     * (with its id) — the work continues in the background. Throws
     * SyncBusyError if any instance is already syncing.
     */
    async start({ trigger, triggeredBy = null }) {
      const conn = await dropboxAuth.getConnection({ fresh: true })
      if (!conn) throw new HttpError(409, 'Connect Dropbox before running a sync.', 'DROPBOX_NOT_CONNECTED')
      if (conn.status === 'reauth_required') throw new HttpError(409, 'Reconnect Dropbox before running a sync.', 'DROPBOX_REAUTH')

      const lock = await repos.db.tryLock('sync', config.sync.lockTtlSeconds * 1000)
      if (!lock) throw new SyncBusyError()
      const path = await rootPath()
      const started = Date.now()
      let syncId
      try {
        syncId = await repos.syncLog.start({ trigger, triggeredBy, rootPath: path || '/' })
      } catch (error) {
        await lock.release()
        throw error
      }
      current = { id: syncId, trigger, startedAt: new Date(started).toISOString(), discovered: 0, total: 0, done: 0 }
      log.info('Sync started', { syncId, trigger, path: path || '/' })
      const done = execute({ syncId, lock, path, started })
      return { id: syncId, done }
    },

    /** Progress of a run owned by this instance, or null. */
    progress: () => (current ? { ...current } : null),

    rootPath,

    /** Ask a running sync to finish its in-flight files and stop. */
    stop() {
      stopping = true
    },
  }
}
