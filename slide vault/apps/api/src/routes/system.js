/**
 * Liveness, metrics and the cached-asset endpoint.
 *
 * /health is deliberately unauthenticated and deliberately boring: a load
 * balancer needs a yes/no, not an account name. The detailed, credential-
 * adjacent view lives behind requireAdmin at /api/dropbox/health.
 */
import { Router } from 'express';
import { asyncHandler, notFound } from '../http/errors.js';
import { requireAdmin, requireAuth } from '../http/auth.js';
import { setEmbeddableHeaders } from '../http/security.js';
import { parseRange, sendUnsatisfiable, setRangeHeaders, streamBody } from '../http/range.js';

export function createSystemRouter({ config, db, metrics, objectStore, files, startedAt }) {
  const router = Router();

  router.get(
    '/health',
    asyncHandler(async (req, res) => {
      let database = 'ok';
      try {
        await db.query('SELECT 1 AS ok');
      } catch (error) {
        database = 'error';
      }
      const healthy = database === 'ok';
      res.status(healthy ? 200 : 503).json({
        status: healthy ? 'ok' : 'degraded',
        database,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        version: process.env.npm_package_version ?? '1.0.0',
      });
    })
  );

  router.get('/metrics', requireAdmin, (req, res) => {
    if (!config.metricsEnabled) {
      res.status(404).json({ error: 'Metrics are disabled.' });
      return;
    }
    // Prometheus by default; JSON when a browser or the admin UI asks for it.
    if (req.query.format === 'json' || req.accepts(['text', 'json']) === 'json') {
      res.json(metrics.snapshot());
      return;
    }
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.render());
  });

  /**
   * Cached thumbnails and rendered previews.
   *
   * Behind requireAuth: these are derived from the library's content, so they
   * deserve the same gate as the content itself. The keys are hashes, so a URL
   * leaks nothing about the Dropbox path it came from.
   */
  router.get(
    '/assets/:key',
    requireAuth,
    asyncHandler(async (req, res) => {
      const key = String(req.params.key);
      if (!(await objectStore.has(key))) throw notFound('That asset is no longer cached.');

      // The asset is only as visible as the record it belongs to. A preview
      // outlives its file on disk until the retention sweep, so without this an
      // archived deck — or an old revision of a live one — stays readable to
      // anyone who kept the URL.
      if (req.user.role !== 'admin') {
        const owner = await files?.findByAssetUrl(objectStore.urlFor(key));
        if (!owner || owner.status !== 'active') throw notFound('That asset is no longer cached.');
      }

      const stat = await objectStore.stat(key);
      const extension = key.slice(key.lastIndexOf('.') + 1).toLowerCase();
      const contentType =
        extension === 'pdf'
          ? 'application/pdf'
          : extension === 'png'
            ? 'image/png'
            : extension === 'webp'
              ? 'image/webp'
              : 'image/jpeg';

      const range = parseRange(req.headers.range, stat.size);
      if (range === 'unsatisfiable') {
        sendUnsatisfiable(res, stat.size);
        return;
      }

      // Thumbnails are embedded in <img> and previews in an iframe, so the
      // JSON-oriented defaults would block them.
      setEmbeddableHeaders(res, { origins: config.corsOrigins, isProduction: config.isProduction });
      res.setHeader('Content-Type', contentType);
      setRangeHeaders(res, { range, size: stat.size });
      // Immutable because the key contains the file revision: the bytes behind
      // a given key never change.
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');

      // streamBody, not .pipe(): a read error (the retention sweep deleting
      // the file between stat and read) must reach the error handler instead
      // of crashing the process as an unhandled 'error' event.
      await streamBody(res, objectStore.createReadStream(key, range ?? undefined));
    })
  );

  return router;
}
