/**
 * Read access to the indexed catalog, plus the small amount of write access
 * the application needs (view tracking).
 *
 * The frontend already speaks an entity-shaped API, so this exposes the same
 * shape over the new backend. Every entity is an explicit allow-list: there is
 * no generic "any table, any column" endpoint, because that is how a read API
 * turns into an arbitrary-write API by accident.
 */
import { Router } from 'express';
import { asyncHandler, notFound } from '../http/errors.js';
import { requireAuth, requireAdmin } from '../http/auth.js';
import { optionalString, requireInt, requireUuid } from '../http/validate.js';
import { StoredFileRepository } from '../db/repositories/storedFileRepository.js';
import { AnalyticsRepository } from '../db/repositories/analyticsRepository.js';
import { ConnectionRepository } from '../db/repositories/connectionRepository.js';

export function createEntityRouter({ config, files, connections, syncLogs, analytics, loginHistory }) {
  const router = Router();
  router.use(requireAuth);

  const isAdmin = (req) => req.user.role === 'admin';
  const present = (req) => (file) => StoredFileRepository.toPresentation(file, { admin: isAdmin(req) });
  const viewDedupeMs = (config?.analytics?.viewDedupeMinutes ?? 10) * 60_000;

  /* ------------------------------------------------------ presentations */

  router.get(
    '/presentations',
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 1000, fallback: 200 });
      const offset = requireInt(req.query.offset, 'offset', { min: 0, max: 100_000, fallback: 0 });
      // Only an admin may look at archived records; to everyone else, a file
      // that left Dropbox has left the library.
      const status =
        req.user.role === 'admin'
          ? optionalString(req.query.status, 'status', { maxLength: 20 }) || 'active'
          : 'active';
      const sort = optionalString(req.query.sort, 'sort', { maxLength: 40 }) || '-updated_at';

      const rows = await files.list({ status, limit, offset, sort });
      res.json({
        items: rows.map(present(req)),
        total: await files.count(status),
        limit,
        offset,
      });
    })
  );

  router.get(
    '/presentations/:id',
    asyncHandler(async (req, res) => {
      const file = await files.findById(requireUuid(req.params.id, 'id'));
      if (!file) throw notFound('That presentation is not in the library.');
      if (file.status !== 'active' && req.user.role !== 'admin') {
        throw notFound('That presentation is not in the library.');
      }
      res.json(present(req)(file));
    })
  );

  /* ---------------------------------------------------------- analytics */

  router.get(
    '/analytics',
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 1000, fallback: 200 });
      const offset = requireInt(req.query.offset, 'offset', { min: 0, max: 100_000, fallback: 0 });
      const rows = await analytics.list({ limit, offset });
      // Everyone gets the counts the dashboards are built from; only an admin
      // gets who did the viewing.
      res.json({
        items: isAdmin(req) ? rows : rows.map(AnalyticsRepository.toAggregate),
        limit,
        offset,
      });
    })
  );

  /**
   * The one place a view is counted — for every file type, online or offline.
   *
   * The content endpoints deliberately count nothing: a PDF viewer issues
   * several range requests per open, an Office deck is served from the asset
   * cache, and an offline copy never reaches the server at all, so counting
   * bytes served would be wrong in a different direction for each. The viewer
   * reports the open here instead, and the same viewer re-opening the same
   * deck within a short window is the same view.
   */
  router.post(
    '/analytics/view',
    asyncHandler(async (req, res) => {
      const presentationId = requireUuid(req.body?.presentation_id, 'presentation_id');
      const file = await files.findById(presentationId);
      if (!file || (file.status !== 'active' && !isAdmin(req))) {
        throw notFound('That presentation is not in the library.');
      }

      const readingSeconds = requireInt(req.body?.reading_seconds, 'reading_seconds', {
        min: 0,
        // A "view" longer than four hours is a tab left open, not reading —
        // letting it through would wreck the average.
        max: 14_400,
        fallback: 0,
      });
      const completionPct =
        req.body?.completion_pct === undefined || req.body?.completion_pct === null
          ? null
          : requireInt(req.body.completion_pct, 'completion_pct', { min: 0, max: 100, fallback: 0 });

      const counted = await analytics.claimView({
        presentationId,
        viewerId: req.user.id,
        windowMs: viewDedupeMs,
      });
      if (!counted) {
        const existing = await analytics.findByPresentation(presentationId);
        const shaped = isAdmin(req) ? existing : AnalyticsRepository.toAggregate(existing);
        res.json({ ...(shaped ?? {}), counted: false });
        return;
      }

      const record = await analytics.recordView({
        presentationId,
        presentationTitle: file.title || file.name,
        viewerId: req.user.id,
        viewerName: req.user.full_name,
        offline: req.body?.offline === true,
        readingSeconds,
        completionPct,
      });
      await files.incrementViews(presentationId);
      res.json({ ...(isAdmin(req) ? record : AnalyticsRepository.toAggregate(record)), counted: true });
    })
  );

  /* ------------------------------------------------------ admin surface */

  router.get(
    '/sync-logs',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 200, fallback: 25 });
      res.json({ items: await syncLogs.list({ limit }) });
    })
  );

  router.get(
    '/dropbox-config',
    requireAdmin,
    asyncHandler(async (req, res) => {
      res.json(ConnectionRepository.sanitize(await connections.ensure('dropbox')));
    })
  );

  router.get(
    '/login-history',
    requireAdmin,
    asyncHandler(async (req, res) => {
      const limit = requireInt(req.query.limit, 'limit', { min: 1, max: 500, fallback: 100 });
      res.json({ items: await loginHistory.list({ limit }) });
    })
  );

  return router;
}
