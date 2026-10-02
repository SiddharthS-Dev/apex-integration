import { api } from '@/api/client';

const approved = (q) => q.status === 'approved';

function sample(items, n) {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

// Picks questions from the first assessment (in preference order) that has approved
// questions; otherwise falls back to approved lesson questions of `lessonIds`.
export default async function loadTestQuestions({ assessments = [], lessonIds = [], limit }) {
  for (const assessment of assessments) {
    const qs = (await api.entities.Question.filter({ assessment_id: assessment.id }, 'created_date', 500)).filter(approved);
    if (qs.length) return { assessment, questions: qs };
  }
  if (!lessonIds.length) return { assessment: null, questions: [] };
  const qs = (await api.entities.Question.filter({ lesson_id: { $in: lessonIds } }, 'created_date', 1000)).filter(
    (q) => approved(q) && !q.assessment_id,
  );
  return { assessment: null, questions: limit ? sample(qs, limit) : qs };
}
