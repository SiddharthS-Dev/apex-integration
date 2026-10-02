import { api } from '@/api/client';

export const QUESTIONS_KEY = ['admin-questions'];

// Loads questions plus everything needed to resolve each question's course.
export async function loadQuestionData() {
  const E = api.entities;
  const [questions, assessments, lessons, modules, courses] = await Promise.all([
    E.Question.list('-created_date', 1000),
    E.Assessment.list('-created_date', 500),
    E.Lesson.list('-created_date', 2000),
    E.Module.list('-created_date', 1000),
    E.Course.list('-updated_date', 500),
  ]);
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
  const assessmentMap = byId(assessments);
  const lessonMap = byId(lessons);
  const moduleMap = byId(modules);
  const courseMap = byId(courses);

  // assessment_id → Assessment.course_id, else lesson_id → Lesson → Module → Course.
  const contextOf = (q) => {
    const assessment = assessmentMap[q.assessment_id];
    const lesson = lessonMap[q.lesson_id];
    const courseId = assessment?.course_id || moduleMap[lesson?.module_id]?.course_id || null;
    return { assessment, lesson, course: courseMap[courseId] || null };
  };
  const context = Object.fromEntries(questions.map((q) => [q.id, contextOf(q)]));
  return { questions, courses, context };
}

// Resolves the index of the correct option (exact match, else "A"–"D" letter).
export function correctIndex(question) {
  const options = question.options || [];
  const answer = (question.correct_answer || '').trim();
  const exact = options.findIndex((o) => o.trim() === answer);
  if (exact >= 0) return exact;
  if (/^[A-Da-d]$/.test(answer)) return answer.toUpperCase().charCodeAt(0) - 65;
  return -1;
}
