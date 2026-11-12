import { canSeeCategory, gradeQuiz, loadQuizPool } from '@academy/shared';
import { badRequest, notFound, unauthorized } from '../lib/errors.js';
import { entities } from '../repo/entities.js';

// submitQuiz — grades a lesson quiz or a chapter test on the server and records the attempt.
//
// Learners never receive the answers before answering (question reads strip them), so the browser
// cannot score an attempt: it sends the selected options and gets back the score and a review with
// the correct answers and explanations. The attempt (and, for a passed chapter test, the chapter's
// completion) is written here; learners cannot create quiz attempts themselves.
//
// Payload: { type: 'lesson', lesson_id, answers } | { type: 'chapter', module_id, answers }
//   answers: [{ question_id, selected }] — one per question of the quiz, selected null if skipped.
// Returns: { score, total, percentage, passed, passing_score, answers: [review…] }

const filter = (name, query, sort, limit) => entities[name].filter(query, sort, limit);

async function visibleCourse(user, courseId) {
  const course = courseId ? await entities.Course.get(courseId) : null;
  if (!course || course.status !== 'published') throw notFound('Course not found');
  if (!canSeeCategory(user, course.category, await entities.PlaybookCategory.filter({}, null, 1000))) throw notFound('Course not found');
  return course;
}

export default async function submitQuiz(payload = {}, ctx = {}) {
  const user = ctx.user;
  if (!user) throw unauthorized();
  const type = payload?.type;
  let lesson = null;
  let mod = null;
  if (type === 'lesson') {
    lesson = payload.lesson_id ? await entities.Lesson.get(String(payload.lesson_id)) : null;
    if (!lesson || lesson.status !== 'approved') throw notFound('Lesson not found');
    mod = await entities.Module.get(lesson.module_id);
  } else if (type === 'chapter') {
    mod = payload.module_id ? await entities.Module.get(String(payload.module_id)) : null;
  } else {
    throw badRequest('type must be "lesson" or "chapter"');
  }
  if (!mod) throw notFound(type === 'lesson' ? 'Lesson not found' : 'Chapter not found');
  const course = await visibleCourse(user, mod.course_id);

  const pool = await loadQuizPool(filter, { type, lessonId: lesson?.id, moduleId: mod.id });
  if (!pool.questions.length) throw badRequest('This quiz has no questions yet.');
  const result = gradeQuiz(pool, payload.answers);
  if (!result) throw badRequest('These answers do not match this quiz — reload the page and try again.');

  const opts = { userId: user.id };
  await entities.QuizAttempt.create({
    user_id: user.id, course_id: course.id, module_id: mod.id, ...(lesson ? { lesson_id: lesson.id } : {}),
    assessment_id: pool.assessment?.id, type,
    score: result.score, total: result.total, percentage: result.percentage, passed: result.passed,
  }, opts);

  if (type === 'chapter' && result.passed) {
    const progress = await entities.CourseProgress.findOne({ user_id: user.id, course_id: course.id });
    const completed = Array.from(new Set([...(progress?.completed_chapters || []), mod.id]));
    if (progress) await entities.CourseProgress.update(progress.id, { completed_chapters: completed });
    else await entities.CourseProgress.create({ user_id: user.id, course_id: course.id, completed_lessons: [], completed_chapters: completed, started: true }, opts);
  }
  return result;
}
