import { invokeLLM, requireAI } from '../ai/index.js';
import { config } from '../config.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { mediaEnabled } from '../media/index.js';
import { entities } from '../repo/entities.js';
import generateLessonMedia from './generateLessonMedia.js';
import { loadLessonSource, matchChapter } from './source.js';
import { structureFor } from './videoPlan.js';
import { runWithGeneration } from '../usage/context.js';
import { asHttpError, cleanMcq, errMsg, pipelineError, withLessonLock } from './util.js';

export { matchChapter };

// generateLessonContent — generate instructor-led teaching content, 6 MCQs and
// 5 flashcards for one lesson, grounded in its source playbook chapter. Requires AI.
//
// When a media provider is configured the lesson's video (narrated slides) is generated straight after,
// from the new script, so a lesson never reaches learners as narration only. A media failure does not
// fail the content: the lesson keeps its new script and reports media_error; Generate Media retries it.
//
// Payload: { lesson_id }
// Returns: { ok: true, lesson_id, question_count, flashcard_count, media_scenes?, media_error? }

const DIFFICULTIES = ['basic', 'intermediate', 'advanced'];
const COGNITIVE = ['recall', 'understanding', 'application', 'analysis'];

function toText(v, bullet = false) {
  if (Array.isArray(v)) {
    return v.map((x) => String(x || '').trim()).filter(Boolean).map((x) => (bullet ? `- ${x.replace(/^[-*•]\s*/, '')}` : x)).join('\n');
  }
  return String(v || '').trim();
}

// The script comes first (models write keys in schema order; a short field first can run away and
// swallow the rest), every field is required, and the title is length-limited so a runaway title is
// caught as malformed output instead of being saved.
const SCHEMA = {
  type: 'object',
  required: ['teaching_script', 'video_title', 'summary', 'key_points', 'mcqs', 'flashcards'],
  properties: {
    teaching_script: { type: 'string' },
    video_title: { type: 'string', maxLength: 150 },
    summary: { type: 'string' },
    examples: { type: 'array', items: { type: 'string' } },
    key_points: { type: 'array', items: { type: 'string' } },
    mcqs: {
      type: 'array',
      items: {
        type: 'object',
        // No `required` here on purpose: the Gemini provider asks for every field (requireAllFields),
        // while a single incomplete question is dropped by cleanMcq below instead of failing the lesson.
        properties: {
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
      },
    },
  },
};

export default async function generateLessonContent(payload = {}, ctx = {}) {
  const lessonId = payload?.lesson_id ? String(payload.lesson_id) : '';
  if (!lessonId) throw badRequest('lesson_id is required');
  const result = await withLessonLock(lessonId, () => generate(payload, ctx));
  // The video (voice-over) is paid work: made straight after only when asked for (with_media: true)
  // or when AUTO_GENERATE_AUDIO=true; otherwise the admin generates it explicitly per lesson.
  const withMedia = payload?.with_media === true || (payload?.with_media !== false && config.autoGenerateAudio);
  if (!withMedia || !mediaEnabled()) return result;
  try {
    const media = await generateLessonMedia({ lesson_id: lessonId }, ctx);
    return { ...result, media_scenes: media.scenes.length, ...(media.audio_error ? { media_error: media.audio_error } : {}) };
  } catch (e) {
    (ctx.log || defaultLog).warn('pipeline.lesson_content.media_failed', { lesson_id: lessonId, error: errMsg(e) });
    return { ...result, media_error: errMsg(e) };
  }
}

async function generate(payload = {}, ctx = {}) {
  const log = ctx.log || defaultLog;
  const lessonId = payload?.lesson_id ? String(payload.lesson_id) : '';
  if (!lessonId) throw badRequest('lesson_id is required');
  requireAI();

  const sr = entities;
  const lesson = await sr.Lesson.get(lessonId);
  if (!lesson) throw notFound('Lesson not found');

  try {
    await sr.Lesson.update(lessonId, { status: 'generating' });

    const { mod, course, playbook, chapter } = await loadLessonSource(lesson);
    const structure = structureFor(lesson.video_type);

    const sourcePlaybook = lesson.source_playbook || playbook?.title || '';
    const sourceChapter = lesson.source_chapter || chapter?.title || '';
    const sourceSection = lesson.source_section || '';

    // Sibling lessons give the LLM scope boundaries (avoid repeating neighbouring lessons).
    const siblings = mod ? await sr.Lesson.filter({ module_id: mod.id }, 'order') : [];
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
1. "teaching_script": the full narration an instructor would speak, ~8-12 minutes (roughly 1,200-1,700 words). PLAIN TEXT only — no markdown, no headings, no bullet symbols, no stage directions or "[pause]" markers. Follow the teaching order of a ${lesson.video_type || 'concept'} lesson: ${structure.flow}. Ground every part in the playbook, include at least one realistic worked scenario, and use the playbook's terminology, rules, step order and numbers precisely. When the playbook states a rule, quote it exactly. The video shows the playbook's procedures, rules, tables and definitions on screen, so walk through them in the order the chapter gives them.
2. "video_title": a clear, engaging title for the lesson video (max 12 words, under 100 characters).
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

    // One answer, checked: structure (schema), then the quality gate. Nothing is saved until both pass.
    const badOutput = (msg) => Object.assign(pipelineError(msg), { badOutput: true });
    const produce = async (fresh) => {
      const result = await runWithGeneration(fresh ? { fresh: true } : {}, () => invokeLLM({ prompt, schema: SCHEMA, maxTokens: 32000 }));
      if (!result || !String(result.teaching_script || '').trim()) {
        throw badOutput('The AI returned no teaching script for this lesson.');
      }

      const questions = (Array.isArray(result.mcqs) ? result.mcqs : [])
        .map((q) => {
          const clean = cleanMcq(q);
          if (!clean) return null;
          return {
            lesson_id: lessonId,
            question_text: String(q.question_text).trim(),
            options: clean.options,
            correct_answer: clean.correct,
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
        .filter((f) => String(f?.front || '').trim() && String(f?.back || '').trim())
        .map((f) => ({
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

      // Quality gate before anything is saved: a short script or too few usable questions/flashcards
      // means the response was incomplete — fail (the lesson keeps what it had) rather than store it.
      const words = String(result.teaching_script).trim().split(/\s+/).length;
      if (words < 300) throw badOutput(`The AI returned a teaching script of only ${words} words (at least 300 expected) — nothing was saved; retry this lesson.`);
      if (questions.length < 4) throw badOutput(`The AI returned only ${questions.length} usable quiz questions (6 requested) — nothing was saved; retry this lesson.`);
      if (flashcards.length < 3) throw badOutput(`The AI returned only ${flashcards.length} usable flashcards (5 requested) — nothing was saved; retry this lesson.`);
      return { result, questions, flashcards };
    };
    // A malformed or incomplete answer (models occasionally ramble inside one field) is asked for once
    // more, bypassing the cache; a second bad answer fails the lesson with the reason.
    let produced;
    try {
      produced = await produce(false);
    } catch (err) {
      if (!(err?.badOutput || err?.details?.malformed)) throw err;
      log.warn('pipeline.lesson_content.retry_bad_output', { lesson_id: lessonId, reason: errMsg(err) });
      produced = await produce(true);
    }
    const { result, questions, flashcards } = produced;

    // Replace previous lesson quiz questions (never assessment questions) and flashcards.
    const oldQuestions = await sr.Question.filter({ lesson_id: lessonId });
    const oldFlashcards = await sr.Flashcard.filter({ lesson_id: lessonId });
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
      content_generated_at: new Date().toISOString(),
      content_error: '',
      content_error_retryable: false,
      content_attempts: (Number(lesson.content_attempts) || 0) + 1,
    });

    return { ok: true, lesson_id: lessonId, question_count: questions.length, flashcard_count: flashcards.length };
  } catch (e) {
    log.error('pipeline.lesson_content.failed', { lesson_id: lessonId, error: errMsg(e) });
    try {
      // A lesson that already had content keeps it (and its status); the error is recorded either way.
      await sr.Lesson.update(lessonId, {
        status: String(lesson.teaching_script || '').trim() ? lesson.status : 'pending',
        content_error: errMsg(e).slice(0, 500),
        content_error_retryable: !!(e?.details?.retryable || e?.status === 429),
        content_attempts: (Number(lesson.content_attempts) || 0) + 1,
      });
    } catch { /* ignore */ }
    throw asHttpError(e);
  }
}
