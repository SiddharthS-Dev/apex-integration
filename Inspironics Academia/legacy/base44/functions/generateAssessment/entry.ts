// generateAssessment — generate a module test, course assessment or certification exam.
//
// Payload: { course_id, type: 'module_test' | 'course_assessment' | 'certification', module_id? }   (admin only)
// Returns: { ok: true, assessment_id, type, question_count }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

const CONFIG: Record<string, { count: number; duration: number; label: string }> = {
  module_test: { count: 15, duration: 30, label: 'Module Test' },
  course_assessment: { count: 50, duration: 60, label: 'Final Assessment' },
  certification: { count: 60, duration: 90, label: 'Certification Exam' },
};
const PASSING_SCORE = 70;
const MAX_PER_BATCH = 20;
const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];
const COGNITIVE = ['recall', 'understanding', 'application', 'analysis'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function norm(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function resolveAnswer(options: string[], answer: string): string | null {
  const a = String(answer || '').trim();
  if (!a) return null;
  if (options.includes(a)) return a;
  const ci = options.find((o) => o.trim().toLowerCase() === a.toLowerCase());
  if (ci) return ci;
  const letter = a.match(/^\(?([A-Da-d])[\).:]?$/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (options[idx]) return options[idx];
  }
  const stripped = a.replace(/^\(?[A-Da-d][\).:]\s+/, '').toLowerCase();
  return options.find((o) => o.trim().toLowerCase() === stripped) || null;
}

/** Distribute `total` questions across `n` lessons as evenly as possible. */
function allocate(total: number, n: number): number[] {
  const counts = new Array(n).fill(0);
  if (n === 0) return counts;
  if (n >= total) {
    // More lessons than questions: spread one question each across evenly spaced lessons.
    for (let k = 0; k < total; k++) counts[Math.floor((k * n) / total)] = 1;
    return counts;
  }
  const base = Math.floor(total / n);
  let rem = total - base * n;
  for (let i = 0; i < n; i++) counts[i] = base;
  for (let k = 0; rem > 0; k++, rem--) counts[Math.floor((k * n) / (total - base * n))] += 1;
  return counts;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const courseId: string | undefined = body?.course_id;
    const type: string = body?.type || 'course_assessment';
    const moduleId: string | undefined = body?.module_id;
    if (!courseId) return Response.json({ error: 'course_id is required' }, { status: 400 });
    const cfg = CONFIG[type];
    if (!cfg) return Response.json({ error: `Invalid type "${type}"` }, { status: 400 });
    if (type === 'module_test' && !moduleId) {
      return Response.json({ error: 'module_id is required for module_test' }, { status: 400 });
    }

    const sr = base44.asServiceRole.entities;
    const course = await sr.Course.get(courseId);
    if (!course) return Response.json({ error: 'Course not found' }, { status: 404 });
    const playbook = course.playbook_id ? await sr.Playbook.get(course.playbook_id).catch(() => null) : null;

    let modules: any[];
    if (moduleId) {
      const m = await sr.Module.get(moduleId);
      if (!m) return Response.json({ error: 'Module not found' }, { status: 404 });
      modules = [m];
    } else {
      modules = ((await sr.Module.filter({ course_id: courseId })) || []).sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
    }

    const lessons: any[] = [];
    for (const m of modules) {
      const ls = ((await sr.Lesson.filter({ module_id: m.id })) || [])
        .filter((l: any) => l.status !== 'rejected')
        .sort((a: any, b: any) => (a.order || 0) - (b.order || 0));
      for (const l of ls) lessons.push({ ...l, _module: m });
    }
    if (!lessons.length) throw new Error('No lessons found to build the assessment from.');

    // Chapter content is used as a fallback for lessons without generated content yet.
    const chapters: any[] = playbook ? (await sr.Chapter.filter({ playbook_id: playbook.id })) || [] : [];
    const chapterFor = (title: string) => {
      const t = norm(title);
      if (!t) return null;
      return chapters.find((c) => norm(c.title) === t) || chapters.find((c) => {
        const ct = norm(c.title);
        return ct && (ct.includes(t) || t.includes(ct));
      }) || null;
    };

    const digestFor = (l: any, idx: number) => {
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

    // Allocate questions across lessons, then batch lessons (<= MAX_PER_BATCH questions per LLM call).
    const counts = allocate(cfg.count, lessons.length);
    const batches: { items: { lesson: any; idx: number; count: number }[]; total: number }[] = [];
    let current = { items: [] as { lesson: any; idx: number; count: number }[], total: 0 };
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

    const schema = {
      type: 'object',
      properties: {
        questions: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              lesson_index: { type: 'number' },
              question_text: { type: 'string' },
              options: { type: 'array', items: { type: 'string' } },
              correct_answer: { type: 'string' },
              explanation: { type: 'string' },
              difficulty: { type: 'string', enum: DIFFICULTIES },
              cognitive_level: { type: 'string', enum: COGNITIVE },
              source_section: { type: 'string' },
            },
            required: ['lesson_index', 'question_text', 'options', 'correct_answer', 'explanation', 'difficulty', 'cognitive_level'],
          },
        },
      },
      required: ['questions'],
    };

    const runBatch = async (batch: (typeof batches)[number], batchNo: number) => {
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
      const res = await base44.asServiceRole.integrations.Core.InvokeLLM({ prompt, response_json_schema: schema });
      return { batch, questions: Array.isArray(res?.questions) ? res.questions : [] };
    };

    const settled = await Promise.allSettled(batches.map((b, i) => runBatch(b, i + 1)));
    const failures = settled.filter((s) => s.status === 'rejected') as PromiseRejectedResult[];
    if (failures.length === settled.length) throw new Error(`Question generation failed: ${errMsg(failures[0].reason)}`);

    const seen = new Set<string>();
    const records: any[] = [];
    for (const s of settled) {
      if (s.status !== 'fulfilled') continue;
      const { batch, questions } = s.value;
      for (const q of questions) {
        const text = String(q?.question_text || '').trim();
        const key = norm(text);
        if (!text || seen.has(key)) continue;
        const options = [...new Set((Array.isArray(q.options) ? q.options : []).map((o: any) => String(o || '').trim()).filter(Boolean))] as string[];
        if (options.length < 2) continue;
        const correct = resolveAnswer(options, q.correct_answer);
        if (!correct) continue;
        const item = batch.items.find((it) => it.idx === Math.round(Number(q.lesson_index))) || batch.items[0];
        const lesson = item.lesson;
        seen.add(key);
        records.push({
          question_text: text,
          options: options.slice(0, 4).includes(correct) ? options.slice(0, 4) : [...options.slice(0, 3), correct],
          correct_answer: correct,
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
    if (!records.length) throw new Error('The AI did not return any valid questions.');
    const finalRecords = records.slice(0, cfg.count);

    const title = type === 'module_test'
      ? `${modules[0].title} — ${cfg.label}`
      : `${course.title} — ${cfg.label}`;

    const assessment = await sr.Assessment.create({
      course_id: courseId,
      module_id: type === 'module_test' ? moduleId : (moduleId || ''),
      playbook_id: course.playbook_id || '',
      title,
      type,
      question_count: finalRecords.length,
      passing_score: PASSING_SCORE,
      duration_minutes: cfg.duration,
      status: 'pending_review',
    });

    await sr.Question.bulkCreate(finalRecords.map((r) => ({ ...r, assessment_id: assessment.id })));

    return Response.json({
      ok: true,
      assessment_id: assessment.id,
      type,
      question_count: finalRecords.length,
      ...(failures.length ? { warnings: failures.map((f) => errMsg(f.reason)) } : {}),
    });
  } catch (e) {
    const message = errMsg(e);
    console.error('generateAssessment failed:', message);
    return Response.json({ error: message }, { status: 500 });
  }
});
