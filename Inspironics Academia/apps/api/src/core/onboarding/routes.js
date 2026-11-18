import express from 'express';
import { normalizeEmail } from '@academy/shared';
import { requireUser } from '../../auth/sessions.js';
import { db } from '../../db/index.js';
import { rateLimit } from '../../http/rateLimit.js';
import { asyncHandler, badRequest, notFound } from '../../lib/errors.js';
import { suggestInterests, suggestRegion } from './ai.js';
import { onboardingConfig } from './config.js';
import { completeOrientation, orientationFor } from './orientation.js';
import { complete, exchange, publicConfig, respond, resend, start, status, update, verify } from './service.js';

// /api/onboarding — the public access-request flow (Use Case 007) and the signed-in orientation.
// Browsers reach the public part through the gateway's /auth/onboarding/* (apex/onboarding.mjs), which
// keeps the resume token in an HttpOnly cookie and passes it here as X-Registration-Token; a token is
// never read from a URL here. Request bodies are never logged (the request log records method, path and
// status only). Rate limits are per client address (the gateway is the trusted proxy) and, for start,
// per address; the durable limits (attempts, sends, starts per day) are in the database.

const router = express.Router();
const HOUR = 3600_000;
const ipLimiter = rateLimit({ windowMs: HOUR, max: () => onboardingConfig().ipLimitPerHour, message: 'Too many requests. Try again later.' });
const stepLimiter = rateLimit({ windowMs: HOUR, max: () => onboardingConfig().ipLimitPerHour * 4, message: 'Too many requests. Try again later.' });
const emailLimiter = rateLimit({ windowMs: HOUR, max: 5, key: (req) => `start:${normalizeEmail(req.body?.email)}`, message: 'Too many requests. Try again later.' });
const suggestLimiter = rateLimit({ windowMs: 10 * 60_000, max: 20, message: 'Too many suggestions asked for. Continue without them.' });

const ctx = (req) => ({ ip: req.ip || null });
const tokenOf = (req) => {
  const t = req.get('x-registration-token');
  return typeof t === 'string' ? t : '';
};

router.use((_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

router.get('/config', (_req, res) => res.json(publicConfig()));

router.post('/suggest', suggestLimiter, asyncHandler(async (req, res) => {
  const cfg = onboardingConfig();
  if (!cfg.enabled || !cfg.selfRegistration) throw notFound();
  const kind = req.body?.kind;
  if (kind === 'interests') return res.json(await suggestInterests(req.body || {}));
  if (kind === 'region') return res.json(await suggestRegion(req.body || {}));
  throw badRequest('kind must be interests or region');
}));

router.post('/start', ipLimiter, emailLimiter, asyncHandler(async (req, res) => res.status(202).json(await start(db(), req.body, ctx(req)))));
router.post('/resend', ipLimiter, asyncHandler(async (req, res) => res.status(202).json(await resend(db(), tokenOf(req), ctx(req)))));
router.post('/verify', stepLimiter, asyncHandler(async (req, res) => res.json(await verify(db(), tokenOf(req), req.body, ctx(req)))));
router.get('/status', stepLimiter, asyncHandler(async (req, res) => res.json(await status(db(), tokenOf(req)))));
router.post('/update', stepLimiter, asyncHandler(async (req, res) => res.json(await update(db(), tokenOf(req), req.body, ctx(req)))));
router.post('/complete', stepLimiter, asyncHandler(async (req, res) => res.json(await complete(db(), tokenOf(req), req.body, ctx(req)))));
router.post('/exchange', ipLimiter, asyncHandler(async (req, res) => res.json(await exchange(db(), req.body, ctx(req)))));
router.post('/respond', stepLimiter, asyncHandler(async (req, res) => res.json(await respond(db(), tokenOf(req), req.body, ctx(req)))));

// Signed-in: orientation for accounts approved through onboarding (independent of the flags).
router.get('/orientation', requireUser, asyncHandler(async (req, res) => res.json(await orientationFor(db(), req.user))));
router.post('/orientation/complete', requireUser, asyncHandler(async (req, res) => res.json(await completeOrientation(db(), req.user))));

export default router;
