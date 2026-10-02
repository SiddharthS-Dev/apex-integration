import cookieParser from 'cookie-parser';
import express from 'express';
import { config, dropboxConfigured } from './config.js';
import { aiEnabled, aiModel } from './ai/claude.js';
import { mediaEnabled } from './media/index.js';
import { loadSession, requireAdmin } from './auth/sessions.js';
import authRoutes from './auth/routes.js';
import entityRoutes from './entities/routes.js';
import fileRoutes from './files/routes.js';
import functionRoutes from './functions/routes.js';
import dropboxRoutes from './dropbox/routes.js';
import syncRoutes from './sync/routes.js';
import { metrics } from './http/metrics.js';
import { cors, errorHandler, notFoundHandler, originCheck, requestLog, securityHeaders } from './http/middleware.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');

  app.use(securityHeaders);
  app.use(cors);
  app.use(cookieParser());
  app.use(requestLog);
  app.use(originCheck);
  app.use(loadSession);

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.get('/api/metrics', requireAdmin, (_req, res) => res.json(metrics.snapshot()));

  // Feature flags the web app uses to shape the UI. Never includes secrets.
  app.get('/api/config', (_req, res) => res.json({
    ai_enabled: aiEnabled(),
    ai_model: aiModel(),
    media_provider: config.mediaProvider,
    media_enabled: mediaEnabled(),
    dropbox_configured: dropboxConfigured(),
    registration_open: config.allowRegistration,
    google_enabled: false,
    max_upload_mb: config.maxUploadMb,
  }));

  // Raw-body upload route must be mounted before the JSON parser.
  app.use('/api', fileRoutes);
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/entities', entityRoutes);
  app.use('/api/functions', functionRoutes);
  app.use('/api/dropbox', dropboxRoutes);
  app.use('/api/sync', syncRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
