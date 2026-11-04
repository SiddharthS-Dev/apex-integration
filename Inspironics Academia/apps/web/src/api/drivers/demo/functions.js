import {
  FUNCTIONS, certificateStatus, complianceReport, gradeFinalTest, issueCertificate, loadFinalTestPool, loadReviewQueue,
  myRecertifications, recordReview, resolveToday, runComplianceChecks, waiveRecertification,
} from '@academy/shared';
import { ApiError } from '@/api/drivers/http';
import { currentUser } from '@/api/drivers/demo/store';
import { badRequest, forbidden, notFound, unauthorized } from '@/api/drivers/demo/records';
import { findAll, findOne, insert, patch, persist, removeWhere, sleep } from '@/api/drivers/demo/service';
import { notify, store } from '@/api/drivers/demo/backend';
import { processPlaybookExtract, processPlaybookStructure } from '@/api/drivers/demo/pipeline';
import { generateAssessment, generateLessonContent } from '@/api/drivers/demo/generate';
import { processMeeting, publishMeeting } from '@/api/drivers/demo/meetings';

// Backend functions for the demo driver — same names, auth rules and result shapes as POST /api/functions/:name.

// Same contract as the API's deletePlaybooks: generated content goes, learner records stay. The demo
// has no Dropbox sync, so keep_out_of_sync has nothing to remember.
function deletePlaybooks({ playbook_ids: requested, all } = {}) {
  const ids = all ? findAll('Playbook').map((p) => p.id) : (Array.isArray(requested) ? requested.map(String) : []);
  if (!ids.length) throw badRequest('playbook_ids (or all: true) is required');
  const pbIds = findAll('Playbook', { id: { $in: ids } }).map((p) => p.id);
  const courseIds = findAll('Course', { playbook_id: { $in: pbIds } }).map((c) => c.id);
  const moduleIds = findAll('Module', { course_id: { $in: courseIds } }).map((m) => m.id);
  const lessonIds = findAll('Lesson', { module_id: { $in: moduleIds } }).map((l) => l.id);
  const assessmentIds = findAll('Assessment', { course_id: { $in: courseIds } }).map((a) => a.id);
  removeWhere('Question', { $or: [{ lesson_id: { $in: lessonIds } }, { assessment_id: { $in: assessmentIds } }] });
  removeWhere('Flashcard', { lesson_id: { $in: lessonIds } });
  removeWhere('Lesson', { id: { $in: lessonIds } });
  removeWhere('Assessment', { id: { $in: assessmentIds } });
  removeWhere('Module', { id: { $in: moduleIds } });
  removeWhere('Course', { id: { $in: courseIds } });
  removeWhere('Chapter', { playbook_id: { $in: pbIds } });
  removeWhere('PlaybookVersion', { playbook_id: { $in: pbIds } });
  removeWhere('Playbook', { id: { $in: pbIds } });
  persist();
  return { ok: true, deleted: pbIds.length, kept_out_of_sync: 0 };
}

// Same contract as the API's classifyPlaybooks: moves playbooks to a category (a manual assignment,
// copied to their courses) and optionally sets department, technologies, skill level and tags.
function classifyPlaybooks({ playbook_ids: requested, category, department, tech_tags: techTags, skill_level: skill, tags } = {}) {
  const ids = Array.isArray(requested) ? requested.map(String) : [];
  if (!ids.length) throw badRequest('playbook_ids is required');
  const known = new Set(['unclassified', ...findAll('PlaybookCategory').map((c) => c.key)]);
  if (category !== undefined && !known.has(category)) throw badRequest(`Unknown category ${category}`);
  if (skill !== undefined && !['', 'beginner', 'intermediate', 'advanced'].includes(skill)) throw badRequest('skill_level must be beginner, intermediate or advanced');
  let updated = 0;
  for (const p of findAll('Playbook', { id: { $in: ids } })) {
    const change = {};
    if (category !== undefined) Object.assign(change, { category, category_source: 'manual' });
    if (department !== undefined) change.department = String(department).trim();
    if (Array.isArray(techTags)) change.tech_tags = techTags;
    if (skill !== undefined) change.skill_level = skill;
    if (Array.isArray(tags)) change.tags = tags;
    patch('Playbook', p.id, change);
    if (category !== undefined) for (const c of findAll('Course', { playbook_id: p.id })) patch('Course', c.id, { category });
    updated += 1;
  }
  persist();
  return { ok: true, updated };
}

const handlers = {
  deletePlaybooks,
  classifyPlaybooks,
  processMeeting,
  publishMeeting,
  processPlaybookExtract,
  processPlaybookStructure,
  generateLessonContent,
  generateAssessment,
  // Mirrors the API default (MEDIA_PROVIDER=none).
  async generateLessonMedia() {
    await sleep(200);
    throw new ApiError(503, 'Media generation is disabled (MEDIA_PROVIDER=none)');
  },
  async generateMeetingVideo() {
    await sleep(200);
    throw new ApiError(503, 'Media generation is disabled (MEDIA_PROVIDER=none)');
  },
  // Same contract as the API's submitFinalTest: grade here, never trust the browser's score.
  async submitFinalTest({ course_id: courseId, answers, today } = {}, { user }) {
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
      const cert = await issueCertificate(store, user, course, result, { today: resolveToday(today), notify });
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
      status: certificateStatus(cert, resolveToday()), expires_date: cert.expires_date || '', superseded_by: cert.superseded_by || '',
    };
  },
  async getReviewQueue({ today } = {}, { user }) {
    return loadReviewQueue(store, user, { today: resolveToday(today) });
  },
  async submitFlashcardReview({ flashcard_id: flashcardId, quality, today } = {}, { user }) {
    let saved;
    try {
      saved = await recordReview(store, user, { flashcard_id: flashcardId, quality, today: resolveToday(today) });
    } catch (e) {
      throw badRequest(e.message);
    }
    if (!saved) throw notFound('Flashcard not found');
    persist();
    return saved;
  },
  async getMyRecertifications({ today } = {}, { user }) {
    return myRecertifications(store, user, { today: resolveToday(today) });
  },
  async getComplianceReport({ today } = {}) {
    return complianceReport(store, { today: resolveToday(today) });
  },
  async waiveRecertification({ id, reason } = {}) {
    const updated = id ? await waiveRecertification(store, String(id), { reason }) : null;
    if (!updated) throw notFound('No open recertification with that id');
    persist();
    return updated;
  },
  async runComplianceChecks({ today } = {}) {
    const summary = await runComplianceChecks(store, { today: resolveToday(today), notify });
    persist();
    return summary;
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
