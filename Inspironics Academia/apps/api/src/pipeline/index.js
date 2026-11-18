import { log } from '../lib/logger.js';
import { config } from '../config.js';
import { runWithGeneration } from '../usage/context.js';
import generateAssessment from './generateAssessment.js';
import generateLessonContent from './generateLessonContent.js';
import generateLessonMedia from './generateLessonMedia.js';
import processPlaybookExtract from './processPlaybookExtract.js';
import processPlaybookStructure from './processPlaybookStructure.js';
import submitFinalTest from './submitFinalTest.js';
import submitQuiz from './submitQuiz.js';
import verifyCertificate from './verifyCertificate.js';
import processMeeting from './processMeeting.js';
import publishMeeting from './publishMeeting.js';
import generateMeetingVideo from './generateMeetingVideo.js';
import { publishRenderedVideo, renderLessonVideo, renderMeetingVideo, renderProjectVideo } from './renderVideo.js';
import deletePlaybooks from './deletePlaybooks.js';
import classifyPlaybooks from './classifyPlaybooks.js';
import {
  getComplianceReport, getMyRecertifications, getReviewQueue, runComplianceChecks, submitFlashcardReview, waiveRecertification,
} from './retention.js';

// Backend functions exposed at POST /api/functions/:name (auth checks happen in functions/routes.js).
export const handlers = {
  processPlaybookExtract,
  processPlaybookStructure,
  generateLessonContent,
  generateLessonMedia,
  generateAssessment,
  submitFinalTest,
  submitQuiz,
  verifyCertificate,
  getReviewQueue,
  submitFlashcardReview,
  getMyRecertifications,
  getComplianceReport,
  waiveRecertification,
  runComplianceChecks,
  processMeeting,
  publishMeeting,
  generateMeetingVideo,
  renderLessonVideo,
  renderMeetingVideo,
  renderProjectVideo,
  publishRenderedVideo,
  deletePlaybooks,
  classifyPlaybooks,
};

// Server-side entry points (no HTTP request), e.g. the Dropbox sync auto-extract.
const systemCtx = () => ({ user: null, log });

/** Extract chapters for a playbook. Returns the processPlaybookExtract result; throws on failure. */
// Sync work uses AI only when SYNC_AI_EXTRACT / SYNC_AI_MEETINGS say so; otherwise the built-in
// chapter detection and keyword analysis run, and an admin asks for the AI version explicitly.
export async function runExtract(playbookId) {
  return runWithGeneration({ operation: 'sync:extract' }, () => handlers.processPlaybookExtract({ playbook_id: playbookId, ai: config.syncAiExtract }, systemCtx()));
}

/** Analyse a meeting transcript (Dropbox sync auto-processing). */
export async function runMeeting(meetingId) {
  return runWithGeneration({ operation: 'sync:meeting' }, () => handlers.processMeeting({ meeting_id: meetingId, ai: config.syncAiMeetings }, systemCtx()));
}

/** Extract, then optionally structure. Returns { extract, structure? }. */
export async function runPipeline(playbookId, { structure = false, force = false } = {}) {
  const extract = await runExtract(playbookId);
  if (!structure) return { extract };
  const structured = await handlers.processPlaybookStructure({ playbook_id: playbookId, force }, systemCtx());
  return { extract, structure: structured };
}
