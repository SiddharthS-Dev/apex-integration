import express from 'express';
import { config } from '../config.js';
import { requireAdmin } from '../auth/sessions.js';
import { asyncHandler, badRequest } from '../lib/errors.js';
import { rateLimit } from '../http/rateLimit.js';
import { emailConfigured, emailProvider } from './mailer.js';
import { drainOutbox, outboxStatus } from './outbox.js';
import { sendAccountEmail } from './index.js';

// Admin view of email delivery (/admin/integrations). Learners' own notifications go through the
// Notification entity API.
const router = express.Router();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/email/status', requireAdmin, asyncHandler(async (req, res) => {
  res.json({
    provider: emailProvider(),
    from: config.email.from,
    configured: emailConfigured(),
    ...(await outboxStatus(req.query.limit)),
  });
}));

router.post('/email/test', requireAdmin, rateLimit({ windowMs: 60_000, max: 5 }), asyncHandler(async (req, res) => {
  const to = String(req.body?.to || req.user.email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(to)) throw badRequest('Enter a valid email address');
  await sendAccountEmail('test', to, {}, { userId: req.user.id, send: false });
  const { sent, failed } = await drainOutbox();
  const [latest] = (await outboxStatus(1)).recent;
  res.json({ ok: failed === 0 && latest?.status === 'sent', status: latest?.status || 'queued', error: latest?.last_error || null, sent });
}));

export default router;
