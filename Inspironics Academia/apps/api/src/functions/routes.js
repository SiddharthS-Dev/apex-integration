import express from 'express';
import { FUNCTIONS } from '@academy/shared';
import { asyncHandler, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { metrics } from '../http/metrics.js';
import { handlers } from '../pipeline/index.js';

// POST /api/functions/:name — backend functions (the content pipeline + certificate verification).
// Each handler: async (payload, ctx) => result object. ctx = { user, log }.
const router = express.Router();

router.post('/:name', asyncHandler(async (req, res) => {
  const { name } = req.params;
  const spec = FUNCTIONS[name];
  const handler = handlers[name];
  if (!spec || !handler) throw notFound(`Unknown function ${name}`);
  if (!spec.public && !req.user) throw unauthorized();
  if (spec.admin && req.user?.role !== 'admin') throw forbidden('Administrator access required');

  const started = Date.now();
  try {
    const result = await handler(req.body || {}, { user: req.user || null, log });
    metrics.recordFunction(name, Date.now() - started, true);
    res.json(result);
  } catch (err) {
    metrics.recordFunction(name, Date.now() - started, false);
    throw err;
  }
}));

export default router;
