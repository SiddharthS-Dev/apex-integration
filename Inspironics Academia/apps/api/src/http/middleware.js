import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { metrics } from './metrics.js';

export function securityHeaders(_req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (config.isProduction) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

// Same-origin is the normal setup (Vite proxy in dev, one domain in prod). CORS exists only so a
// separately hosted web app on APP_ORIGIN can still call the API with credentials.
export function cors(req, res, next) {
  const origin = req.get('origin');
  if (origin && origin === config.appOrigin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-File-Name,X-Requested-With');
      return res.status(204).end();
    }
  }
  next();
}

// Cookie-authenticated state-changing requests must come from our own origin (CSRF defence in depth
// on top of SameSite=Lax).
export function originCheck(req, _res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (!origin) return next();
  const allowed = new Set([config.appOrigin, config.apiOrigin, `${req.protocol}://${req.get('host')}`]);
  if (!allowed.has(origin)) return next(new HttpError(403, 'Cross-origin request rejected'));
  next();
}

export function requestLog(req, res, next) {
  const id = crypto.randomBytes(6).toString('hex');
  const started = process.hrtime.bigint();
  req.id = id;
  res.setHeader('X-Request-Id', id);
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const route = req.route?.path ? `${req.baseUrl}${req.route.path}` : req.path;
    metrics.recordRequest(`${req.method} ${route}`, ms, res.statusCode);
    if (req.path !== '/api/health') {
      log.info('http', { id, method: req.method, path: req.originalUrl.split('?')[0], status: res.statusCode, ms: Math.round(ms), user: req.user?.id });
    }
  });
  next();
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `No route for ${req.method} ${req.path}` });
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, _next) {
  const status = err instanceof HttpError ? err.status : err.type === 'entity.too.large' ? 413 : err.status && err.status < 500 ? err.status : 500;
  if (status === 503) log.warn('http.unavailable', { id: req.id, path: req.path, error: err.message });
  else if (status >= 500) log.error('http.error', { id: req.id, path: req.path, error: err.message, stack: err.stack });
  const message = status === 500 && config.isProduction ? 'Internal server error' : err.message;
  res.status(status).json({ error: message, ...(err.details ? { details: err.details } : {}) });
}
