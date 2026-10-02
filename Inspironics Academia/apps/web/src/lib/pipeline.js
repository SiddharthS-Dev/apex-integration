import { api } from '@/api/client';

const errorMessage = (err) => err?.response?.data?.error || err?.message || 'Unknown error';

// Runs extraction then structuring for a playbook.
// Returns { ok, skipped, extract, structure, error }.
export async function runPlaybookPipeline(playbookId, { force = false, skipExtract = false } = {}) {
  let extract = null;
  try {
    if (!skipExtract) {
      const res = await api.functions.invoke('processPlaybookExtract', { playbook_id: playbookId });
      extract = res?.data;
      if (extract && extract.ok === false) throw new Error(extract.error || 'Extraction failed');
    }
    const res = await api.functions.invoke('processPlaybookStructure', { playbook_id: playbookId, force });
    const structure = res?.data;
    if (structure?.skipped || structure?.skip) {
      return { ok: false, skipped: true, extract, structure, error: structure.reason || structure.message };
    }
    if (structure && structure.ok === false) throw new Error(structure.error || 'Structuring failed');
    return { ok: true, skipped: false, extract, structure };
  } catch (err) {
    return { ok: false, skipped: false, extract, error: errorMessage(err) };
  }
}

// Sequentially invokes a function over items, collecting failures without aborting.
// If the very first call answers 503 (feature disabled on the server, e.g. MEDIA_PROVIDER=none or
// AI_ENABLED=false) the loop stops early instead of failing every remaining item the same way.
async function runSequential(items, fnName, toPayload, onProgress) {
  const failures = [];
  const total = items.length;
  onProgress?.({ done: 0, total, current: items[0] });
  for (let i = 0; i < total; i++) {
    const item = items[i];
    try {
      const res = await api.functions.invoke(fnName, toPayload(item));
      if (res?.data && res.data.ok === false) throw new Error(res.data.error || 'Failed');
    } catch (err) {
      if (i === 0 && err?.status === 503) {
        return { total, failed: 0, succeeded: 0, failures: [], unavailable: true, error: errorMessage(err) };
      }
      failures.push({ item, error: errorMessage(err) });
    }
    onProgress?.({ done: i + 1, total, current: items[i + 1] });
  }
  return { total, failed: failures.length, succeeded: total - failures.length, failures };
}

export function generateLessons(lessons = [], onProgress) {
  return runSequential(lessons, 'generateLessonContent', (l) => ({ lesson_id: l.id }), onProgress);
}

export function generateMedia(lessons = [], onProgress) {
  return runSequential(lessons, 'generateLessonMedia', (l) => ({ lesson_id: l.id }), onProgress);
}

export function generateTests(course, modules = [], onProgress) {
  const jobs = [
    ...modules.map((m) => ({ id: m.id, title: m.title, payload: { course_id: course.id, type: 'module_test', module_id: m.id } })),
    { id: course.id, title: course.title, payload: { course_id: course.id, type: 'course_assessment' } },
  ];
  return runSequential(jobs, 'generateAssessment', (j) => j.payload, onProgress);
}

// Updates records in small concurrent batches.
export async function updateMany(entityName, items = [], data, batchSize = 8) {
  const entity = api.entities[entityName];
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map((item) => entity.update(item.id, data)));
  }
  return items.length;
}

// Approves every piece of reviewable content for a course (explicitly rejected items are left alone).
export async function approveAll({ lessons = [], questions = [], flashcards = [], assessments = [] }) {
  const reviewable = (x) => x.status === 'pending_review';
  const pendingLessons = lessons.filter(reviewable);
  const pendingQuestions = questions.filter(reviewable);
  const pendingCards = flashcards.filter(reviewable);
  const pendingAssessments = assessments.filter(reviewable);
  await updateMany('Lesson', pendingLessons, { status: 'approved' });
  await updateMany('Question', pendingQuestions, { status: 'approved' });
  await updateMany('Flashcard', pendingCards, { status: 'approved' });
  await updateMany('Assessment', pendingAssessments, { status: 'approved' });
  return {
    lessons: pendingLessons.length,
    questions: pendingQuestions.length,
    flashcards: pendingCards.length,
    assessments: pendingAssessments.length,
  };
}

// Approves everything, publishes assessments, the course and the playbook.
export async function publishCourse({ playbook, course, lessons, questions, flashcards, assessments }) {
  const counts = await approveAll({ lessons, questions, flashcards, assessments });
  await updateMany('Assessment', assessments.filter((a) => a.status !== 'published'), { status: 'published' });
  await api.entities.Course.update(course.id, { status: 'published', published: true });
  if (playbook?.id) await api.entities.Playbook.update(playbook.id, { status: 'published' });
  return counts;
}
