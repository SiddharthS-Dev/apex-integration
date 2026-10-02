// generateLessonContent — generate instructor-led teaching content, 6 MCQs and
// 5 flashcards for one lesson, grounded in its source playbook chapter.
//
// Payload: { lesson_id }   (admin only)
// Returns: { ok: true, lesson_id, question_count, flashcard_count }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];
const COGNITIVE = ['recall', 'understanding', 'application', 'analysis'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function norm(s: unknown): string {
  return String(s || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function wordOverlap(a: string, b: string): number {
  const wa = new Set(norm(a).split(' ').filter((w) => w.length > 2));
  const wb = new Set(norm(b).split(' ').filter((w) => w.length > 2));
  if (!wa.size || !wb.size) return 0;
  let common = 0;
  for (const w of wa) if (wb.has(w)) common++;
  return common / Math.min(wa.size, wb.size);
}

/** Find the chapter that best matches a lesson's source_chapter (falls back to module source chapters). */
function matchChapter(chapters: any[], sourceChapter: string, moduleSources: string): any | null {
  if (!chapters.length) return null;
  const target = norm(sourceChapter);
  if (target) {
    const exact = chapters.find((c) => norm(c.title) === target);
    if (exact) return exact;
    const contains = chapters.find((c) => {
      const t = norm(c.title);
      return t && (t.includes(target) || target.includes(t));
    });
    if (contains) return contains;
  }
  const candidates = [sourceChapter, ...String(moduleSources || '').split(',')].map((s) => s.trim()).filter(Boolean);
  let best: any = null;
  let bestScore = 0;
  for (const c of chapters) {
    for (const cand of candidates) {
      const score = wordOverlap(c.title, cand);
      if (score > bestScore) { best = c; bestScore = score; }
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/** Resolve the correct answer to exactly one of the options (handles letters / case drift). */
function resolveAnswer(options: string[], answer: string): string | null {
  const a = String(answer || '').trim();
  if (!a) return null;
  if (options.includes(a)) return a;
  const ci = options.find((o) => o.trim().toLowerCase() === a.toLowerCase());
  if (ci) return ci;
  const letter = a.match(/^\(?([A-Da-d])[\).:]?$/) || a.match(/^\(?([A-Da-d])[\).:]\s+/);
  if (letter) {
    const idx = letter[1].toUpperCase().charCodeAt(0) - 65;
    if (options[idx]) return options[idx];
  }
  const stripped = a.replace(/^\(?[A-Da-d][\).:]\s+/, '').toLowerCase();
  const byText = options.find((o) => o.trim().toLowerCase() === stripped);
  return byText || null;
}

function toText(v: unknown, bullet = false): string {
  if (Array.isArray(v)) {
    return v.map((x) => String(x || '').trim()).filter(Boolean).map((x) => (bullet ? `- ${x.replace(/^[-*•]\s*/, '')}` : x)).join('\n');
  }
  return String(v || '').trim();
}

Deno.serve(async (req) => {
  let base44: any;
  let lessonId: string | undefined;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    lessonId = body?.lesson_id;
    if (!lessonId) return Response.json({ error: 'lesson_id is required' }, { status: 400 });

    const sr = base44.asServiceRole.entities;
    const lesson = await sr.Lesson.get(lessonId);
    if (!lesson) return Response.json({ error: 'Lesson not found' }, { status: 404 });

    await sr.Lesson.update(lessonId, { status: 'generating' });

    // Resolve module -> course -> playbook -> chapter.
    const mod = lesson.module_id ? await sr.Module.get(lesson.module_id).catch(() => null) : null;
    const course = mod?.course_id ? await sr.Course.get(mod.course_id).catch(() => null) : null;
    const playbook = course?.playbook_id ? await sr.Playbook.get(course.playbook_id).catch(() => null) : null;
    const chapters: any[] = playbook ? (await sr.Chapter.filter({ playbook_id: playbook.id })) || [] : [];
    const chapter = matchChapter(chapters, lesson.source_chapter || '', mod?.source_chapters || '');

    const sourcePlaybook = lesson.source_playbook || playbook?.title || '';
    const sourceChapter = lesson.source_chapter || chapter?.title || '';
    const sourceSection = lesson.source_section || '';

    // Sibling lessons give the LLM scope boundaries (avoid repeating neighbouring lessons).
    const siblings: any[] = mod ? (await sr.Lesson.filter({ module_id: mod.id }, 'order')) || [] : [];
    const siblingList = siblings
      .filter((s) => s.id !== lessonId)
      .map((s) => `- ${s.title}${s.source_section ? ` (${s.source_section})` : ''}`)
      .join('\n');

    const sourceText = chapter?.content
      ? String(chapter.content)
      : (chapter?.summary || '(Source chapter content unavailable — rely strictly on the lesson metadata and general, uncontroversial engineering knowledge consistent with it.)');

    const prompt = `You are an experienced senior engineer and instructor recording a video lesson for your company's Engineering Academy. Teach in an instructor-led style: speak directly to the learner ("you", "we"), explain the why before the how, use concrete engineering scenarios, and check understanding along the way.

COURSE: ${course?.title || '(unknown)'}
MODULE: ${mod?.title || '(unknown)'}${mod?.description ? ` — ${mod.description}` : ''}
LESSON: ${lesson.title}
TEACHING OBJECTIVE: ${lesson.teaching_objective || '(derive from the title and source)'}
VIDEO TYPE: ${lesson.video_type || 'concept'}
TARGET DURATION: ${lesson.duration_target || '8-12 minutes'}
SOURCE: playbook "${sourcePlaybook}", chapter "${sourceChapter}", section "${sourceSection || 'whole chapter'}"

Other lessons in this module (do NOT teach their topics in depth; you may reference them briefly):
${siblingList || '(none)'}

SOURCE CHAPTER TEXT (authoritative — the lesson must be faithful to it, focusing on the section above):
"""
${sourceText}
"""

Produce:
1. "video_title": a clear, engaging title for the lesson video (max 12 words).
2. "teaching_script": the full narration an instructor would speak, ~8-12 minutes (roughly 1,200-1,700 words). PLAIN TEXT only — no markdown, no headings, no bullet symbols, no stage directions or "[pause]" markers. Structure: hook and objective, core explanation grounded in the playbook, at least one realistic worked scenario, common pitfalls, and a short recap. Use the playbook's terminology and rules precisely.
3. "summary": 3-5 sentence summary of the lesson.
4. "examples": 2-4 concrete, practical examples or mini case studies (each 2-5 sentences) illustrating the section in real engineering work.
5. "key_points": 5-8 crisp takeaways, each a single sentence.
6. "mcqs": EXACTLY 6 multiple-choice questions:
   - exactly 4 distinct, plausible options each; one unambiguously correct answer;
   - "correct_answer" must be copied EXACTLY (character for character) from one of the options — never a letter;
   - "explanation": why the answer is correct and why the main distractor is wrong, referencing the playbook;
   - mix "difficulty" (basic | intermediate | advanced) and "cognitive_level" (recall | understanding | application | analysis) — include at least 2 application/analysis scenario questions;
   - "source_section": the section heading the question tests;
   - avoid "all of the above"/"none of the above".
7. "flashcards": EXACTLY 5 flashcards with a short "front" (term, question or prompt) and a precise "back" (1-3 sentences), each with "difficulty" and "source_section".`;

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          video_title: { type: 'string' },
          teaching_script: { type: 'string' },
          summary: { type: 'string' },
          examples: { type: 'array', items: { type: 'string' } },
          key_points: { type: 'array', items: { type: 'string' } },
          mcqs: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_text: { type: 'string' },
                options: { type: 'array', items: { type: 'string' } },
                correct_answer: { type: 'string' },
                explanation: { type: 'string' },
                difficulty: { type: 'string', enum: DIFFICULTIES },
                cognitive_level: { type: 'string', enum: COGNITIVE },
                source_section: { type: 'string' },
              },
              required: ['question_text', 'options', 'correct_answer', 'explanation', 'difficulty', 'cognitive_level'],
            },
          },
          flashcards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                front: { type: 'string' },
                back: { type: 'string' },
                difficulty: { type: 'string', enum: DIFFICULTIES },
                source_section: { type: 'string' },
              },
              required: ['front', 'back'],
            },
          },
        },
        required: ['video_title', 'teaching_script', 'summary', 'examples', 'key_points', 'mcqs', 'flashcards'],
      },
    });

    if (!result || !String(result.teaching_script || '').trim()) {
      throw new Error('The AI returned no teaching script for this lesson.');
    }

    // Validate questions.
    const questions = (Array.isArray(result.mcqs) ? result.mcqs : [])
      .map((q: any) => {
        const options = (Array.isArray(q?.options) ? q.options : []).map((o: any) => String(o || '').trim()).filter(Boolean);
        const unique = [...new Set(options)] as string[];
        if (!String(q?.question_text || '').trim() || unique.length < 2) return null;
        const correct = resolveAnswer(unique, q.correct_answer);
        if (!correct) return null;
        return {
          lesson_id: lessonId,
          question_text: String(q.question_text).trim(),
          options: unique.slice(0, 4).includes(correct) ? unique.slice(0, 4) : [...unique.slice(0, 3), correct],
          correct_answer: correct,
          explanation: String(q.explanation || '').trim(),
          difficulty: DIFFICULTIES.includes(q.difficulty) ? q.difficulty : 'basic',
          cognitive_level: COGNITIVE.includes(q.cognitive_level) ? q.cognitive_level : 'recall',
          source_playbook: sourcePlaybook,
          source_chapter: sourceChapter,
          source_section: String(q.source_section || sourceSection || '').trim(),
          marks: 1,
          status: 'pending_review',
        };
      })
      .filter(Boolean)
      .slice(0, 6);

    const flashcards = (Array.isArray(result.flashcards) ? result.flashcards : [])
      .filter((f: any) => String(f?.front || '').trim() && String(f?.back || '').trim())
      .map((f: any) => ({
        lesson_id: lessonId,
        front: String(f.front).trim(),
        back: String(f.back).trim(),
        difficulty: DIFFICULTIES.includes(f.difficulty) ? f.difficulty : 'basic',
        source_playbook: sourcePlaybook,
        source_chapter: sourceChapter,
        source_section: String(f.source_section || sourceSection || '').trim(),
        status: 'pending_review',
      }))
      .slice(0, 5);

    // Replace previous lesson quiz questions (not assessment questions) and flashcards.
    const oldQuestions: any[] = (await sr.Question.filter({ lesson_id: lessonId })) || [];
    const oldFlashcards: any[] = (await sr.Flashcard.filter({ lesson_id: lessonId })) || [];
    await Promise.all([
      ...oldQuestions.filter((q) => !q.assessment_id).map((q) => sr.Question.delete(q.id)),
      ...oldFlashcards.map((f) => sr.Flashcard.delete(f.id)),
    ]);
    if (questions.length) await sr.Question.bulkCreate(questions);
    if (flashcards.length) await sr.Flashcard.bulkCreate(flashcards);

    await sr.Lesson.update(lessonId, {
      video_title: String(result.video_title || lesson.title).trim(),
      teaching_script: String(result.teaching_script).trim(),
      summary: String(result.summary || '').trim(),
      examples: toText(result.examples, true),
      key_points: toText(result.key_points, true),
      source_playbook: sourcePlaybook,
      source_chapter: sourceChapter,
      status: 'pending_review',
    });

    return Response.json({
      ok: true,
      lesson_id: lessonId,
      question_count: questions.length,
      flashcard_count: flashcards.length,
    });
  } catch (e) {
    const message = errMsg(e);
    console.error('generateLessonContent failed:', message);
    if (base44 && lessonId) {
      try {
        await base44.asServiceRole.entities.Lesson.update(lessonId, { status: 'pending' });
      } catch (_) { /* ignore */ }
    }
    return Response.json({ error: message }, { status: 500 });
  }
});
