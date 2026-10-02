import { log } from '../lib/logger.js';
import generateAssessment from './generateAssessment.js';
import generateLessonContent from './generateLessonContent.js';
import generateLessonMedia from './generateLessonMedia.js';
import processPlaybookExtract from './processPlaybookExtract.js';
import processPlaybookStructure from './processPlaybookStructure.js';
import verifyCertificate from './verifyCertificate.js';

// Backend functions exposed at POST /api/functions/:name (auth checks happen in functions/routes.js).
export const handlers = {
  processPlaybookExtract,
  processPlaybookStructure,
  generateLessonContent,
  generateLessonMedia,
  generateAssessment,
  verifyCertificate,
};

// Server-side entry points (no HTTP request), e.g. the Dropbox sync auto-extract.
const systemCtx = () => ({ user: null, log });

/** Extract chapters for a playbook. Returns the processPlaybookExtract result; throws on failure. */
export async function runExtract(playbookId) {
  return handlers.processPlaybookExtract({ playbook_id: playbookId }, systemCtx());
}

/** Extract, then optionally structure. Returns { extract, structure? }. */
export async function runPipeline(playbookId, { structure = false, force = false } = {}) {
  const extract = await runExtract(playbookId);
  if (!structure) return { extract };
  const structured = await handlers.processPlaybookStructure({ playbook_id: playbookId, force }, systemCtx());
  return { extract, structure: structured };
}
