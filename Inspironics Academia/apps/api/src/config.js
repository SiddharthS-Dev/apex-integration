import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));

const env = process.env;
const dataDir = path.resolve(apiRoot, env.DATA_DIR || 'data');

// Where the web app lives, path included. Standalone that is just APP_ORIGIN; under the Apex gateway
// it is mounted below the origin (APP_BASE_URL=http://localhost:5173/academia), and every link the
// API sends a browser to — the Dropbox OAuth return, password-reset links — must carry that mount.
const appBaseUrl = (env.APP_BASE_URL || env.APP_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '');

export const config = Object.freeze({
  env: env.NODE_ENV || 'development',
  isProduction: env.NODE_ENV === 'production',
  port: num(env.PORT, 4000),
  // The interface to listen on. Unset means Node's default — every interface, IPv4 and IPv6 alike
  // (standalone, docker; the dev proxy's "localhost" may resolve to ::1, which a '0.0.0.0' bind would
  // miss). The Apex gateway passes HOST=127.0.0.1 so the API is reachable only through it.
  host: env.HOST || undefined,
  appOrigin: new URL(appBaseUrl).origin,
  appBaseUrl,
  apiOrigin: env.API_ORIGIN || `http://localhost:${num(env.PORT, 4000)}`,
  dataDir,
  objectDir: path.join(dataDir, 'objects'),

  // Storage: Postgres when DATABASE_URL is set, otherwise SQLite (node:sqlite) at SQLITE_PATH.
  databaseUrl: env.DATABASE_URL || '',
  sqlitePath: env.SQLITE_PATH ? path.resolve(apiRoot, env.SQLITE_PATH) : path.join(dataDir, 'academy.db'),

  // Auth
  sessionTtlHours: num(env.SESSION_TTL_HOURS, 12),
  cookieSecure: bool(env.COOKIE_SECURE, env.NODE_ENV === 'production'),
  allowRegistration: bool(env.ALLOW_REGISTRATION, true),
  bootstrapAdminEmail: (env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase(),
  // With a password too, the admin is created at startup instead of by registering (see server.js).
  bootstrapAdminPassword: env.BOOTSTRAP_ADMIN_PASSWORD || '',
  bootstrapAdminName: env.BOOTSTRAP_ADMIN_NAME || 'Administrator',

  // Secrets at rest (Dropbox refresh token). 32 bytes, base64 or hex.
  tokenEncryptionKey: env.TOKEN_ENCRYPTION_KEY || '',

  // AI. AI_PROVIDER=anthropic (Claude via @anthropic-ai/sdk) or base44 (the Base44 app's built-in
  // InvokeLLM, called anonymously when the app allows it, else as a signed-in Base44 user — billed to the Base44 plan's integration credits).
  aiProvider: (env.AI_PROVIDER || 'anthropic').toLowerCase(),
  aiEnabled: bool(env.AI_ENABLED, false) && ((env.AI_PROVIDER || 'anthropic').toLowerCase() === 'base44'
    ? !!env.BASE44_APP_ID
    : !!(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN)),
  anthropicModel: env.ANTHROPIC_MODEL || 'claude-opus-5',
  base44: {
    serverUrl: (env.BASE44_SERVER_URL || 'https://base44.app').replace(/\/+$/, ''),
    appId: env.BASE44_APP_ID || '',
    email: env.BASE44_EMAIL || '',
    password: env.BASE44_PASSWORD || '',
    model: env.BASE44_MODEL || '', // empty = the Base44 app's own model setting
  },

  // Lesson media (video + narration). 'none' = placeholder + browser narration.
  mediaProvider: (env.MEDIA_PROVIDER || 'none').toLowerCase(),
  // Scenes per lesson video: each is one generated clip shown for its slice of the narration.
  mediaMaxScenes: Math.min(12, Math.max(1, num(env.MEDIA_MAX_SCENES, 8))),
  // Each scene is an explainer slide (heading, key points, subtitles) drawn by the player from the
  // lesson's own words. A text-to-video model cannot draw the lesson's content — it may not even write
  // a label — so its clips came out generic. They are opt-in, shown only as a muted backdrop.
  mediaSceneClips: bool(env.MEDIA_SCENE_CLIPS, false),

  // Dropbox
  dropbox: {
    appKey: env.DROPBOX_APP_KEY || '',
    appSecret: env.DROPBOX_APP_SECRET || '',
    redirectUri: env.DROPBOX_REDIRECT_URI || `http://localhost:${num(env.PORT, 4000)}/api/dropbox/oauth/callback`,
    defaultRoot: env.DROPBOX_SYNC_ROOT || '',
    // Meeting transcripts can come through a Dropbox app of their own (its own key, secret and
    // connection). Unset → meetings use the playbooks connection above.
    meetings: {
      appKey: env.DROPBOX_MEETINGS_APP_KEY || '',
      appSecret: env.DROPBOX_MEETINGS_APP_SECRET || '',
      redirectUri: env.DROPBOX_MEETINGS_REDIRECT_URI
        || (env.DROPBOX_REDIRECT_URI || `http://localhost:${num(env.PORT, 4000)}/api/dropbox/oauth/callback`).replace(/\/dropbox\/oauth\/callback$/, '/dropbox/meetings/oauth/callback'),
    },
    // Category sources: a playbook category (e.g. learning) with a Dropbox folder of its own, read
    // through its own app when DROPBOX_<CATEGORY>_APP_KEY/_APP_SECRET are set (else the main app).
    // Its redirect URI is …/dropbox/sources/<category>/oauth/callback.
    sources: categorySources(env),
  },

  // Sync scheduler
  syncIntervalMinutes: num(env.SYNC_INTERVAL_MINUTES, 30),
  syncOnStartup: bool(env.SYNC_ON_STARTUP, false),
  syncConcurrency: num(env.SYNC_CONCURRENCY, 4),
  autoExtractOnSync: bool(env.AUTO_EXTRACT_ON_SYNC, true),

  // Content limits
  maxExtractMb: num(env.MAX_EXTRACT_MB, 500),
  maxUploadMb: num(env.MAX_UPLOAD_MB, 50),

  // Email. EMAIL_PROVIDER=log (default: written to the server log, nothing leaves the box),
  // resend (RESEND_API_KEY) or smtp (SMTP_URL; needs the optional nodemailer package).
  email: {
    provider: (env.EMAIL_PROVIDER || 'log').toLowerCase(),
    from: env.EMAIL_FROM || 'Inspironics Academia <academia@localhost>',
    resendApiKey: env.RESEND_API_KEY || '',
    smtpUrl: env.SMTP_URL || '',
    maxAttempts: Math.max(1, num(env.EMAIL_MAX_ATTEMPTS, 5)),
  },

  // Daily jobs (review reminders, certificate expiry, recertification reminders) run once a day at
  // this UTC hour; the check itself is hourly, and dedupe keys keep it to one notice per thing.
  jobsHourUtc: Math.min(23, Math.max(0, num(env.JOBS_HOUR_UTC, 3))),
  jobsEnabled: bool(env.JOBS_ENABLED, true),
});

function categorySources(env) {
  const base = env.DROPBOX_REDIRECT_URI || `http://localhost:${num(env.PORT, 4000)}/api/dropbox/oauth/callback`;
  const keys = new Set(['learning', 'strategic']);
  for (const name of Object.keys(env)) {
    const m = name.match(/^DROPBOX_([A-Z][A-Z0-9]*)_APP_KEY$/);
    if (m && m[1] !== 'MEETINGS') keys.add(m[1].toLowerCase());
  }
  return Object.fromEntries([...keys].map((key) => {
    const K = key.toUpperCase();
    return [key, {
      appKey: env[`DROPBOX_${K}_APP_KEY`] || '',
      appSecret: env[`DROPBOX_${K}_APP_SECRET`] || '',
      // DROPBOX_<CATEGORY>_ACCESS=full: a Full Dropbox app, so a folder must always be chosen.
      fullAccess: /^full/i.test(env[`DROPBOX_${K}_ACCESS`] || ''),
      redirectUri:env[`DROPBOX_${K}_REDIRECT_URI`] || base.replace(/\/dropbox\/oauth\/callback$/, `/dropbox/sources/${key}/oauth/callback`),
    }];
  }));
}

export function dropboxConfigured() {
  return !!(config.dropbox.appKey && config.dropbox.appSecret && config.tokenEncryptionKey);
}
