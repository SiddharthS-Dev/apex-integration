/**
 * Runs the sync every SYNC_INTERVAL_MINUTES, and once at startup if
 * SYNC_ON_STARTUP is set. Every instance runs a scheduler; the sync's DB lock
 * makes all but one of them a no-op, so there is no leader to elect.
 */
import { SyncBusyError } from './pipeline.js'

export function startScheduler({ config, sync, log }) {
  if (!config.sync.enabled) {
    log.info('Scheduled sync is disabled (SYNC_ENABLED=false)')
    return { stop() {} }
  }

  const tick = async (trigger) => {
    try {
      await sync.start({ trigger })
    } catch (error) {
      if (error instanceof SyncBusyError) log.debug('Scheduled sync skipped: another run holds the lock')
      else if (error.code === 'DROPBOX_NOT_CONNECTED') log.debug('Scheduled sync skipped: Dropbox not connected')
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
      if (startup) clearTimeout(startup)
    },
  }
}
