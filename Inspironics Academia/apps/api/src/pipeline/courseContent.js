import { aiEnabled, requireAI } from '../ai/index.js';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { enqueueJob, listJobs, registerJobHandler } from '../jobs/queue.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log } from '../lib/logger.js';
import { mediaEnabled } from '../media/index.js';
import { renderingAvailable } from '../media/video/renderer.js';
import { entities } from '../repo/entities.js';
import { runWithGeneration } from '../usage/context.js';
import generateLessonContent from './generateLessonContent.js';
import generateLessonMedia from './generateLessonMedia.js';
import { errMsg } from './util.js';
import { assessLessonQuality, balanceAnswerPositions } from './lessonQuality.js';
import { loadLessonSource } from './source.js';

// Course content batch: generates the script, summary, key points, quiz and flashcards of every lesson
// of a course that has none yet, then (optionally) its narrated slides and its MP4 render.
//
// Safety rules:
//   - never overwrites a complete lesson (regenerating one is an explicit, per-lesson action); a lesson
//     with a script but an empty title, summary, key points or examples is generated again;
//   - resumable: a batch only picks up lessons still without content, so running it again continues
//     where the last one stopped; failed lessons are retried only when asked (retry_failed / lesson_ids);
//   - one batch per course at a time (job dedupe) and one generation per lesson (lesson lock);
//   - stops cleanly on the monthly budget / usage limits, on a provider configuration error (every
//     later lesson would fail the same way) and on cancellation; each lesson's outcome is stored on it.
//
// Payload: { course_id, limit?, lesson_ids?, retry_failed?, media?, render? }

const hasContent = (l) => !!String(l.teaching_script || '').trim();
const filled = (v) => !!String(v || '').trim();
// The fields the lesson page shows. A lesson with a script but any of these empty (an answer saved
// before every field was required, or a field cleared by hand) is incomplete and is generated again.
const LESSON_FIELDS = { video_title: 'video title', teaching_script: 'teaching script', summary: 'summary', key_points: 'key points', examples: 'examples' };
export const missingFields = (l) => Object.entries(LESSON_FIELDS).filter(([k]) => !filled(l[k])).map(([, label]) => label);
export const isComplete = (l) => missingFields(l).length === 0;
const hasMedia = (l) => !!String(l.audio_url || '').trim() && !!String(l.video_scenes || '').trim();
const hasVideo = (l) => !!String(l.rendered_video_url || '').trim();

/** The course's lessons in teaching order, each with its module. */
export async function courseLessons(courseId) {
  const course = await entities.Course.get(courseId);
  if (!course) throw notFound('Course not found');
  const modules = (await entities.Module.filter({ course_id: courseId })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const lessons = [];
  for (const m of modules) {
    const ls = (await entities.Lesson.filter({ module_id: m.id })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const l of ls) lessons.push({ ...l, module_title: m.title, module_order: m.order ?? 0 });
  }
  return { course, modules, lessons };
}

export function qualityOf(l) {
  try {
    const q = JSON.parse(l.quality_report || 'null');
    return q ? { score: q.score, passed: !!q.passed, issues: q.issues || [] } : null;
  } catch {
    return null;
  }
}

/** Per-lesson state for the dashboard. */
export function lessonState(l) {
  const missing = missingFields(l);
  const content = l.status === 'generating' ? 'processing' : !missing.length ? 'completed' : l.content_error ? 'failed' : hasContent(l) ? 'incomplete' : 'pending';
  return {
    id: l.id, title: l.title, module_title: l.module_title, status: l.status,
    content, missing_fields: hasContent(l) ? missing : [], content_error: l.content_error || null, content_attempts: Number(l.content_attempts) || 0, content_generated_at: l.content_generated_at || null,
    narration: hasMedia(l) ? 'completed' : l.media_error ? 'failed' : 'pending', media_error: l.media_error || null,
    video: hasVideo(l) ? 'completed' : 'pending', rendered_video_url: l.rendered_video_url || null,
    quality: qualityOf(l),
  };
}

/**
 * Scores a lesson's current content again (no AI call): after a reviewer's edits, or for lessons
 * generated before the check existed. With balance: true, also spreads the quiz's correct answers
 * over the option positions.
 */
export async function recheckLessonQuality(lesson, { balance = false } = {}) {
  if (!hasContent(lesson)) return null;
  const { chapter } = await loadLessonSource(lesson);
  let questions = (await entities.Question.filter({ lesson_id: lesson.id })).filter((q) => !q.assessment_id).sort((a, b) => String(a.created_date).localeCompare(String(b.created_date)));
  if (balance) {
    const balanced = balanceAnswerPositions(questions);
    for (const [i, q] of balanced.entries()) {
      if (JSON.stringify(q.options) !== JSON.stringify(questions[i].options)) await entities.Question.update(q.id, { options: q.options });
    }
    questions = balanced;
  }
  const flashcards = await entities.Flashcard.filter({ lesson_id: lesson.id });
  const quality = assessLessonQuality({ ...lesson, questions, flashcards }, chapter?.content || '');
  await entities.Lesson.update(lesson.id, { quality_score: quality.score, quality_report: JSON.stringify(quality) });
  return quality;
}

/** Course progress: counts, the active batch job, and each lesson's state. */
export async function courseProgress(courseId) {
  const { course, lessons } = await courseLessons(courseId);
  const states = lessons.map(lessonState);
  const count = (field, value) => states.filter((s) => s[field] === value).length;
  const jobs = await listJobs({ refType: 'course', refId: courseId, limit: 5 });
  return {
    course: { id: course.id, title: course.title, status: course.status, playbook_id: course.playbook_id || null },
    totals: {
      lessons: states.length,
      content: { completed: count('content', 'completed'), processing: count('content', 'processing'), failed: count('content', 'failed'), pending: count('content', 'pending') + count('content', 'incomplete'), incomplete: count('content', 'incomplete') },
      narration: { completed: count('narration', 'completed'), failed: count('narration', 'failed') },
      video: { completed: count('video', 'completed') },
      quality: {
        checked: states.filter((s) => s.quality).length,
        passed: states.filter((s) => s.quality?.passed).length,
        flagged: states.filter((s) => s.quality && !s.quality.passed).length,
        approvable: states.filter((s) => s.quality?.passed && s.status === 'pending_review').length,
      },
    },
    job: jobs.find((j) => j.type === 'content:course') || null,
    lessons: states,
  };
}

/** Which lessons a batch would process, in order. */
// A lesson left "generating" by a server restart mid-generation is picked up again after this long.
const STALE_GENERATING_MS = 15 * 60_000;
const busy = (l) => l.status === 'generating' && Date.now() - Date.parse(l.updated_date || 0) < STALE_GENERATING_MS;

export function selectLessons(lessons, { limit, lessonIds, retryFailed } = {}) {
  // Lessons without content, and lessons whose content is incomplete (a field the page shows is empty).
  // An approved lesson is a reviewer's decision: it is regenerated only when asked for by id.
  const explicit = Array.isArray(lessonIds) && lessonIds.length > 0;
  let pick = lessons.filter((l) => !busy(l) && (!hasContent(l) || (!isComplete(l) && (explicit || l.status !== 'approved'))));
  if (explicit) pick = pick.filter((l) => lessonIds.includes(l.id));
  // A temporary failure (provider overloaded / rate-limited) is picked up again automatically.
  else if (!retryFailed) pick = pick.filter((l) => !l.content_error || l.content_error_retryable);
  const n = Number(limit);
  return Number.isFinite(n) && n > 0 ? pick.slice(0, n) : pick;
}

// Temporary provider trouble (overloaded, rate-limited): worth waiting and trying again.
const isDailyQuota = (err) => !!err?.details?.quotaDaily || /daily quota reached/i.test(err?.message || '');
const isTransient = (err) => !isDailyQuota(err) && (!!err?.details?.overloaded || err?.status === 429 || (!!err?.details?.retryable && err?.code !== 'usage_limit'));
// Errors after which every later lesson would fail the same way: stop the batch instead of burning
// through the course (budget/limits, a provider's daily quota, missing or rejected credentials,
// provider not configured).
const stopsBatch = (err) => err?.code === 'usage_limit' || isDailyQuota(err) || (err?.status === 503 && !isTransient(err));

const pause = (ms, signal) => new Promise((resolve) => {
  if (!ms || signal?.aborted) return resolve();
  const t = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
});

async function mediaFor(lesson, { render, jobs, summary }) {
  if (summary.mediaOff) return;
  try {
    await runWithGeneration({ operation: 'generateLessonMedia', refType: 'lesson', refId: lesson.id },
      () => generateLessonMedia({ lesson_id: lesson.id }, {}));
    await entities.Lesson.update(lesson.id, { media_error: '' });
    if (render && renderingAvailable()) {
      const job = await enqueueJob({ type: 'render:lesson', payload: { lesson_id: lesson.id }, dedupeKey: `render:lesson:${lesson.id}`, refType: 'lesson', refId: lesson.id });
      jobs.push(job.id);
    }
  } catch (err) {
    await entities.Lesson.update(lesson.id, { media_error: errMsg(err).slice(0, 500) }).catch(() => {});
    // The voice provider's daily quota is used up: keep generating content, narrate later.
    if (isDailyQuota(err)) {
      summary.mediaOff = true;
      summary.media = `stopped after "${lesson.title}": ${errMsg(err)} — content generation continued; narrate the remaining lessons later`;
      return;
    }
    if (stopsBatch(err)) throw err;
  }
}

export async function runCourseBatch(payload = {}, { progress = async () => {}, signal } = {}) {
  const courseId = String(payload.course_id || '');
  if (!courseId) throw badRequest('course_id is required');
  requireAI();
  const { lessons } = await courseLessons(courseId);
  const queue = selectLessons(lessons, { limit: payload.limit, lessonIds: payload.lesson_ids, retryFailed: payload.retry_failed === true });
  const withMedia = payload.media === true && mediaEnabled();
  const render = payload.render === true;
  const summary = { course_id: courseId, selected: queue.length, completed: 0, failed: 0, skipped_existing: lessons.filter(isComplete).length, stopped: null, failures: [], render_jobs: [] };
  if (payload.media === true && !withMedia) summary.media = 'skipped: no voice provider is configured (MEDIA_PROVIDER); lesson players read the script with the browser voice';
  if (!queue.length) return summary;

  let next = 0;
  let finished = 0;
  let overloadedInARow = 0;
  const generate = (lesson) => runWithGeneration({ operation: 'generateLessonContent', refType: 'lesson', refId: lesson.id },
    () => generateLessonContent({ lesson_id: lesson.id, with_media: false }, {}));
  const worker = async () => {
    while (!summary.stopped && next < queue.length) {
      if (signal?.aborted) { summary.stopped = 'cancelled'; break; }
      const lesson = queue[next++];
      await progress((finished / queue.length) * 100, `Lesson ${finished + 1} of ${queue.length}: ${lesson.title}`);
      try {
        try {
          await generate(lesson);
        } catch (err) {
          // Overloaded / rate-limited after the provider's own retries: wait, then one more try.
          if (!isTransient(err) || signal?.aborted) throw err;
          await progress((finished / queue.length) * 100, `Gemini is busy — waiting ${Math.round(config.ai.batchRetryDelayMs / 1000)} s before retrying "${lesson.title}"`);
          await pause(config.ai.batchRetryDelayMs, signal);
          if (signal?.aborted) throw err;
          await generate(lesson);
        }
        overloadedInARow = 0;
        summary.completed++;
        if (withMedia) await mediaFor(lesson, { render, jobs: summary.render_jobs, summary });
      } catch (err) {
        if (stopsBatch(err)) {
          summary.stopped = err.code === 'usage_limit' ? `budget or usage limit reached: ${err.message}`
            : isDailyQuota(err) ? `${err.message} — run the batch again after the reset; it resumes where it stopped`
              : `AI provider unavailable: ${err.message}`;
        } else {
          summary.failed++;
          summary.failures.push({ lesson_id: lesson.id, title: lesson.title, error: errMsg(err), temporary: isTransient(err) });
          // Still overloaded after waiting, twice in a row: stop rather than fail the rest of the course.
          if (isTransient(err) && ++overloadedInARow >= 2) summary.stopped = `the AI provider is overloaded right now (${err.message}); run the batch again later — it resumes where it stopped`;
        }
      } finally {
        finished++;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(config.ai.batchConcurrency, queue.length) }, worker));
  log.info('pipeline.course_batch.done', { course_id: courseId, ...summary, failures: summary.failures.length });
  return summary;
}

registerJobHandler('content:course', (payload, ctx) => runCourseBatch(payload, ctx));

/** Starts (or joins) the course batch job. */
export async function startCourseBatch(payload = {}, ctx = {}) {
  const courseId = String(payload.course_id || '');
  if (!courseId) throw badRequest('course_id is required');
  if (!aiEnabled()) requireAI();
  await courseLessons(courseId); // 404 for an unknown course
  return enqueueJob({
    type: 'content:course',
    payload: {
      course_id: courseId,
      ...(payload.limit ? { limit: Number(payload.limit) } : {}),
      ...(Array.isArray(payload.lesson_ids) && payload.lesson_ids.length ? { lesson_ids: payload.lesson_ids.map(String) } : {}),
      retry_failed: payload.retry_failed === true,
      media: payload.media === true,
      render: payload.render === true,
    },
    dedupeKey: `content:course:${courseId}`,
    refType: 'course',
    refId: courseId,
    userId: ctx.user?.id || null,
    maxAttempts: 1,
  });
}

// ---- automatic resume ---------------------------------------------------------------------------
// A batch stopped by the provider's daily quota is started again by itself once the quota has reset,
// so a course is filled over the following days without anyone pressing the button again. Gemini's
// daily quotas reset at midnight Pacific time; 08:00 UTC is after that reset all year round.

const RESET_HOUR_UTC = 8;
const stoppedByDailyQuota = (job) => /daily quota/i.test(String(job?.result?.stopped || ''));

export function lastQuotaReset(at = new Date()) {
  const reset = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), RESET_HOUR_UTC));
  if (reset > at) reset.setUTCDate(reset.getUTCDate() - 1);
  return reset;
}

/** Restarts every course batch whose latest run stopped on the daily quota before the last reset. */
export async function resumeStoppedBatches({ now = new Date() } = {}) {
  if (!aiEnabled()) return [];
  const reset = lastQuotaReset(now).toISOString();
  const latest = new Map(); // course id -> its newest batch job
  for (const job of await listJobs({ refType: 'course', limit: 200 })) {
    if (job.type !== 'content:course' || !job.ref_id || latest.has(job.ref_id)) continue;
    latest.set(job.ref_id, job);
  }
  const resumed = [];
  for (const [courseId, job] of latest) {
    if (job.status !== 'completed' || !stoppedByDailyQuota(job) || String(job.finished_at || '') >= reset) continue;
    try {
      const { lessons } = await courseLessons(courseId);
      if (!selectLessons(lessons, {}).length) continue;
      const [row] = await db().query('SELECT payload FROM jobs WHERE id = ?', [job.id]);
      let payload = {};
      try { payload = JSON.parse(row?.payload || '{}') || {}; } catch { /* keep the defaults */ }
      delete payload.limit;
      const started = await startCourseBatch({ ...payload, course_id: courseId }, { user: job.created_by ? { id: job.created_by } : null });
      resumed.push({ course_id: courseId, job_id: started.id });
      log.info('pipeline.course_batch.resumed', { course_id: courseId, job_id: started.id });
    } catch (err) {
      log.warn('pipeline.course_batch.resume_failed', { course_id: courseId, error: errMsg(err) });
    }
  }
  return resumed;
}

let resumeTimer = null;
let resumeFirstTick = null;
/** Started by server.js with the other background jobs; JOBS_ENABLED=false keeps it off. */
export function startBatchResumer(intervalMs = 15 * 60_000, { enabled = config.jobsEnabled } = {}) {
  if (resumeTimer || !enabled) return false;
  const tick = () => resumeStoppedBatches().catch((err) => log.warn('pipeline.course_batch.resume_failed', { error: errMsg(err) }));
  resumeTimer = setInterval(tick, intervalMs);
  resumeTimer.unref();
  resumeFirstTick = setTimeout(tick, 30_000);
  resumeFirstTick.unref();
  return true;
}
export function stopBatchResumer() {
  clearInterval(resumeTimer);
  clearTimeout(resumeFirstTick);
  resumeTimer = null;
  resumeFirstTick = null;
}
export const batchResumerRunning = () => resumeTimer !== null;
