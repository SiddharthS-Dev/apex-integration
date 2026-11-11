import cookieParser from 'cookie-parser';
import express from 'express';
import { config, dropboxConfigured } from './config.js';
import { aiEnabled, aiModel, aiUnavailableReason } from './ai/index.js';
import { mediaEnabled, mediaUnavailableReason } from './media/index.js';
import { loadSession, requireAdmin } from './auth/sessions.js';
import authRoutes from './auth/routes.js';
import entityRoutes from './entities/routes.js';
import fileRoutes from './files/routes.js';
import functionRoutes from './functions/routes.js';
import dropboxRoutes from './dropbox/routes.js';
import syncRoutes from './sync/routes.js';
import notifyRoutes from './notify/routes.js';
import meetingRoutes from './meetings/routes.js';
import studioRoutes from './studio/routes.js';
import { renderingAvailable } from './media/video/renderer.js';
import { emailConfigured, emailProvider } from './notify/mailer.js';
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
    ai_unavailable_reason: aiUnavailableReason(),
    media_provider: config.mediaProvider,
    media_enabled: mediaEnabled(),
    media_unavailable_reason: mediaUnavailableReason(),
    video_render_enabled: renderingAvailable(),
    dropbox_configured: dropboxConfigured(),
    registration_open: config.allowRegistration,
    google_enabled: false,
    max_upload_mb: config.maxUploadMb,
    email_enabled: emailConfigured(),
    email_provider: emailProvider(),
  }));

  // Raw-body upload route must be mounted before the JSON parser.
  app.use('/api', fileRoutes);
  app.use('/api', meetingRoutes);
  app.use(express.json({ limit: '5mb' }));

  app.use('/api/auth', authRoutes);
  app.use('/api/entities', entityRoutes);
  app.use('/api/functions', functionRoutes);
  app.use('/api/dropbox', dropboxRoutes);
  app.use('/api/sync', syncRoutes);
  app.use('/api/notifications', notifyRoutes);
  app.use('/api/studio', studioRoutes);

  app.use('/api', notFoundHandler);
  app.use(errorHandler);
  return app;
}
