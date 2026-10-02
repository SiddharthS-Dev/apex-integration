import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { sortByOrder } from '@/lib/progress';

const COURSE_PRIORITY = { pending_review: 0, published: 1, draft: 2, archived: 3 };

export function pickCourse(courses = []) {
  return [...courses].sort((a, b) => {
    const pa = COURSE_PRIORITY[a.status] ?? 9;
    const pb = COURSE_PRIORITY[b.status] ?? 9;
    if (pa !== pb) return pa - pb;
    return (Number(b.version) || 0) - (Number(a.version) || 0);
  })[0] || null;
}

// Filters an entity by a list of ids, falling back to per-id queries if $in is unsupported.
async function filterIn(entityName, field, ids) {
  if (!ids.length) return [];
  const entity = api.entities[entityName];
  try {
    return await entity.filter({ [field]: { $in: ids } }, undefined, 5000);
  } catch {
    const lists = await Promise.all(ids.map((id) => entity.filter({ [field]: id })));
    return lists.flat();
  }
}

async function loadStudio(playbookId) {
  const [playbook, courses, chapters] = await Promise.all([
    api.entities.Playbook.get(playbookId),
    api.entities.Course.filter({ playbook_id: playbookId }),
    api.entities.Chapter.filter({ playbook_id: playbookId }),
  ]);
  const course = pickCourse(courses);
  const base = { playbook, courses, course, chapters: sortByOrder(chapters.map((c) => ({ ...c, order: Number(c.number) || 0 }))) };
  if (!course) return { ...base, modules: [], lessons: [], questions: [], flashcards: [], assessments: [] };

  const [modules, assessments] = await Promise.all([
    api.entities.Module.filter({ course_id: course.id }),
    api.entities.Assessment.filter({ course_id: course.id }),
  ]);
  const lessons = await filterIn('Lesson', 'module_id', modules.map((m) => m.id));
  const lessonIds = lessons.map((l) => l.id);
  const [lessonQuestions, assessmentQuestions, flashcards] = await Promise.all([
    filterIn('Question', 'lesson_id', lessonIds),
    filterIn('Question', 'assessment_id', assessments.map((a) => a.id)),
    filterIn('Flashcard', 'lesson_id', lessonIds),
  ]);
  const byId = new Map([...lessonQuestions, ...assessmentQuestions].map((q) => [q.id, q]));
  return {
    ...base,
    modules: sortByOrder(modules),
    lessons,
    questions: [...byId.values()],
    flashcards,
    assessments,
  };
}

export default function useStudioData(playbookId) {
  return useQuery({
    queryKey: ['studio', playbookId],
    queryFn: () => loadStudio(playbookId),
    enabled: !!playbookId,
    refetchInterval: (query) => (query.state.data?.lessons?.some((l) => l.status === 'generating') ? 4000 : false),
  });
}
