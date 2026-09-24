/**
 * The Express application.
 *
 * Built from a container rather than from module-level state, so a test can
 * stand up a complete app against an in-memory database and a fake Dropbox in
 * a few lines.
 */
import express from 'express';
import cookieParser from 'cookie-parser';

import { securityHeaders, cors } from './http/security.js';
import { attachUser } from './http/auth.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { createRateLimiter, byUserOrIp } from './http/rateLimit.js';
import { M } from './services/metrics/metrics.js';

import { createDropboxRouter } from './integrations/dropbox/routes/index.js';
import { createAuthRouter } from './routes/auth.js';
import { createEntityRouter } from './routes/entities.js';
import { createSystemRouter } from './routes/system.js';

export function createApp(container) {
  const { config, logger, metrics } = container;
  const app = express();
  const startedAt = Date.now();

  // Behind a reverse proxy the client IP is in X-Forwarded-For; trusting it
  // unconditionally would let any caller spoof their address past the rate
  // limiter, so it is opt-in.
  if (process.env.TRUST_PROXY) app.set('trust proxy', process.env.TRUST_PROXY);
  app.disable('x-powered-by');

  app.use(securityHeaders({ isProduction: config.isProduction }));
  app.use(cors({ origins: config.corsOrigins }));
  // A small limit: every endpoint here takes a short JSON body, and a large
  // one is either a mistake or an attempt to exhaust memory.
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());

  /* Request logging and HTTP metrics. */
  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const seconds = Number(process.hrtime.bigint() - start) / 1e9;
      // The route pattern, not the URL: a per-id label would create a new
      // metric series for every file in the library.
      const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.baseUrl || req.path;
      metrics.increment(M.httpRequests, { method: req.method, route, status: res.statusCode });
      metrics.observe(M.httpLatency, seconds, { method: req.method, route });
      logger.debug('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Math.round(seconds * 1000),
        user: req.user?.email,
      });
    });
    next();
  });

  app.use(
    attachUser({
      sessions: container.sessions,
      users: container.users,
      cookieName: config.session.cookieName,
    })
  );

  const generalLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    keyFn: byUserOrIp,
  });
  const adminLimiter = createRateLimiter({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.adminMaxRequests,
    keyFn: byUserOrIp,
    message: 'Too many administrative requests. Slow down.',
  });

  app.use('/api', generalLimiter);
  app.use('/api/auth', createAuthRouter(container));
  app.use('/api', createSystemRouter({ ...container, startedAt }));
  app.use('/api/dropbox', adminLimiter, createDropboxRouter(container));
  app.use('/api', createEntityRouter(container));

  app.use(notFoundHandler);
  app.use(errorHandler({ logger, isProduction: config.isProduction }));

  app.locals.container = container;
  return app;
}
