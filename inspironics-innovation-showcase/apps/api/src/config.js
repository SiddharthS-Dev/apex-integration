/**
 * Every environment variable the API reads, parsed once, in one place.
 *
 * Nothing else touches `process.env`. The shape of `loadConfig()`'s result is
 * exactly the set of things a deployment can change, and `problems` lists what
 * is wrong with it so the server can refuse to start in production rather than
 * fail on the first request that needs the missing value.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const API_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const str = (v, fallback = '') => (typeof v === 'string' && v.trim() ? v.trim() : fallback)
const bool = (v, fallback) => {
  const s = str(v).toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'off'].includes(s)) return false
  return fallback
}
const int = (v, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const n = Number.parseInt(str(v), 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}
const url = (v, fallback = '') => {
  const s = str(v, fallback)
  if (!s) return ''
  try {
    return new URL(s).toString().replace(/\/$/, '')
  } catch {
    return ''
  }
}
const fromRoot = (p) => (path.isAbsolute(p) ? p : path.join(API_ROOT, p))

/** Load `apps/api/.env` if present. Real environment variables win. */
export function loadDotEnv(file = path.join(API_ROOT, '.env')) {
  if (existsSync(file)) process.loadEnvFile(file)
}

export function loadConfig(env = process.env) {
  const nodeEnv = str(env.NODE_ENV, 'development')
  const isProd = nodeEnv === 'production'
  const port = int(env.PORT, 4100, { min: 1, max: 65535 })
  const publicUrl = url(env.PUBLIC_API_URL, `http://localhost:${port}`)
  const webOrigin = url(env.WEB_ORIGIN, isProd ? publicUrl : 'http://localhost:5180')

  const config = {
    nodeEnv,
    isProd,
    isTest: nodeEnv === 'test',
    port,
    host: str(env.HOST, '0.0.0.0'),
    publicUrl,
    /** Origins allowed to make credentialed, state-changing requests. */
    allowedOrigins: [...new Set([publicUrl, webOrigin, ...str(env.EXTRA_ORIGINS).split(',').map((s) => url(s)).filter(Boolean)])],
    webOrigin,
    trustProxy: bool(env.TRUST_PROXY, false),
    /** Serve apps/web/dist from this process, making the whole product one origin. */
    serveWeb: bool(env.SERVE_WEB, isProd),
    webDist: fromRoot(str(env.WEB_DIST, '../web/dist')),
    logLevel: str(env.LOG_LEVEL, isProd ? 'info' : 'debug'),

    db: {
      url: str(env.DATABASE_URL),
      sqlitePath: fromRoot(str(env.SQLITE_PATH, 'data/app.db')),
    },
    objectStoreDir: fromRoot(str(env.OBJECT_STORE_DIR, 'data/objects')),

    /** 32 bytes, hex or base64. Encrypts the Dropbox refresh token at rest. */
    encryptionKey: str(env.ENCRYPTION_KEY),
    devKeyFile: fromRoot('data/.dev-encryption-key'),

    auth: {
      cookieName: str(env.SESSION_COOKIE, 'insp_session'),
      sessionHours: int(env.SESSION_TTL_HOURS, 12, { min: 1, max: 24 * 30 }),
      cookieSecure: bool(env.COOKIE_SECURE, publicUrl.startsWith('https://')),
      allowRegistration: bool(env.ALLOW_REGISTRATION, true),
      guestEnabled: bool(env.GUEST_ENABLED, true),
      /** Registration/reset codes are returned in the response instead of mailed. Never in production. */
      exposeDevCodes: !isProd && bool(env.EXPOSE_DEV_CODES, true),
      googleClientId: str(env.GOOGLE_CLIENT_ID),
      bootstrapAdminEmail: str(env.BOOTSTRAP_ADMIN_EMAIL).toLowerCase(),
      bootstrapAdminPassword: str(env.BOOTSTRAP_ADMIN_PASSWORD),
      otpTtlMinutes: 10,
      resetTtlMinutes: 15,
      maxCodeAttempts: 5,
    },

    dropbox: {
      appKey: str(env.DROPBOX_APP_KEY),
      appSecret: str(env.DROPBOX_APP_SECRET),
      /** Must be registered character-for-character in the Dropbox App Console. */
      redirectUri: url(env.DROPBOX_REDIRECT_URI, `${publicUrl}/api/dropbox/oauth/callback`),
      /** Default sync folder; an admin can override it in Settings. '' is the root. */
      rootPath: normaliseDropboxPath(str(env.DROPBOX_ROOT_PATH)),
    },

    sync: {
      enabled: bool(env.SYNC_ENABLED, true),
      intervalMinutes: int(env.SYNC_INTERVAL_MINUTES, 30, { min: 1 }),
      onStartup: bool(env.SYNC_ON_STARTUP, false),
      concurrency: int(env.SYNC_CONCURRENCY, 8, { min: 1, max: 32 }),
      maxExtractMb: int(env.MAX_EXTRACT_MB, 150, { min: 1 }),
      /** Lock lease; renewed by a heartbeat while a run is alive. */
      lockTtlSeconds: int(env.SYNC_LOCK_TTL_SECONDS, 120, { min: 30 }),
      seedPath: fromRoot(str(env.SEED_PATH, '../web/public/data/showcase.json')),
    },

    ai: {
      enabled: bool(env.AI_ENABLED, false) && !!str(env.ANTHROPIC_API_KEY),
      requested: bool(env.AI_ENABLED, false),
      apiKey: str(env.ANTHROPIC_API_KEY),
      model: str(env.AI_MODEL, 'claude-opus-5'),
    },
  }

  config.problems = validate(config)
  return config
}

/** Dropbox paths are '' for the root, otherwise '/lower/or/Mixed' with no trailing slash. */
export function normaliseDropboxPath(p) {
  const s = String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '')
  if (!s || s === '/') return ''
  return s.startsWith('/') ? s : `/${s}`
}

function validate(c) {
  const problems = []
  const need = (cond, level, message) => cond || problems.push({ level, message })

  need(!c.isProd || c.encryptionKey, 'error', 'ENCRYPTION_KEY is required in production (32 bytes, hex or base64).')
  need(!c.isProd || c.db.url, 'warn', 'DATABASE_URL is not set — production is running on SQLite.')
  need(!c.isProd || c.auth.cookieSecure, 'error', 'Session cookies must be Secure in production — serve PUBLIC_API_URL over https.')
  need(c.dropbox.appKey && c.dropbox.appSecret, 'warn', 'DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set — Dropbox cannot be connected.')
  need(!c.ai.requested || c.ai.apiKey, 'warn', 'AI_ENABLED is true but ANTHROPIC_API_KEY is empty — AI stays off.')
  need(!c.isProd || c.publicUrl.startsWith('https://') || c.publicUrl.includes('localhost'), 'warn', 'PUBLIC_API_URL is not https.')
  return problems
}
