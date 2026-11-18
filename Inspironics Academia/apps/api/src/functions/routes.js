import express from 'express';
import { FUNCTIONS } from '@academy/shared';
import { asyncHandler, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { metrics } from '../http/metrics.js';
import { handlers } from '../pipeline/index.js';
import { runWithGeneration } from '../usage/context.js';

// POST /api/functions/:name — backend functions (the content pipeline, final-test grading and
// certificate verification).
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
    // Generations made by this call are logged against the function and the caller; `fresh: true`
    // (an explicit regenerate) skips the AI content cache.
    const result = await runWithGeneration(
      { operation: name, userId: req.user?.id || null, fresh: req.body?.fresh === true },
      () => handler(req.body || {}, { user: req.user || null, log }),
    );
    metrics.recordFunction(name, Date.now() - started, true);
    res.json(result);
  } catch (err) {
    metrics.recordFunction(name, Date.now() - started, false);
    throw err;
  }
}));

export default router;
