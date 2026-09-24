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

export function createSystemRouter({ config, db, metrics, objectStore, startedAt }) {
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

      // Thumbnails are embedded in <img> and previews in an iframe, so the
      // JSON-oriented defaults would block them.
      setEmbeddableHeaders(res, { origins: config.corsOrigins, isProduction: config.isProduction });
      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(stat.size));
      // Immutable because the key contains the file revision: the bytes behind
      // a given key never change.
      res.setHeader('Cache-Control', 'private, max-age=86400, immutable');
      objectStore.createReadStream(key).pipe(res);
    })
  );

  return router;
}
