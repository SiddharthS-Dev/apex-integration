/**
 * Composition root: construct every service once, in dependency order.
 * server.js calls this for real; tests call it with overrides (an in-memory
 * database, a fake fetch for Dropbox, a stub enricher).
 */
import { createEnricher } from './ai/enricher.js'
import { resolveEncryptionKeys } from './lib/crypto.js'
import { createMetrics } from './lib/metrics.js'
import { openDatabase } from './db/index.js'
import { migrate } from './db/migrate.js'
import { createDropboxAuth } from './dropbox/auth.js'
import { createDropboxClient } from './dropbox/client.js'
import { createCodesRepo, createLoginHistoryRepo, createSessionsRepo, createUsersRepo } from './repos/auth.js'
import { createEventsRepo, createFilesRepo, createSyncLogRepo } from './repos/files.js'
import { createDropboxConnectionRepo, createOAuthStateRepo, createSettingsRepo } from './repos/settings.js'
import { createObjectStore } from './storage/objectStore.js'
import { createSyncService } from './sync/pipeline.js'
import { startScheduler } from './sync/scheduler.js'
import { loadSeeds } from './sync/seeds.js'

export function createRepos(db) {
  return {
    db,
    users: createUsersRepo(db),
    sessions: createSessionsRepo(db),
    codes: createCodesRepo(db),
    loginHistory: createLoginHistoryRepo(db),
    settings: createSettingsRepo(db),
    dropbox: createDropboxConnectionRepo(db),
    oauthStates: createOAuthStateRepo(db),
    files: createFilesRepo(db),
    syncLog: createSyncLogRepo(db),
    events: createEventsRepo(db),
  }
}

export async function createServices(config, log, overrides = {}) {
  const metrics = overrides.metrics || createMetrics()
  const db = overrides.db || (await openDatabase(config, log))
  await migrate(db, log)
  const repos = createRepos(db)
  // [current, ...ENCRYPTION_KEY_PREVIOUS]: encrypt uses the first, decrypt tries each in turn
  const key = overrides.key || resolveEncryptionKeys(config, log)
  const fetchImpl = overrides.fetch || fetch

  const dropboxAuth = createDropboxAuth({ config, repos, key, log, metrics, fetchImpl })
  const dropbox = createDropboxClient({ auth: dropboxAuth, log, metrics, fetchImpl })
  const store = createObjectStore(config.objectStoreDir)
  const enricher = overrides.enricher || createEnricher({ config, log, metrics })
  const seeds = overrides.seeds || loadSeeds(config.sync.seedPath, log)
  const sync = createSyncService({ config, repos, dropbox, dropboxAuth, store, enricher, seeds, log, metrics })
  const scheduler = overrides.scheduler || startScheduler({ config, sync, store, log })

  return { config, log, metrics, db, repos, key, dropboxAuth, dropbox, store, enricher, seeds, sync, scheduler }
}

/**
 * The hourly housekeeping: expired sessions, plus the opt-in retention windows
 * (LOGIN_HISTORY_RETENTION_DAYS, PLATE_EVENTS_RETENTION_DAYS; 0 = keep). Returns what was removed.
 */
export async function housekeep(repos, config, log) {
  const removed = { sessions: 0, loginHistory: 0, plateEvents: 0 }
  await repos.sessions.purgeExpired()
  const { loginHistoryDays = 0, plateEventsDays = 0 } = config.retention || {}
  if (loginHistoryDays > 0) removed.loginHistory = await repos.loginHistory.purgeOlderThan(loginHistoryDays)
  if (plateEventsDays > 0) removed.plateEvents = await repos.events.purgeOlderThan(plateEventsDays)
  if (removed.loginHistory || removed.plateEvents) log?.info?.('Retention purge', removed)
  return removed
}
