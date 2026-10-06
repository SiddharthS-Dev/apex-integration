// The final course test, graded where the learner cannot touch it. The API (and the demo driver)
// rebuild the course's question pool, check the submitted answers against it and score them, so a
// certificate only ever follows a passing set of answers to the course's real final test.
//
// The pool mirrors what the FinalTest page shows: the first published certification (then course)
// assessment with approved questions, all of them; otherwise a sample of the approved questions of
// the course's approved lessons.
//
// `filter(entity, query, sort, limit)` is the caller's data access; it may return rows or a promise.

export const FINAL_TEST_SAMPLE = 30;
export const DEFAULT_PASSING_SCORE = 70;

const PREFERRED_TYPES = ['certification', 'course_assessment'];
const approved = (q) => q.status === 'approved';

/** Returns { assessment, questions, count } — `count` is how many questions a sitting has. */
export async function loadFinalTestPool(filter, courseId) {
  const assessments = (await filter('Assessment', { course_id: courseId }, '-created_date', 100))
    .filter((a) => a.status === 'published');
  for (const type of PREFERRED_TYPES) {
    for (const assessment of assessments.filter((a) => a.type === type)) {
      const questions = (await filter('Question', { assessment_id: assessment.id }, 'created_date', 500)).filter(approved);
      if (questions.length) return { assessment, questions, count: questions.length };
    }
  }

  const modules = await filter('Module', { course_id: courseId }, 'order', 200);
  const lessons = modules.length
    ? await filter('Lesson', { module_id: { $in: modules.map((m) => m.id) } }, 'order', 1000)
    : [];
  const lessonIds = lessons.filter((l) => l.status === 'approved').map((l) => l.id);
  const questions = lessonIds.length
    ? (await filter('Question', { lesson_id: { $in: lessonIds } }, 'created_date', 1000)).filter(
      (q) => approved(q) && !q.assessment_id,
    )
    : [];
  return { assessment: null, questions, count: Math.min(FINAL_TEST_SAMPLE, questions.length) };
}

/**
 * Scores `answers` ([{ question_id, selected }]) against `pool`. Returns null when they are not one
 * sitting of this test: an unknown or repeated question, or the wrong number of questions.
 */
export function gradeFinalTest(pool, answers) {
  const byId = new Map(pool.questions.map((q) => [q.id, q]));
  const chosen = new Map();
  for (const a of Array.isArray(answers) ? answers : []) {
    const id = String(a?.question_id ?? '');
    if (!byId.has(id) || chosen.has(id)) return null;
    chosen.set(id, a.selected == null ? null : String(a.selected));
  }
  if (!pool.count || chosen.size !== pool.count) return null;

  let score = 0;
  let total = 0;
  for (const [id, selected] of chosen) {
    const q = byId.get(id);
    const marks = Number(q.marks) || 1;
    total += marks;
    if (selected != null && selected === q.correct_answer) score += marks;
  }
  const percentage = total ? Math.round((score / total) * 100) : 0;
  const passingScore = pool.assessment?.passing_score ?? DEFAULT_PASSING_SCORE;
  return { score, total, percentage, passed: percentage >= passingScore, passing_score: passingScore };
}

const ID_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/** A certificate's public id, e.g. IEA-MFX3K2A1-7QZ0PD. */
export function newCertificateId() {
  const rand = Array.from(globalThis.crypto.getRandomValues(new Uint8Array(6)), (b) => ID_ALPHABET[b % 36]).join('');
  return `IEA-${Date.now().toString(36).toUpperCase()}-${rand}`;
}
