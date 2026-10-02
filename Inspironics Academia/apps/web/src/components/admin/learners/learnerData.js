import { api } from '@/api/client';

export const LEARNERS_KEY = ['admin-learners'];
export const FEEDBACK_KEY = ['admin-feedback'];

const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));
const isCompleted = (p) => (p.percentage || 0) >= 100 || !!p.final_passed;

export async function loadLearnerData() {
  const E = api.entities;
  const [users, progress, attempts, certificates, courses] = await Promise.all([
    E.User.list(),
    E.CourseProgress.list('-updated_date', 2000),
    E.QuizAttempt.list('-created_date', 2000),
    E.Certificate.list('-created_date', 1000),
    E.Course.list('-updated_date', 500),
  ]);
  const courseMap = byId(courses);
  const rows = users.map((user) => {
    const mine = progress.filter((p) => p.user_id === user.id);
    const quizzes = attempts.filter((a) => a.user_id === user.id);
    const certs = certificates.filter((c) => c.user_id === user.id);
    return {
      user,
      progress: mine,
      attempts: quizzes,
      certificates: certs,
      started: mine.length,
      completed: mine.filter(isCompleted).length,
      avgQuiz: quizzes.length ? Math.round(quizzes.reduce((s, a) => s + (a.percentage || 0), 0) / quizzes.length) : null,
    };
  });
  return { rows, courseMap };
}

export async function loadFeedbackData() {
  const E = api.entities;
  const [feedback, lessons, users, courses] = await Promise.all([
    E.LessonFeedback.list('-created_date', 500),
    E.Lesson.list('-created_date', 2000),
    E.User.list(),
    E.Course.list('-updated_date', 500),
  ]);
  return { feedback, lessonMap: byId(lessons), userMap: byId(users), courseMap: byId(courses) };
}

export { isCompleted };
