import {
  complianceReport, loadReviewQueue, myRecertifications, recordReview, resolveToday, waiveRecertification as waive,
} from '@academy/shared';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { store } from '../repo/store.js';
import { runDailyJobs } from '../notify/jobs.js';

// Retention functions: spaced-repetition review, recertification and compliance. The logic lives in
// @academy/shared (the demo driver runs the same code); these handlers add auth and input checks.
// `today` is the learner's local date, accepted within a day of the server's UTC date.

const signedIn = (ctx) => {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
};

/** Payload: { today } → { today, due, new, new_available, new_allowance, stats } */
export async function getReviewQueue(payload = {}, ctx = {}) {
  return loadReviewQueue(store, signedIn(ctx), { today: resolveToday(payload.today) });
}

/** Payload: { flashcard_id, quality (0–5), today } → { schedule, log, intervals } */
export async function submitFlashcardReview(payload = {}, ctx = {}) {
  const user = signedIn(ctx);
  const quality = Number(payload.quality);
  if (!Number.isInteger(quality) || quality < 0 || quality > 5) throw badRequest('quality must be an integer from 0 to 5');
  const result = await recordReview(store, user, { flashcard_id: payload.flashcard_id, quality, today: resolveToday(payload.today) });
  if (!result) throw notFound('Flashcard not found');
  return result;
}

/** Payload: { today } → the learner's recertifications with their delta lessons. */
export async function getMyRecertifications(payload = {}, ctx = {}) {
  return myRecertifications(store, signedIn(ctx), { today: resolveToday(payload.today) });
}

/** Admin. → { today, kpis, playbooks, recertifications, expiring } */
export async function getComplianceReport() {
  return complianceReport(store);
}

/** Admin. Payload: { id, reason } → the waived Recertification. */
export async function waiveRecertification(payload = {}) {
  const id = payload?.id ? String(payload.id) : '';
  if (!id) throw badRequest('id is required');
  const updated = await waive(store, id, { reason: payload.reason });
  if (!updated) throw notFound('No open recertification with that id');
  return updated;
}

/** Admin. Runs the daily pass now → { today, review_reminders, expired, expiring, due_soon, overdue } */
export async function runComplianceChecks() {
  return runDailyJobs();
}
