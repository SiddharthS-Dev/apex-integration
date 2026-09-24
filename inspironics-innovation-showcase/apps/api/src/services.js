/**
 * Composition root: construct every service once, in dependency order.
 * server.js calls this for real; tests call it with overrides (an in-memory
 * database, a fake fetch for Dropbox, a stub enricher).
 */
import { createEnricher } from './ai/enricher.js'
import { resolveEncryptionKey } from './lib/crypto.js'
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
  const key = overrides.key || resolveEncryptionKey(config, log)
  const fetchImpl = overrides.fetch || fetch

  const dropboxAuth = createDropboxAuth({ config, repos, key, log, metrics, fetchImpl })
  const dropbox = createDropboxClient({ auth: dropboxAuth, log, metrics, fetchImpl })
  const store = createObjectStore(config.objectStoreDir)
  const enricher = overrides.enricher || createEnricher({ config, log, metrics })
  const seeds = overrides.seeds || loadSeeds(config.sync.seedPath, log)
  const sync = createSyncService({ config, repos, dropbox, dropboxAuth, store, enricher, seeds, log, metrics })
  const scheduler = overrides.scheduler || startScheduler({ config, sync, log })

  return { config, log, metrics, db, repos, key, dropboxAuth, dropbox, store, enricher, seeds, sync, scheduler }
}
