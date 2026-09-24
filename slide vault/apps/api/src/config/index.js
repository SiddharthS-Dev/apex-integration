/**
 * Configuration is read once, validated once, and frozen.
 *
 * Nothing else in the server reads process.env — that keeps "which knob exists"
 * answerable from one file, and makes startup fail loudly on a bad deployment
 * instead of failing later, halfway through a Dropbox call.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(HERE, '..', '..');

/** Minimal .env reader — no dependency, no interpolation, no surprises. */
export function loadDotEnv(file = path.join(SERVER_ROOT, '.env')) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    const quoted =
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"));
    if (quoted && value.length >= 2) value = value.slice(1, -1);
    out[key] = value;
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return out;
}

const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return /^(1|true|yes|on)$/i.test(String(value));
};

const int = (value, fallback) => {
  const n = Number.parseInt(value ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

const extList = (value, fallback) => {
  const parsed = String(value ?? '')
    .split(',')
    .map((s) => s.trim().replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  return parsed.length ? [...new Set(parsed)] : fallback;
};

/** Comma-separated list, lower-cased and de-duplicated. */
const csvLower = (value) => [
  ...new Set(
    String(value ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean)
  ),
];

const trimSlash = (value) => String(value ?? '').replace(/\/+$/, '');

/**
 * Builds the config object from an env bag (process.env by default).
 * Tests pass their own bag so no test depends on the developer's shell.
 */
export function buildConfig(env = process.env) {
  const nodeEnv = env.NODE_ENV || 'development';
  const isProduction = nodeEnv === 'production';
  const port = int(env.PORT, 4000);
  const apiBaseUrl = trimSlash(env.API_BASE_URL || `http://localhost:${port}`);

  const cfg = {
    nodeEnv,
    isProduction,
    port,
    logLevel: env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),

    /** Where the browser app lives — OAuth returns the admin here when it is done. */
    appBaseUrl: trimSlash(env.APP_BASE_URL || 'http://localhost:5173'),
    apiBaseUrl,
    corsOrigins: String(env.CORS_ORIGINS || env.APP_BASE_URL || 'http://localhost:5173')
      .split(',')
      .map((s) => trimSlash(s.trim()))
      .filter(Boolean),

    db: {
      driver: String(env.DB_DRIVER || 'sqlite').toLowerCase(),
      file: env.DB_FILE || path.join(SERVER_ROOT, 'data', 'slidesvault.db'),
      url: env.DATABASE_URL || '',
    },

    session: {
      cookieName: env.SESSION_COOKIE_NAME || 'sv_session',
      ttlHours: int(env.SESSION_TTL_HOURS, 12),
      secure: bool(env.SESSION_COOKIE_SECURE, isProduction),
      sameSite: env.SESSION_COOKIE_SAMESITE || 'lax',
    },

    bootstrapAdmin: {
      email: String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
      password: env.BOOTSTRAP_ADMIN_PASSWORD || '',
      name: env.BOOTSTRAP_ADMIN_NAME || 'Administrator',
    },

    /**
     * Google sign-in (OpenID Connect).
     *
     * Disabled unless GOOGLE_OAUTH_ENABLED is set, so an install that does not
     * want it never shows a button that cannot work.
     */
    google: {
      enabled: bool(env.GOOGLE_OAUTH_ENABLED, false),
      clientId: env.GOOGLE_CLIENT_ID || '',
      clientSecret: env.GOOGLE_CLIENT_SECRET || '',
      /** Must match a redirect URI registered in the Google Cloud console. */
      redirectUri: env.GOOGLE_REDIRECT_URI || `${apiBaseUrl}/api/auth/google/callback`,
      /** Email domains permitted to sign in. Empty means "no domain filter". */
      allowedDomains: csvLower(env.GOOGLE_ALLOWED_DOMAINS),
      /** Create an account on first successful Google sign-in. */
      autoCreateUsers: bool(env.GOOGLE_AUTO_CREATE_USERS, false),
      stateTtlMinutes: int(env.GOOGLE_OAUTH_STATE_TTL_MINUTES, 10),
    },

    dropbox: {
      appKey: env.DROPBOX_APP_KEY || '',
      appSecret: env.DROPBOX_APP_SECRET || '',
      /** Must match a redirect URI registered in the Dropbox App Console. */
      redirectUri: env.DROPBOX_REDIRECT_URI || `${apiBaseUrl}/api/dropbox/oauth/callback`,
      tokenEncryptionKey: env.DROPBOX_TOKEN_ENCRYPTION_KEY || '',
      maxRetries: int(env.DROPBOX_MAX_RETRIES, 5),
      requestTimeoutMs: int(env.DROPBOX_REQUEST_TIMEOUT_SECONDS, 30) * 1000,
      downloadTimeoutMs: int(env.DROPBOX_DOWNLOAD_TIMEOUT_SECONDS, 120) * 1000,
      backoffBaseMs: int(env.DROPBOX_BACKOFF_BASE_MS, 500),
      backoffCapMs: int(env.DROPBOX_BACKOFF_CAP_MS, 16000),
      oauthStateTtlMinutes: int(env.DROPBOX_OAUTH_STATE_TTL_MINUTES, 10),
      allowAdminDownload: bool(env.DROPBOX_ALLOW_ADMIN_DOWNLOAD, true),
      allowRename: bool(env.DROPBOX_ALLOW_RENAME, true),
    },

    sync: {
      enabled: bool(env.DROPBOX_SYNC_ENABLED, true),
      intervalMinutes: int(env.DROPBOX_SYNC_INTERVAL_MINUTES, 30),
      runOnStartup: bool(env.DROPBOX_SYNC_ON_STARTUP, false),
      maxConcurrentFiles: int(env.DROPBOX_MAX_CONCURRENT_FILES, 8),
      maxFileSizeBytes: int(env.DROPBOX_MAX_FILE_SIZE_MB, 150) * 1024 * 1024,
      supportedExtensions: extList(env.DROPBOX_SUPPORTED_EXTENSIONS, ['pdf', 'pptx', 'ppt', 'html']),
      /** A run that outlives this is assumed dead and its lock is reclaimed. */
      lockTtlMinutes: int(env.DROPBOX_SYNC_LOCK_TTL_MINUTES, 60),
    },

    ai: {
      enabled: bool(env.AI_ENABLED, true),
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.AI_MODEL || 'claude-opus-5',
      visionEnabled: bool(env.AI_VISION_ENABLED, true),
      maxTokens: int(env.AI_MAX_TOKENS, 1024),
      timeoutMs: int(env.AI_TIMEOUT_SECONDS, 60) * 1000,
    },

    objectStore: {
      dir: env.OBJECT_STORE_DIR || path.join(SERVER_ROOT, 'data', 'objects'),
      publicBase: env.OBJECT_PUBLIC_BASE || '/api/assets',
      /** Cached previews older than this are re-derived from Dropbox. */
      ttlHours: int(env.OBJECT_CACHE_TTL_HOURS, 24 * 14),
    },

    retention: {
      syncLogDays: int(env.RETENTION_SYNC_LOG_DAYS, 90),
      auditLogDays: int(env.RETENTION_AUDIT_LOG_DAYS, 365),
    },

    metricsEnabled: bool(env.METRICS_ENABLED, true),
    rateLimit: {
      windowMs: int(env.RATE_LIMIT_WINDOW_SECONDS, 60) * 1000,
      maxRequests: int(env.RATE_LIMIT_MAX_REQUESTS, 300),
      adminMaxRequests: int(env.RATE_LIMIT_ADMIN_MAX_REQUESTS, 120),
    },
  };

  // ":memory:" is a SQLite sentinel, not a path — resolving it would create a
  // file called ":memory:" and quietly give tests a persistent database.
  if (cfg.db.file !== ':memory:' && !path.isAbsolute(cfg.db.file)) {
    cfg.db.file = path.join(SERVER_ROOT, cfg.db.file);
  }
  cfg.objectStore.dir = path.isAbsolute(cfg.objectStore.dir)
    ? cfg.objectStore.dir
    : path.join(SERVER_ROOT, cfg.objectStore.dir);

  return Object.freeze(cfg);
}

/** Decodes an encryption key from hex or base64, or returns null if malformed. */
export function decodeKey(value) {
  if (!value) return null;
  try {
    const buf = Buffer.from(value, /^[0-9a-fA-F]{64}$/.test(value) ? 'hex' : 'base64');
    return buf.length === 32 ? buf : null;
  } catch {
    return null;
  }
}

/**
 * Startup validation, split into fatal problems (the process must not start)
 * and warnings (a degraded but usable server — e.g. Dropbox not yet configured
 * on a fresh install).
 */
export function validateConfig(cfg) {
  const errors = [];
  const warnings = [];

  if (!['sqlite', 'postgres'].includes(cfg.db.driver)) {
    errors.push(`DB_DRIVER must be "sqlite" or "postgres" (got "${cfg.db.driver}").`);
  }
  if (cfg.db.driver === 'postgres' && !cfg.db.url) {
    errors.push('DATABASE_URL is required when DB_DRIVER=postgres.');
  }

  if (!cfg.dropbox.tokenEncryptionKey) {
    errors.push(
      'DROPBOX_TOKEN_ENCRYPTION_KEY is required — refresh tokens are encrypted at rest. ' +
        'Generate one with: npm run keygen'
    );
  } else if (!decodeKey(cfg.dropbox.tokenEncryptionKey)) {
    errors.push('DROPBOX_TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes (AES-256-GCM).');
  }

  if (cfg.sync.maxConcurrentFiles < 1 || cfg.sync.maxConcurrentFiles > 64) {
    errors.push('DROPBOX_MAX_CONCURRENT_FILES must be between 1 and 64.');
  }
  if (cfg.dropbox.maxRetries < 1 || cfg.dropbox.maxRetries > 10) {
    errors.push('DROPBOX_MAX_RETRIES must be between 1 and 10.');
  }
  if (cfg.sync.intervalMinutes < 1) {
    errors.push('DROPBOX_SYNC_INTERVAL_MINUTES must be at least 1.');
  }

  /**
   * Auto-creation with no domain filter would let anyone holding any Google
   * account create themselves an account and read the whole library. That is a
   * one-character mistake with no visible symptom, so it stops the process
   * rather than producing a warning nobody reads.
   */
  if (cfg.google.enabled && cfg.google.autoCreateUsers && cfg.google.allowedDomains.length === 0) {
    errors.push(
      'GOOGLE_AUTO_CREATE_USERS=true requires GOOGLE_ALLOWED_DOMAINS — otherwise any Google ' +
        'account in the world could sign in and read the library. Set the domains you trust ' +
        '(e.g. GOOGLE_ALLOWED_DOMAINS=inspironics.net), or set GOOGLE_AUTO_CREATE_USERS=false ' +
        'so only accounts that already exist may use Google sign-in.'
    );
  }
  if (cfg.google.enabled && (!cfg.google.clientId || !cfg.google.clientSecret)) {
    warnings.push(
      'GOOGLE_OAUTH_ENABLED is true but GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set — ' +
        'Google sign-in will be advertised as unavailable until they are.'
    );
  }
  if (cfg.google.enabled && cfg.isProduction && !cfg.google.redirectUri.startsWith('https://')) {
    warnings.push('GOOGLE_REDIRECT_URI is not https — Google requires https outside localhost.');
  }

  if (!cfg.dropbox.appKey || !cfg.dropbox.appSecret) {
    warnings.push(
      'DROPBOX_APP_KEY / DROPBOX_APP_SECRET are not set — Dropbox endpoints will report a ' +
        'configuration error until they are.'
    );
  }
  if (cfg.isProduction && !cfg.dropbox.redirectUri.startsWith('https://')) {
    warnings.push('DROPBOX_REDIRECT_URI is not https — Dropbox requires https outside localhost.');
  }
  if (cfg.isProduction && !cfg.session.secure) {
    warnings.push('SESSION_COOKIE_SECURE is false in production — session cookies would travel over http.');
  }
  if (cfg.ai.enabled && !cfg.ai.apiKey) {
    warnings.push(
      'AI_ENABLED is true but ANTHROPIC_API_KEY is missing — title resolution falls back to ' +
        'deterministic extraction only.'
    );
  }

  return { errors, warnings };
}

let cached = null;

/** The process-wide config. Built on first use, never rebuilt. */
export function config() {
  if (!cached) {
    loadDotEnv();
    cached = buildConfig(process.env);
  }
  return cached;
}

/** Test seam: replaces the process-wide config. */
export function setConfig(cfg) {
  cached = cfg;
  return cached;
}
