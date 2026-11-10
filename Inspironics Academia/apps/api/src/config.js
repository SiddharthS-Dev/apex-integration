import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, '..');

const bool = (v, d = false) => (v === undefined || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));
const num = (v, d) => (v === undefined || v === '' || Number.isNaN(Number(v)) ? d : Number(v));
const optNum = (v) => num(v, null);

const AI_PROVIDERS = ['gemini', 'ollama', 'none'];
// Google Gemini is the default provider. Model codes as published at ai.google.dev (checked 2026-11-10):
// gemini-3.8-flash is Google's recommendation for new projects; gemini-3.8-flash-tts is its speech model.
export const DEFAULT_GEMINI_MODEL = 'gemini-3.8-flash';
export const DEFAULT_GEMINI_TTS_MODEL = 'gemini-3.8-flash-tts';
const aiProviderName = (v) => {
  const p = String(v || 'gemini').trim().toLowerCase();
  return AI_PROVIDERS.includes(p) ? p : 'none';
};
/** True when the provider has what it needs to make a call (a key, a model, a server URL). */
function aiProviderReady(p, e) {
  if (p === 'gemini') return !!e.GEMINI_API_KEY; // GEMINI_MODEL defaults to DEFAULT_GEMINI_MODEL
  if (p === 'ollama') return !!(e.OLLAMA_BASE_URL && e.OLLAMA_MODEL);
  return false;
}
export { AI_PROVIDERS, aiProviderReady };

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

  // AI text generation, always called from this server (keys never reach the browser).
  // AI_PROVIDER = gemini (default) | ollama | none. AI_FALLBACK_PROVIDER optionally names a
  // second one; unset means no fallback (a failed call reports its error, it is never re-sent elsewhere).
  aiProvider: aiProviderName(env.AI_PROVIDER),
  aiFallbackProvider: env.AI_FALLBACK_PROVIDER ? aiProviderName(env.AI_FALLBACK_PROVIDER) : '',
  aiEnabled: bool(env.AI_ENABLED, false) && aiProviderReady(aiProviderName(env.AI_PROVIDER), env),
  ai: {
    gemini: {
      apiKey: env.GEMINI_API_KEY || '',
      model: env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL,
      baseUrl: (env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, ''),
      timeoutMs: num(env.GEMINI_TIMEOUT_SECONDS, 300) * 1000,
      attempts: Math.min(8, Math.max(1, num(env.GEMINI_MAX_ATTEMPTS, 5))),
    },
    // Lessons generated at once by a course batch (each is one large request; keep it low for rate limits).
    batchConcurrency: Math.min(3, Math.max(1, num(env.AI_BATCH_CONCURRENCY, 1))),
    // When the provider is overloaded (503) or rate-limited, a batch waits this long and tries the lesson once more.
    batchRetryDelayMs: Math.max(0, num(env.AI_BATCH_RETRY_DELAY_SECONDS, 60)) * 1000,
    ollama: { baseUrl: (env.OLLAMA_BASE_URL || '').replace(/\/+$/, ''), model: env.OLLAMA_MODEL || '' },
    // Identical requests are answered from the cache (an explicit "regenerate" bypasses it).
    contentCache: bool(env.ENABLE_CONTENT_CACHE, true),
    // Optional price overrides (USD per million tokens) for providers without a built-in price table.
    priceInputPerMTok: optNum(env.AI_PRICE_INPUT_PER_MTOK),
    priceOutputPerMTok: optNum(env.AI_PRICE_OUTPUT_PER_MTOK),
  },

  // Voice-over (text to speech). MEDIA_PROVIDER = gemini | google | elevenlabs | piper | none
  // (gemini = Gemini speech generation with the same GEMINI_API_KEY; google = Google Cloud Text-to-Speech).
  // ('none' = no recorded narration; players read the script aloud with the browser's voice).
  mediaProvider: (env.MEDIA_PROVIDER || 'none').toLowerCase(),
  tts: {
    language: env.TTS_LANGUAGE || 'en-US',
    voice: env.TTS_VOICE || '',
    rate: optNum(env.TTS_SPEAKING_RATE) ?? 1,
    pitch: optNum(env.TTS_PITCH) ?? 0,
    audioCache: bool(env.ENABLE_AUDIO_CACHE, true),
    pricePerMillionChars: optNum(env.TTS_PRICE_PER_MILLION_CHARS),
    google: {
      apiKey: env.GOOGLE_TTS_API_KEY || '',
      credentialsFile: env.GOOGLE_APPLICATION_CREDENTIALS || '',
      projectId: env.GOOGLE_CLOUD_PROJECT_ID || '',
    },
    gemini: {
      model: env.GEMINI_TTS_MODEL || DEFAULT_GEMINI_TTS_MODEL,
      voice: env.GEMINI_TTS_VOICE || 'Kore',
      // Delivery direction sent with the text (Gemini speech style); set it empty to send none.
      style: env.GEMINI_TTS_STYLE ?? 'clear, warm and encouraging, at a steady teaching pace',
      // Wait before retrying after a speech rate limit (429), multiplied by the attempt (30 s, 60 s, 90 s).
      rateLimitWaitMs: Math.max(0, num(env.GEMINI_TTS_RATE_LIMIT_WAIT_SECONDS, 30)) * 1000,
    },
    elevenlabs: { apiKey: env.ELEVENLABS_API_KEY || '', voiceId: env.ELEVENLABS_VOICE_ID || '', model: env.ELEVENLABS_MODEL || '' },
    piper: { executable: env.PIPER_EXECUTABLE_PATH || '', model: env.PIPER_MODEL_PATH || '' },
  },

  // Video rendering (template-based MP4 from slides + narration + subtitles).
  video: {
    provider: (env.VIDEO_PROVIDER || 'ffmpeg').toLowerCase(),
    ffmpegPath: env.FFMPEG_PATH || '',
    width: num(env.VIDEO_WIDTH, 1280),
    height: num(env.VIDEO_HEIGHT, 720),
    fps: num(env.VIDEO_FPS, 25),
    sceneCache: bool(env.ENABLE_SCENE_REGENERATION, true),
  },

  // What happens without being asked. Off by default: paid generation runs only on an explicit action.
  autoGenerateAudio: bool(env.AUTO_GENERATE_AUDIO, false),
  syncAiExtract: bool(env.SYNC_AI_EXTRACT, false),
  syncAiMeetings: bool(env.SYNC_AI_MEETINGS, false),

  // Usage limits (empty = no limit). Admins can change them in AI Studio; these are the defaults.
  limits: {
    aiDailyRequests: optNum(env.AI_DAILY_LIMIT),
    aiMonthlyBudgetUsd: optNum(env.AI_MONTHLY_BUDGET),
    ttsMonthlyChars: optNum(env.TTS_MONTHLY_CHARACTER_LIMIT),
    videoMonthlyMinutes: optNum(env.VIDEO_MONTHLY_RENDER_LIMIT),
  },
  maxConcurrentJobs: Math.max(1, num(env.MAX_CONCURRENT_JOBS, 1)),

  // Storage policy. Dropbox is the primary store for original documents: APEX keeps their metadata and
  // fetches the bytes only when a step needs them. DROPBOX_SOURCE_CACHE=temporary (default) keeps no
  // local copy; permanent keeps one per revision (the old behaviour; faster re-extraction, more disk).
  storage: {
    dropboxSourceCache: (env.DROPBOX_SOURCE_CACHE || 'temporary').toLowerCase() === 'permanent' ? 'permanent' : 'temporary',
    tempDir: env.TEMP_PROCESSING_DIR ? path.resolve(apiRoot, env.TEMP_PROCESSING_DIR) : path.join(os.tmpdir(), 'apex-academia'),
    tempMaxAgeHours: num(env.TEMP_MAX_AGE_HOURS, 6),
    // Retention for regenerable caches (days; 0 = keep). Referenced media is never deleted by these.
    aiCacheDays: num(env.AI_CACHE_RETENTION_DAYS, 90),
    ttsCacheDays: num(env.TTS_CACHE_RETENTION_DAYS, 180),
    sceneCacheDays: num(env.SCENE_CACHE_RETENTION_DAYS, 30),
    extractCacheDays: num(env.EXTRACT_CACHE_RETENTION_DAYS, 90),
    // Daily automatic clean-up of the safe categories (off: run it from AI Studio → Storage).
    autoCleanup: bool(env.STORAGE_AUTO_CLEANUP, false),
    // Where rendered videos go: apex (the media store) or dropbox (uploaded to DROPBOX_OUTPUT_FOLDER).
    videoOutput: (env.VIDEO_OUTPUT_DESTINATION || 'apex').toLowerCase() === 'dropbox' ? 'dropbox' : 'apex',
    dropboxOutputFolder: env.DROPBOX_OUTPUT_FOLDER || '/APEX Generated Videos',
    // With Dropbox output: also keep the MP4 in APEX (off = stream it back from Dropbox, saving disk).
    keepLocalCopy: bool(env.VIDEO_KEEP_LOCAL_COPY, true),
  },
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
