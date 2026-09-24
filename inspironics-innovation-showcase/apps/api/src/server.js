/**
 * Entry point: config -> services -> HTTP server, and a clean shutdown.
 */
import { ROLES } from '@inspironics/shared'
import { createApp } from './app.js'
import { loadConfig, loadDotEnv } from './config.js'
import { hashPassword } from './lib/crypto.js'
import { createLogger } from './lib/log.js'
import { createServices } from './services.js'

loadDotEnv()
const config = loadConfig()
const log = createLogger({ level: config.logLevel, json: config.isProd })

for (const p of config.problems) log[p.level === 'error' ? 'error' : 'warn'](p.message)
if (config.isProd && config.problems.some((p) => p.level === 'error')) {
  log.error('Refusing to start with configuration errors.')
  process.exit(1)
}

const services = await createServices(config, log)
const { repos, sync, scheduler } = services

await repos.syncLog.failAbandoned()
await repos.sessions.purgeExpired()
await bootstrapAdmin()

const app = createApp(services)
const server = app.listen(config.port, config.host, () => {
  log.info(`API listening on ${config.publicUrl}`, {
    env: config.nodeEnv,
    dropbox: services.dropboxAuth.configured() ? 'configured' : 'not configured',
    ai: config.ai.enabled ? config.ai.model : 'off',
  })
})

// `node --watch` on Windows can start the new process a moment before the old
// one has let go of the port, so in development give it a few seconds
let bindAttempts = 0
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && !config.isProd && ++bindAttempts <= 20) {
    setTimeout(() => server.listen(config.port, config.host), 500)
    return
  }
  if (error.code === 'EADDRINUSE') {
    log.error(`Port ${config.port} is already in use — stop the other process (stop.bat) or set PORT in apps/api/.env.`)
  } else log.error('HTTP server error', { error })
  process.exit(1)
})

const housekeeping = setInterval(() => repos.sessions.purgeExpired().catch(() => {}), 3600_000)
housekeeping.unref()

let closing = false
async function shutdown(signal) {
  if (closing) return
  closing = true
  log.info(`Shutting down (${signal})`)
  scheduler.stop()
  sync.stop()
  server.close()
  // give an in-flight sync a moment to finish its current files and record itself
  const deadline = Date.now() + 15_000
  while (sync.progress() && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250))
  await services.db.close().catch(() => {})
  process.exit(0)
}
process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('unhandledRejection', (error) => log.error('Unhandled rejection', { error }))

/** Create or promote the BOOTSTRAP_ADMIN_EMAIL account, so a fresh deploy has an administrator. */
async function bootstrapAdmin() {
  const { bootstrapAdminEmail: email, bootstrapAdminPassword: password } = config.auth
  if (!email) return
  const existing = await repos.users.findByEmail(email)
  if (existing) {
    if (existing.role !== ROLES.ADMIN) {
      await repos.users.update(existing.id, { role: ROLES.ADMIN, verified: true })
      log.info('Promoted bootstrap administrator', { email })
    }
    return
  }
  if (!password) {
    log.warn('BOOTSTRAP_ADMIN_EMAIL is set but BOOTSTRAP_ADMIN_PASSWORD is empty; no admin created.')
    return
  }
  await repos.users.create({ email, name: email.split('@')[0], passwordHash: await hashPassword(password), role: ROLES.ADMIN, verified: true })
  log.info('Created bootstrap administrator', { email })
}
