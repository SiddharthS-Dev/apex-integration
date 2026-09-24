/**
 * The composition root.
 *
 * Every dependency is wired here and nowhere else — no service reaches for a
 * singleton, opens a database handle, or reads an environment variable on its
 * own. That is what makes the whole stack testable: a test builds a container
 * with an in-memory database and a stubbed fetch, and every layer above is
 * exercised unchanged.
 *
 * It is also where the provider swap happens. `container.provider` is a
 * StorageProvider; replacing DropboxStorageProvider with a OneDrive or S3 one
 * is an edit to this file, not to the sync engine.
 */
import { TokenCipher } from './crypto/tokenCipher.js';
import { createLogger } from './util/logger.js';
import { Metrics } from './services/metrics/metrics.js';

import { ConnectionRepository } from './db/repositories/connectionRepository.js';
import { OAuthStateRepository } from './db/repositories/oauthStateRepository.js';
import { StoredFileRepository } from './db/repositories/storedFileRepository.js';
import { SyncLogRepository } from './db/repositories/syncLogRepository.js';
import { AuditLogRepository } from './db/repositories/auditLogRepository.js';
import { LockRepository } from './db/repositories/lockRepository.js';
import { AnalyticsRepository } from './db/repositories/analyticsRepository.js';
import {
  LoginHistoryRepository,
  SessionRepository,
  UserRepository,
  ROLES,
} from './db/repositories/userRepository.js';

import { DropboxAuthService } from './integrations/dropbox/DropboxAuthService.js';
import { DropboxRequestExecutor } from './integrations/dropbox/DropboxRequestExecutor.js';
import { DropboxClient } from './integrations/dropbox/DropboxClient.js';
import { DropboxStorageProvider } from './integrations/dropbox/DropboxStorageProvider.js';
import { DropboxFolderService } from './integrations/dropbox/DropboxFolderService.js';
import { DropboxSyncService } from './integrations/dropbox/DropboxSyncService.js';
import { DropboxThumbnailService } from './integrations/dropbox/DropboxThumbnailService.js';
import { DropboxRenameService } from './integrations/dropbox/DropboxRenameService.js';
import { DropboxHealthService } from './integrations/dropbox/DropboxHealthService.js';
import { AdminDownloadService, DropboxContentService } from './integrations/dropbox/DropboxContentService.js';

import { ContentExtractionService } from './services/content-extraction/ContentExtractionService.js';
import { TitleResolver } from './services/title-resolution/TitleResolver.js';
import { DocumentAnalysisService } from './services/document-analysis/DocumentAnalysisService.js';
import { AnthropicProvider } from './services/document-analysis/AnthropicProvider.js';
import { NullAiProvider } from './services/document-analysis/AiProvider.js';
import { AuditService } from './services/audit/AuditService.js';
import { GoogleAuthService } from './services/auth/GoogleAuthService.js';
import { ObjectStore } from './services/storage/ObjectStore.js';
import { SyncScheduler } from './services/scheduler/SyncScheduler.js';

/**
 * @param {object} options
 * @param {object} options.config
 * @param {import('./db/index.js').Database} options.db
 * @param {typeof fetch} [options.fetchImpl] test seam for the Dropbox transport
 * @param {object} [options.aiProvider] test seam for the AI layer
 */
export function createContainer({ config, db, logger, metrics, fetchImpl = fetch, aiProvider } = {}) {
  const log = logger ?? createLogger({ level: config.logLevel });
  const meter = metrics ?? new Metrics();

  /* ------------------------------------------------------- persistence */
  const cipher = new TokenCipher(config.dropbox.tokenEncryptionKey);
  const connections = new ConnectionRepository(db, cipher);
  const oauthStates = new OAuthStateRepository(db);
  const files = new StoredFileRepository(db);
  const syncLogs = new SyncLogRepository(db);
  const auditRepository = new AuditLogRepository(db);
  const locks = new LockRepository(db);
  const analytics = new AnalyticsRepository(db);
  const users = new UserRepository(db);
  const sessions = new SessionRepository(db);
  const loginHistory = new LoginHistoryRepository(db);

  const audit = new AuditService({ repository: auditRepository, logger: log });
  const objectStore = new ObjectStore({
    dir: config.objectStore.dir,
    publicBase: config.objectStore.publicBase,
    logger: log,
  });

  /* ------------------------------------------------------ google sign-in */
  const googleAuth = new GoogleAuthService({
    config,
    oauthStates,
    users,
    sessions,
    loginHistory,
    audit,
    logger: log,
    fetchImpl,
  });

  /* ------------------------------------------------ dropbox integration */
  const auth = new DropboxAuthService({
    config,
    connections,
    oauthStates,
    locks,
    audit,
    metrics: meter,
    logger: log,
    fetchImpl,
  });

  const executor = new DropboxRequestExecutor({ config, auth, metrics: meter, logger: log, fetchImpl });
  const client = new DropboxClient({ executor, logger: log });
  const provider = new DropboxStorageProvider({ client, logger: log });

  /* ------------------------------------------------------- AI + content */
  const ai =
    aiProvider ??
    (config.ai.enabled && config.ai.apiKey
      ? new AnthropicProvider({
          apiKey: config.ai.apiKey,
          model: config.ai.model,
          maxTokens: config.ai.maxTokens,
          timeoutMs: config.ai.timeoutMs,
          logger: log,
          metrics: meter,
        })
      : new NullAiProvider(config.ai.enabled ? 'ANTHROPIC_API_KEY is not set.' : 'AI is disabled.'));

  const extraction = new ContentExtractionService({ logger: log });
  const titleResolver = new TitleResolver({
    ai,
    logger: log,
    metrics: meter,
    visionEnabled: config.ai.visionEnabled,
  });
  const analysis = new DocumentAnalysisService({ ai, logger: log });

  /* ---------------------------------------------------------- services */
  const thumbnails = new DropboxThumbnailService({ provider, objectStore, metrics: meter, logger: log });
  const folders = new DropboxFolderService({ provider, connections, audit, logger: log });

  const sync = new DropboxSyncService({
    config,
    provider,
    connections,
    files,
    syncLogs,
    locks,
    audit,
    metrics: meter,
    logger: log,
    extraction,
    titleResolver,
    analysis,
    thumbnails,
  });

  const content = new DropboxContentService({
    config,
    provider,
    files,
    objectStore,
    metrics: meter,
    logger: log,
    audit,
  });

  const adminDownload = new AdminDownloadService({ config, provider, files, audit, logger: log });

  const rename = new DropboxRenameService({
    config,
    provider,
    files,
    audit,
    metrics: meter,
    logger: log,
    titleResolver,
    extraction,
    thumbnails,
  }).withLocks(locks);

  const health = new DropboxHealthService({
    config,
    provider,
    auth,
    connections,
    syncLogs,
    files,
    locks,
    audit,
    logger: log,
  });

  /** Retention sweep — everything with a bounded lifetime, in one place (§78). */
  const retention = async () => {
    const results = {
      oauth: await oauthStates.purgeExpired(),
      sessions: await sessions.purgeExpired(),
      syncLogs: await syncLogs.purgeOlderThan(config.retention.syncLogDays),
      auditLogs: await auditRepository.purgeOlderThan(config.retention.auditLogDays),
      cachedObjects: await objectStore.purgeOlderThan(config.objectStore.ttlHours),
    };
    log.info('Retention sweep complete', results);
    return results;
  };

  const scheduler = new SyncScheduler({ config, sync, connections, logger: log, retention });

  return {
    config,
    db,
    logger: log,
    metrics: meter,
    cipher,

    connections,
    oauthStates,
    files,
    syncLogs,
    auditRepository,
    locks,
    analytics,
    users,
    sessions,
    loginHistory,

    audit,
    objectStore,
    googleAuth,

    auth,
    executor,
    client,
    provider,

    ai,
    extraction,
    titleResolver,
    analysis,

    thumbnails,
    folders,
    sync,
    content,
    adminDownload,
    rename,
    health,

    scheduler,
    retention,
  };
}

/**
 * Creates the first administrator from the environment, if one is configured
 * and no user exists yet.
 *
 * Only on an empty user table: re-running it must never silently reset the
 * password of a live admin account.
 */
export async function bootstrapAdmin({ config, users, logger }) {
  const { email, password, name } = config.bootstrapAdmin;
  if (!email || !password) return null;

  const existing = await users.findByEmail(email);
  if (existing) return existing;

  if (password.length < 10) {
    logger?.warn?.('BOOTSTRAP_ADMIN_PASSWORD is shorter than 10 characters — refusing to create the account.');
    return null;
  }

  const user = await users.create({ email, password, fullName: name, role: ROLES.ADMIN });
  logger?.info?.('Created the bootstrap administrator', { email });
  return user;
}
