import { FUNCTIONS, gradeFinalTest, loadFinalTestPool, newCertificateId } from '@academy/shared';
import { ApiError } from '@/api/drivers/http';
import { currentUser } from '@/api/drivers/demo/store';
import { badRequest, forbidden, notFound, unauthorized } from '@/api/drivers/demo/records';
import { findAll, findOne, insert, patch, persist, sleep } from '@/api/drivers/demo/service';
import { processPlaybookExtract, processPlaybookStructure } from '@/api/drivers/demo/pipeline';
import { generateAssessment, generateLessonContent } from '@/api/drivers/demo/generate';

// Backend functions for the demo driver — same names, auth rules and result shapes as POST /api/functions/:name.

const handlers = {
  processPlaybookExtract,
  processPlaybookStructure,
  generateLessonContent,
  generateAssessment,
  // Mirrors the API default (MEDIA_PROVIDER=none).
  async generateLessonMedia() {
    await sleep(200);
    throw new ApiError(503, 'Media generation is disabled (MEDIA_PROVIDER=none)');
  },
  // Same contract as the API's submitFinalTest: grade here, never trust the browser's score.
  async submitFinalTest({ course_id: courseId, answers } = {}, { user }) {
    const course = courseId ? findOne('Course', { id: String(courseId) }) : null;
    if (!course || course.status !== 'published') throw notFound('Course not found');
    const pool = await loadFinalTestPool((name, q, sort, limit) => findAll(name, q, sort).slice(0, limit), course.id);
    if (!pool.count) throw badRequest('This course has no final test yet.');
    const result = gradeFinalTest(pool, answers);
    if (!result) throw badRequest('These answers do not match the final test for this course.');

    insert('QuizAttempt', {
      user_id: user.id, course_id: course.id, assessment_id: pool.assessment?.id, type: 'final',
      score: result.score, total: result.total, percentage: result.percentage, passed: result.passed,
    }, user.id);
    const progress = findOne('CourseProgress', { user_id: user.id, course_id: course.id });
    const progressPatch = {
      final_score: Math.max(progress?.final_score || 0, result.percentage),
      final_passed: !!progress?.final_passed || result.passed,
    };
    if (progress) patch('CourseProgress', progress.id, progressPatch);
    else {
      insert('CourseProgress', {
        user_id: user.id, course_id: course.id, completed_lessons: [], completed_chapters: [], started: true, ...progressPatch,
      }, user.id);
    }

    let certificateId = null;
    if (result.passed) {
      const cert = findOne('Certificate', { user_id: user.id, course_id: course.id }) || insert('Certificate', {
        user_id: user.id, course_id: course.id, course_title: course.title, user_name: user.full_name || user.email,
        score: result.percentage, completion_date: new Date().toISOString().slice(0, 10), certificate_id: newCertificateId(),
      }, user.id);
      certificateId = cert.certificate_id;
    }
    persist();
    return { ...result, certificate_id: certificateId };
  },
  async verifyCertificate({ certificate_id: certId } = {}) {
    const cert = certId ? findOne('Certificate', { certificate_id: String(certId) }) : null;
    if (!cert) return { valid: false };
    return {
      valid: true, user_name: cert.user_name, course_title: cert.course_title, score: cert.score,
      completion_date: cert.completion_date, certificate_id: cert.certificate_id,
    };
  },
};

export function createFunctions() {
  return {
    async invoke(name, payload = {}) {
      const spec = FUNCTIONS[name];
      const handler = handlers[name];
      if (!spec || !handler) throw notFound(`Unknown function ${name}`);
      const user = currentUser();
      if (!spec.public && !user) throw unauthorized();
      if (spec.admin && user?.role !== 'admin') throw forbidden('Administrator access required');
      return { data: await handler(payload || {}, { user }) };
    },
  };
}
