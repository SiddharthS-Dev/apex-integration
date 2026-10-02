import { api } from '@/api/client';
import { sortByOrder } from '@/lib/progress';

// Data helpers for the admin course editor.

export const editorKey = (courseId) => ['admin-course-editor', courseId];

export async function loadEditor(courseId) {
  const E = api.entities;
  const [course, modules] = await Promise.all([
    E.Course.get(courseId),
    E.Module.filter({ course_id: courseId }, 'order', 500),
  ]);
  const lessonLists = await Promise.all(modules.map((m) => E.Lesson.filter({ module_id: m.id }, 'order', 500)));
  return { course, modules: sortByOrder(modules), lessons: sortByOrder(lessonLists.flat()) };
}

// Recounts lessons per module and updates Module.lesson_count + Course counts.
export async function syncCounts(courseId) {
  const E = api.entities;
  const modules = await E.Module.filter({ course_id: courseId }, 'order', 500);
  const lessonLists = await Promise.all(modules.map((m) => E.Lesson.filter({ module_id: m.id }, 'order', 500)));
  await Promise.all(
    modules.map((m, i) =>
      (m.lesson_count || 0) !== lessonLists[i].length
        ? E.Module.update(m.id, { lesson_count: lessonLists[i].length })
        : null,
    ),
  );
  const lessonCount = lessonLists.reduce((sum, list) => sum + list.length, 0);
  await E.Course.update(courseId, { module_count: modules.length, lesson_count: lessonCount });
}

export function reorder(list, from, to) {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, i) => ({ ...item, order: i }));
}

// Persists `order` only for records whose position changed.
export function persistOrder(entityName, items, previous) {
  const prevOrder = Object.fromEntries(previous.map((p) => [p.id, p.order]));
  return Promise.all(
    items
      .filter((item) => prevOrder[item.id] !== item.order)
      .map((item) => api.entities[entityName].update(item.id, { order: item.order })),
  );
}

export function nextOrder(items) {
  return items.reduce((max, i) => Math.max(max, (i.order ?? 0) + 1), 0);
}
