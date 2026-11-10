/**
 * Runs the sync every SYNC_INTERVAL_MINUTES, and once at startup if
 * SYNC_ON_STARTUP is set. Every instance runs a scheduler; the sync's DB lock
 * makes all but one of them a no-op, so there is no leader to elect.
 */
import { FOLDER_REQUIRED, SyncBusyError } from './pipeline.js'

export function startScheduler({ config, sync, store, log }) {
  // Daily cache retention runs whether or not scheduled sync is on.
  const sweep = async () => {
    try {
      const removed = await store?.purgeOlderThan?.(config.objectCacheTtlHours)
      if (removed) log.info('Preview cache retention', { removed, olderThanHours: config.objectCacheTtlHours })
    } catch (error) {
      log.warn('Preview cache retention failed', { error: error.message })
    }
  }
  const retention = store ? setInterval(sweep, 24 * 3600_000) : null
  retention?.unref()

  if (!config.sync.enabled) {
    log.info('Scheduled sync is disabled (SYNC_ENABLED=false); daily cache retention still runs')
    return { stop() { if (retention) clearInterval(retention) } }
  }

  const tick = async (trigger) => {
    try {
      await sync.start({ trigger })
    } catch (error) {
      if (error instanceof SyncBusyError) log.debug('Scheduled sync skipped: another run holds the lock')
      else if (error.code === 'DROPBOX_NOT_CONNECTED') log.debug('Scheduled sync skipped: Dropbox not connected')
      else if (error.code === FOLDER_REQUIRED) log.debug('Scheduled sync skipped: no sync folder chosen')
      else log.warn('Scheduled sync could not start', { error: error.message })
    }
  }

  const everyMs = config.sync.intervalMinutes * 60_000
  let next = Date.now() + everyMs
  const timer = setInterval(() => {
    next = Date.now() + everyMs
    tick('schedule')
  }, everyMs)
  timer.unref()
  const startup = config.sync.onStartup ? setTimeout(() => tick('startup'), 5_000) : null
  startup?.unref()
  log.info('Scheduler running', { everyMinutes: config.sync.intervalMinutes, onStartup: config.sync.onStartup })

  return {
    nextRunAt: () => new Date(next).toISOString(),
    stop() {
      clearInterval(timer)
      if (retention) clearInterval(retention)
      if (startup) clearTimeout(startup)
    },
  }
}
