import { gradeFinalTest, loadFinalTestPool, newCertificateId } from '@academy/shared';
import { withLock } from '../db/locks.js';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js';
import { entities } from '../repo/entities.js';

// submitFinalTest — grades a learner's final course test and, on a pass, issues the certificate.
//
// Learners cannot create Certificate records themselves (RLS), so this is the only way one is made:
// the score comes from the server's own copy of the questions, never from the browser.
//
// Payload: { course_id, answers: [{ question_id, selected }] }   (signed-in user)
// Returns: { score, total, percentage, passed, passing_score, certificate_id }
const filter = (name, query, sort, limit) => entities[name].filter(query, sort, limit);

export default async function submitFinalTest(payload = {}, ctx = {}) {
  const user = ctx.user;
  if (!user) throw unauthorized();
  const courseId = payload?.course_id ? String(payload.course_id) : '';
  if (!courseId) throw badRequest('course_id is required');

  const course = await entities.Course.get(courseId);
  if (!course || course.status !== 'published') throw notFound('Course not found');

  const pool = await loadFinalTestPool(filter, courseId);
  if (!pool.count) throw badRequest('This course has no final test yet.');
  const result = gradeFinalTest(pool, payload.answers);
  if (!result) throw badRequest('These answers do not match the final test for this course.');

  // One submission per learner and course at a time, so two passes can't issue two certificates.
  const { acquired, result: saved } = await withLock(
    `final-test:${user.id}:${courseId}`,
    () => record(user, course, pool.assessment, result),
    { ttlMs: 60_000 },
  );
  if (!acquired) throw conflict('Your previous submission is still being saved — try again in a moment.');
  return saved;
}

async function record(user, course, assessment, result) {
  const opts = { userId: user.id };
  await entities.QuizAttempt.create({
    user_id: user.id, course_id: course.id, assessment_id: assessment?.id, type: 'final',
    score: result.score, total: result.total, percentage: result.percentage, passed: result.passed,
  }, opts);

  const progress = await entities.CourseProgress.findOne({ user_id: user.id, course_id: course.id });
  const patch = {
    final_score: Math.max(progress?.final_score || 0, result.percentage),
    final_passed: !!progress?.final_passed || result.passed,
  };
  if (progress) await entities.CourseProgress.update(progress.id, patch);
  else {
    await entities.CourseProgress.create({
      user_id: user.id, course_id: course.id, completed_lessons: [], completed_chapters: [], started: true, ...patch,
    }, opts);
  }

  let certificateId = null;
  if (result.passed) {
    const cert = await entities.Certificate.findOne({ user_id: user.id, course_id: course.id })
      || await entities.Certificate.create({
        user_id: user.id, course_id: course.id, course_title: course.title,
        user_name: user.full_name || user.email, score: result.percentage,
        completion_date: new Date().toISOString().slice(0, 10), certificate_id: newCertificateId(),
      }, opts);
    certificateId = cert.certificate_id;
  }
  return { ...result, certificate_id: certificateId };
}
