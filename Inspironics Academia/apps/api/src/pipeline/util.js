import { withLock } from '../db/locks.js';
import { HttpError, conflict } from '../lib/errors.js';

export const errMsg = (e) => (e instanceof Error ? e.message : String(e));

// Pipeline failures caused by the content (no text, no chapters, bad AI output) are 422 so the
// message reaches the admin even in production (5xx messages are masked by the error handler).
export const pipelineError = (msg) => new HttpError(422, msg);

export function asHttpError(e) {
  return e instanceof HttpError ? e : pipelineError(errMsg(e));
}

export async function inBatches(items, size, fn) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export const pick = (...vals) => vals.map((v) => (typeof v === 'string' ? v.trim() : '')).find(Boolean) || '';

// One extract/structure run per playbook at a time (admin clicks + Dropbox auto-extract).
export async function withPlaybookLock(playbookId, fn) {
  const { acquired, result } = await withLock(`pipeline:playbook:${playbookId}`, fn, { ttlMs: 30 * 60 * 1000 });
  if (!acquired) throw conflict('This playbook is already being processed — try again when the current run finishes');
  return result;
}

/** Resolve an MCQ answer to exactly one of the options (handles letters / case drift). */
export function resolveAnswer(options, answer) {
  const a = String(answer || '').trim();
  if (!a) return null;
  if (options.includes(a)) return a;
  const ci = options.find((o) => o.trim().toLowerCase() === a.toLowerCase());
  if (ci) return ci;
  const letter = a.match(/^\(?([A-Da-d])[).:]?$/) || a.match(/^\(?([A-Da-d])[).:]\s+/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (options[idx]) return options[idx];
  }
  const stripped = a.replace(/^\(?[A-Da-d][).:]\s+/, '').toLowerCase();
  return options.find((o) => o.trim().toLowerCase() === stripped) || null;
}

export function norm(s) {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Normalise raw MCQ options → { options (≤4, includes correct), correct } or null. */
export function cleanMcq(q) {
  const opts = [...new Set((Array.isArray(q?.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean))];
  if (!String(q?.question_text || '').trim() || opts.length < 2) return null;
  const correct = resolveAnswer(opts, q.correct_answer);
  if (!correct) return null;
  return { options: opts.slice(0, 4).includes(correct) ? opts.slice(0, 4) : [...opts.slice(0, 3), correct], correct };
}
