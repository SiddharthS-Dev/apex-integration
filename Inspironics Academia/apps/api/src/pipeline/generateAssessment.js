import { invokeLLM, requireAI } from '../ai/claude.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { asHttpError, cleanMcq, errMsg, norm, pipelineError } from './util.js';

// generateAssessment — generate a module test, course assessment or certification exam. Requires AI.
//
// Payload: { course_id, type: 'module_test' | 'course_assessment' | 'certification', module_id? }
// Returns: { ok: true, assessment_id, type, question_count, warnings? }

const CONFIG = {
  module_test: { count: 15, duration: 30, label: 'Module Test' },
  course_assessment: { count: 50, duration: 60, label: 'Final Assessment' },
  certification: { count: 60, duration: 90, label: 'Certification Exam' },
};
const PASSING_SCORE = 70;
const MAX_PER_BATCH = 20;
const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];
const COGNITIVE = ['recall', 'understanding', 'application', 'analysis'];

/** Distribute `total` questions across `n` lessons as evenly as possible. */
export function allocate(total, n) {
  const counts = new Array(n).fill(0);
  if (n === 0) return counts;
  if (n >= total) {
    // More lessons than questions: one question each across evenly spaced lessons.
    for (let k = 0; k < total; k++) counts[Math.floor((k * n) / total)] = 1;
    return counts;
  }
  const base = Math.floor(total / n);
  const extra = total - base * n;
  for (let i = 0; i < n; i++) counts[i] = base;
  for (let k = 0; k < extra; k++) counts[Math.floor((k * n) / extra)] += 1;
  return counts;
}

const SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          lesson_index: { type: 'integer' },
          question_text: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
          explanation: { type: 'string' },
          difficulty: { type: 'string', enum: DIFFICULTIES },
          cognitive_level: { type: 'string', enum: COGNITIVE },
          source_section: { type: 'string' },
        },
      },
    },
  },
};

export default async function generateAssessment(payload = {}, ctx = {}) {
  const log = ctx.log || defaultLog;
  const courseId = payload?.course_id ? String(payload.course_id) : '';
  const type = payload?.type || 'course_assessment';
  const moduleId = payload?.module_id ? String(payload.module_id) : '';
  if (!courseId) throw badRequest('course_id is required');
  const cfg = CONFIG[type];
  if (!cfg) throw badRequest(`Invalid type "${type}"`);
  if (type === 'module_test' && !moduleId) throw badRequest('module_id is required for module_test');
  requireAI();

  const sr = entities;
  const course = await sr.Course.get(courseId);
  if (!course) throw notFound('Course not found');
  const playbook = course.playbook_id ? await sr.Playbook.get(course.playbook_id) : null;

  let modules;
  if (moduleId) {
    const m = await sr.Module.get(moduleId);
    if (!m) throw notFound('Module not found');
    modules = [m];
  } else {
    modules = (await sr.Module.filter({ course_id: courseId })).sort((a, b) => (a.order || 0) - (b.order || 0));
  }

  try {
    const lessons = [];
    for (const m of modules) {
      const ls = (await sr.Lesson.filter({ module_id: m.id }))
        .filter((l) => l.status !== 'rejected')
        .sort((a, b) => (a.order || 0) - (b.order || 0));
      for (const l of ls) lessons.push({ ...l, _module: m });
    }
    if (!lessons.length) throw pipelineError('No lessons found to build the assessment from.');

    // Chapter content is the fallback for lessons without generated content yet.
    const chapters = playbook ? await sr.Chapter.filter({ playbook_id: playbook.id }) : [];
    const chapterFor = (title) => {
      const t = norm(title);
      if (!t) return null;
      return chapters.find((c) => norm(c.title) === t) || chapters.find((c) => {
        const ct = norm(c.title);
        return ct && (ct.includes(t) || t.includes(ct));
      }) || null;
    };

    const digestFor = (l, idx) => {
      const parts = [
        `### LESSON ${idx}: ${l.title}`,
        `Module: ${l._module.title}`,
        `Source: chapter "${l.source_chapter || ''}", section "${l.source_section || ''}"`,
        l.teaching_objective ? `Objective: ${l.teaching_objective}` : '',
        l.summary ? `Summary: ${l.summary}` : '',
        l.key_points ? `Key points:\n${String(l.key_points).slice(0, 1500)}` : '',
        l.examples ? `Examples:\n${String(l.examples).slice(0, 1200)}` : '',
      ];
      if (!l.summary && !l.key_points) {
        const ch = chapterFor(l.source_chapter);
        if (ch?.content) {
          let excerpt = String(ch.content);
          const sec = String(l.source_section || '').trim();
          const pos = sec ? excerpt.toLowerCase().indexOf(sec.toLowerCase()) : -1;
          excerpt = pos >= 0 ? excerpt.slice(pos, pos + 2500) : excerpt.slice(0, 2500);
          parts.push(`Source excerpt:\n"""\n${excerpt}\n"""`);
        }
      }
      return parts.filter(Boolean).join('\n');
    };

    // Allocate questions across lessons, then batch lessons (≤ MAX_PER_BATCH questions per LLM call).
    const counts = allocate(cfg.count, lessons.length);
    const batches = [];
    let current = { items: [], total: 0 };
    lessons.forEach((lesson, i) => {
      if (!counts[i]) return;
      if (current.total + counts[i] > MAX_PER_BATCH && current.items.length) {
        batches.push(current);
        current = { items: [], total: 0 };
      }
      current.items.push({ lesson, idx: i + 1, count: counts[i] });
      current.total += counts[i];
    });
    if (current.items.length) batches.push(current);

    const scopeLabel = type === 'module_test' ? `module "${modules[0].title}"` : `course "${course.title}"`;

    const runBatch = async (batch, batchNo) => {
      const plan = batch.items.map((it) => `- LESSON ${it.idx} ("${it.lesson.title}"): ${it.count} question(s)`).join('\n');
      const prompt = `You are a certification exam author for an engineering academy. Write questions for the ${cfg.label} of the ${scopeLabel}${playbook ? ` (source playbook: "${playbook.title}")` : ''}.
This is batch ${batchNo} of ${batches.length}; write EXACTLY ${batch.total} questions following this allocation:
${plan}

Requirements:
- Multiple choice with exactly 4 distinct, plausible options and one unambiguously correct answer.
- "correct_answer" must be copied EXACTLY from one of the options (never a letter).
- Spread questions across the lessons as allocated; set "lesson_index" to the lesson number the question tests.
- Mixed difficulty: about 30% basic, 45% intermediate, 25% advanced.
- Mixed cognitive level (recall, understanding, application, analysis), with at least half being SCENARIO-BASED application/analysis questions: describe a realistic engineering situation (an incident, a code review, a design decision, a deployment) and ask what the engineer should do or conclude according to the playbook.
- "explanation": 1-3 sentences explaining why the answer is correct, grounded in the lesson content.
- "source_section": the section the question tests (use the lesson's source section).
- No trick questions, no "all/none of the above", no questions answerable without knowing the material, and no duplicates.
- Use only the facts in the lesson material below.

LESSON MATERIAL
${batch.items.map((it) => digestFor(it.lesson, it.idx)).join('\n\n')}`;
      const res = await invokeLLM({ prompt, schema: SCHEMA, maxTokens: 32000 });
      return { batch, questions: Array.isArray(res?.questions) ? res.questions : [] };
    };

    const settled = await Promise.allSettled(batches.map((b, i) => runBatch(b, i + 1)));
    const failures = settled.filter((s) => s.status === 'rejected');
    if (failures.length === settled.length) throw pipelineError(`Question generation failed: ${errMsg(failures[0].reason)}`);

    const seen = new Set();
    const records = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { batch, questions } = s.value;
      for (const q of questions) {
        const text = String(q?.question_text || '').trim();
        const key = norm(text);
        if (!text || seen.has(key)) continue;
        const clean = cleanMcq(q);
        if (!clean) continue;
        const item = batch.items.find((it) => it.idx === Math.round(Number(q.lesson_index))) || batch.items[0];
        const lesson = item.lesson;
        seen.add(key);
        records.push({
          question_text: text,
          options: clean.options,
          correct_answer: clean.correct,
          explanation: String(q.explanation || '').trim(),
          difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'intermediate',
          cognitive_level: COGNITIVE.includes(q.cognitive_level) ? q.cognitive_level : 'application',
          source_playbook: lesson.source_playbook || playbook?.title || '',
          source_chapter: lesson.source_chapter || '',
          source_section: String(q.source_section || lesson.source_section || '').trim(),
          marks: 1,
          status: 'pending_review',
        });
      }
    }
    if (!records.length) throw pipelineError('The AI did not return any valid questions.');
    const finalRecords = records.slice(0, cfg.count);

    const title = type === 'module_test' ? `${modules[0].title} — ${cfg.label}` : `${course.title} — ${cfg.label}`;
    const assessment = await sr.Assessment.create({
      course_id: courseId,
      module_id: moduleId || '',
      playbook_id: course.playbook_id || '',
      title,
      type,
      question_count: finalRecords.length,
      passing_score: PASSING_SCORE,
      duration_minutes: cfg.duration,
      status: 'pending_review',
    });
    await sr.Question.bulkCreate(finalRecords.map((r) => ({ ...r, assessment_id: assessment.id })));

    return {
      ok: true,
      assessment_id: assessment.id,
      type,
      question_count: finalRecords.length,
      ...(failures.length ? { warnings: failures.map((f) => errMsg(f.reason)) } : {}),
    };
  } catch (e) {
    log.error('pipeline.assessment.failed', { course_id: courseId, type, error: errMsg(e) });
    throw asHttpError(e);
  }
}
