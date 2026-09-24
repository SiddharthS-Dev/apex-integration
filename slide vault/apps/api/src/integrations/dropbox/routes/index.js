/**
 * The Dropbox HTTP surface.
 *
 * Every administrative route is behind requireAdmin; content routes are behind
 * requireAuth. The only route reachable without a session is the OAuth
 * callback, which Dropbox itself calls — and that one is protected by the
 * single-use `state` instead.
 *
 * Handlers stay thin: validate, delegate to a service, shape a response. All
 * of the behaviour worth testing lives in the services.
 */
import { Router } from 'express';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { asyncHandler, notFound } from '../../../http/errors.js';
import { requireAdmin, requireAuth, clientIp } from '../../../http/auth.js';
import { setEmbeddableHeaders } from '../../../http/security.js';
import { optionalString, requireBoolean, requireInt, requireString, requireUuid } from '../../../http/validate.js';
import { ConnectionRepository } from '../../../db/repositories/connectionRepository.js';
import { StoredFileRepository } from '../../../db/repositories/storedFileRepository.js';
import { AUDIT } from '../../../services/audit/AuditService.js';

export function createDropboxRouter(container) {
  const {
    config,
    auth,
    connections,
    folders,
    sync,
    syncLogs,
    health,
    content,
    adminDownload,
    rename,
    files,
    analytics,
    audit,
    logger,
  } = container;

  const router = Router();

  /* ------------------------------------------------------------- status */

  router.get(
    '/status',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const connection = await connections.ensure('dropbox');
      res.json({
        ...ConnectionRepository.sanitize(connection),
        configured: Boolean(config.dropbox.appKey && config.dropbox.appSecret),
        redirect_uri: config.dropbox.redirectUri,
        supported_extensions: config.sync.supportedExtensions,
        scheduler: { enabled: config.sync.enabled, interval_minutes: config.sync.intervalMinutes },
      });
    })
  );

  router.get(
    '/health',
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await health.health());
    })
  );

  /* -------------------------------------------------------------- oauth */

  router.get(
    '/auth/url',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const result = await auth.getAuthorizationUrl({
        userId: req.user.id,
        redirectAfter: optionalString(req.query.redirect_after, 'redirect_after', { maxLength: 300 }),
        forceReapprove: req.query.force === 'true',
      });
      // The state value is intentionally not echoed back — it lives in the URL
      // the browser is about to follow, and nowhere else the client can read.
      res.json({ url: result.url, redirect_uri: result.redirectUri, expires_at: result.expiresAt });
    })
  );

  /**
   * Dropbox redirects the browser here after the admin approves.
   *
   * It answers with a redirect back into the application rather than JSON,
   * because the caller is a browser navigation, not a fetch. Failures are
   * reported in the query string so the settings page can show them.
   */
  router.get(
    '/oauth/callback',
    asyncHandler(async (req, res) => {
      const target = new URL(`${config.appBaseUrl}/dropbox-settings`);

      if (req.query.error) {
        // The admin pressed "Cancel" at Dropbox, or Dropbox refused.
        target.searchParams.set('dropbox_error', String(req.query.error_description || req.query.error).slice(0, 200));
        res.redirect(302, target.toString());
        return;
      }

      try {
        const code = requireString(req.query.code, 'code', { maxLength: 500 });
        const state = requireString(req.query.state, 'state', { maxLength: 500 });

        const result = await auth.exchangeAuthorizationCode(code, {
          state,
          actor: req.user,
          ip: clientIp(req),
        });

        target.searchParams.set('dropbox_connected', '1');
        if (result.account_email) target.searchParams.set('account', result.account_email);
      } catch (error) {
        logger.warn('OAuth callback failed', { error: error.message });
        target.searchParams.set(
          'dropbox_error',
          String(error.userMessage ?? error.message ?? 'The Dropbox connection failed.').slice(0, 200)
        );
      }

      res.redirect(302, target.toString());
    })
  );

  /**
   * The same exchange, for clients that handle the redirect themselves.
   * Kept because a single-page app may be configured with its own route as the
   * Dropbox redirect URI.
   */
  router.post(
    '/oauth/exchange',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const code = requireString(req.body?.code, 'code', { maxLength: 500 });
      const state = req.body?.state === undefined ? undefined : requireString(req.body.state, 'state', { maxLength: 500 });
      res.json(await auth.exchangeAuthorizationCode(code, { state, actor: req.user, ip: clientIp(req) }));
    })
  );

  router.post(
    '/test',
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(await health.testConnection({ actor: req.user, ip: clientIp(req) }));
    })
  );

  /**
   * Reconnect starts a *fresh* authorization rather than reusing a credential
   * that has already proved invalid (spec §53).
   */
  router.post(
    '/reconnect',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const result = await auth.getAuthorizationUrl({
        userId: req.user.id,
        forceReapprove: true,
      });
      await audit.record({
        actorId: req.user.id,
        actorEmail: req.user.email,
        action: AUDIT.DROPBOX_RECONNECTED,
        ip: clientIp(req),
        details: { stage: 'authorization_started' },
      });
      res.json({ url: result.url, redirect_uri: result.redirectUri });
    })
  );

  router.post(
    '/disconnect',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const result = await auth.revokeAccess({ actor: req.user, ip: clientIp(req) });
      // Indexed files are deliberately left alone: disconnecting a connection
      // is not a request to destroy the catalog (spec §52).
      res.json({ ...result, indexedFilesRetained: await files.count('active') });
    })
  );

  /* ------------------------------------------------------------ folders */

  router.get(
    '/folders',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const path = optionalString(req.query.path, 'path', { maxLength: 700 });
      res.json(await folders.browse(path));
    })
  );

  router.post(
    '/folder',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const root = optionalString(req.body?.root_folder ?? req.body?.path, 'root_folder', { maxLength: 700 });
      const connection = await folders.setRootFolder(root, { actor: req.user, ip: clientIp(req) });
      res.json(ConnectionRepository.sanitize(connection));
    })
  );

  /* --------------------------------------------------------------- sync */

  router.post(
    '/sync',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const trigger = optionalString(req.body?.trigger, 'trigger', { maxLength: 30 }) || 'manual';
      const force = requireBoolean(req.body?.force, 'force', false);

      const result = await sync.run({ trigger: trigger === 'scheduled' ? 'admin' : trigger, actor: req.user, force });
      res.json({
        status: result.status,
        sync_id: result.syncId ?? null,
        reason: result.reason ?? null,
        ...(result.counts ?? {}),
        errors: result.errors ?? [],
      });
    })
  );

  router.get(
    '/sync/logs',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 200, fallback: 25 });
      const offset = requireInt(req.query.offset, 'offset', { min: 0, max: 100_000, fallback: 0 });
      res.json({ logs: await syncLogs.list({ limit, offset }), running: await sync.isRunning() });
    })
  );

  router.get(
    '/sync/:id',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const log = await syncLogs.findById(requireUuid(req.params.id, 'id'));
      if (!log) throw notFound('No such sync run.');
      res.json(log);
    })
  );

  /* -------------------------------------------------------------- files */

  // Declared before "/files/:id" so the literal path is not swallowed by the
  // parameterised one.
  router.post(
    '/files/rename-untitled',
    requireAdmin,
    asyncHandler(async (req, res) => {
      // Dry run is the default: an omitted flag must never mean "rename 50
      // files in someone's Dropbox".
      const dryRun = requireBoolean(req.body?.dryRun ?? req.body?.dry_run, 'dryRun', true);
      const limit = requireInt(req.body?.limit, 'limit', { min: 1, max: 200, fallback: 50 });
      res.json(await rename.renameUntitled({ dryRun, limit, actor: req.user, ip: clientIp(req) }));
    })
  );

  router.get(
    '/files/:id',
    requireAuth,
    asyncHandler(async (req, res) => {
      const file = await files.findById(requireUuid(req.params.id, 'id'));
      if (!file || file.status !== 'active') throw notFound('That presentation is not in the library.');
      res.json(StoredFileRepository.toPresentation(file));
    })
  );

  router.get(
    '/files/:id/preview',
    requireAuth,
    asyncHandler(async (req, res) => {
      res.json(await content.resolvePreview(requireUuid(req.params.id, 'id')));
    })
  );

  /**
   * The content proxy.
   *
   * This is what keeps Dropbox URLs away from users: the bytes pass through
   * the application, under the application's authorization, and the client
   * only ever sees a path on this server (spec §42).
   */
  router.get(
    '/files/:id/content',
    requireAuth,
    asyncHandler(async (req, res) => {
      const id = requireUuid(req.params.id, 'id');
      const opened = await content.openContent(id, { preferPreview: req.query.original !== 'true' });

      setEmbeddableHeaders(res, {
        origins: config.corsOrigins,
        isProduction: config.isProduction,
        html: opened.contentType.startsWith('text/html'),
      });
      res.setHeader('Content-Type', opened.contentType);
      if (opened.contentLength) res.setHeader('Content-Length', String(opened.contentLength));
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(opened.fileName ?? 'file')}"`);
      res.setHeader('Cache-Control', 'private, max-age=300');

      const source = opened.stream instanceof Readable ? opened.stream : Readable.fromWeb(opened.stream);
      // pipeline() tears the upstream down if the client disconnects mid-file,
      // which is what stops an abandoned download from holding a Dropbox
      // connection open for the full timeout.
      await pipeline(source, res);

      analytics
        ?.recordView({
          presentationId: id,
          viewerId: req.user.id,
          viewerName: req.user.full_name,
          offline: false,
        })
        .catch(() => {});
      files.incrementViews(id).catch(() => {});
    })
  );

  router.get(
    '/files/:id/download',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const link = await adminDownload.createLink(requireUuid(req.params.id, 'id'), req.user, {
        ip: clientIp(req),
      });
      res.json(link);
    })
  );

  router.post(
    '/files/:id/rename',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const title = requireString(req.body?.title, 'title', { maxLength: 200 });
      const dryRun = requireBoolean(req.body?.dryRun ?? req.body?.dry_run, 'dryRun', false);
      res.json(
        await rename.renameOne(requireUuid(req.params.id, 'id'), title, {
          actor: req.user,
          ip: clientIp(req),
          dryRun,
        })
      );
    })
  );

  router.post(
    '/files/:id/invalidate',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const ok = await content.invalidate(requireUuid(req.params.id, 'id'));
      if (!ok) throw notFound('That presentation is not in the library.');
      res.json({ invalidated: true });
    })
  );

  /* -------------------------------------------------------------- audit */

  router.get(
    '/audit',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 500, fallback: 50 });
      const action = optionalString(req.query.action, 'action', { maxLength: 60 });
      res.json({ events: await audit.list({ limit, action: action || null }) });
    })
  );

  router.use((req, _res, next) => {
    next(notFound(`No Dropbox route for ${req.method} ${req.path}.`));
  });

  return router;
}
