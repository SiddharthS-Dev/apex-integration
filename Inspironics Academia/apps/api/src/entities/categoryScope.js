import { allowedCategories } from '@academy/shared';
import * as repo from '../repo/entities.js';

// Role-based access to playbook content, enforced on every entity read (not only hidden in the UI).
// A playbook's category decides which audiences see it (see audience.js); its courses carry the same
// category, and everything inside a course — modules, lessons, questions, flashcards, assessments —
// is visible only through a course the user may see. Administrators are not restricted.
//
// scopeFor(name, user) → null (no restriction) or an extra filter query for that entity, computed
// once per request.

export const SCOPED = new Set(['Playbook', 'Course', 'Module', 'Lesson', 'Question', 'Flashcard', 'Assessment']);

const LIMIT = 100_000;
const ids = (rows) => rows.map((r) => r.id);

export function createScope(user) {
  const memo = new Map();
  const once = (key, fn) => {
    if (!memo.has(key)) memo.set(key, fn());
    return memo.get(key);
  };

  const categories = () => once('categories', async () => allowedCategories(user, await repo.list('PlaybookCategory', { limit: 1000 })));
  const courseIds = () => once('courses', async () => ids(await repo.list('Course', { query: { category: { $in: await categories() } }, limit: LIMIT })));
  const moduleIds = () => once('modules', async () => ids(await repo.list('Module', { query: { course_id: { $in: await courseIds() } }, limit: LIMIT })));
  const lessonIds = () => once('lessons', async () => ids(await repo.list('Lesson', { query: { module_id: { $in: await moduleIds() } }, limit: LIMIT })));
  const assessmentIds = () => once('assessments', async () => ids(await repo.list('Assessment', { query: { course_id: { $in: await courseIds() } }, limit: LIMIT })));

  return async function scopeFor(name) {
    if (!SCOPED.has(name) || user?.role === 'admin') return null;
    switch (name) {
      case 'Playbook': return { category: { $in: await categories() } };
      case 'Course': return { category: { $in: await categories() } };
      case 'Module': return { course_id: { $in: await courseIds() } };
      case 'Assessment': return { course_id: { $in: await courseIds() } };
      case 'Lesson': return { module_id: { $in: await moduleIds() } };
      case 'Flashcard': return { lesson_id: { $in: await lessonIds() } };
      case 'Question': return { $or: [{ lesson_id: { $in: await lessonIds() } }, { assessment_id: { $in: await assessmentIds() } }] };
      default: return null;
    }
  };
}
