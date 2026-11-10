import { UNCLASSIFIED } from '@academy/shared';
import { aiEnabled, invokeLLM } from '../ai/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import { detectSections, sortChapters } from './chapters.js';
import { VIDEO_TYPES, buildDeterministicCourse, lessonsForChapter } from './courseBuilder.js';
import { asHttpError, errMsg, pipelineError, withPlaybookLock } from './util.js';

// processPlaybookStructure — turn a processed playbook's chapters into a course
// (modules -> lessons) with full coverage and traceability to the source.
// AI enabled → LLM course design; otherwise a deterministic one-module-per-chapter design.
//
// Payload: { playbook_id, force? }
// Returns: { ok: true, stage: 'structure', course_id, module_count, lesson_count, chapter_count }
//      or  { ok: true, stage: 'structure', skipped: true, reason, course_id, ... } when an active course exists.

const CHAPTER_CONTENT_CHARS = 8000;
const MAX_DIGEST_CHARS = 400000;
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

// Long books are designed a few chapters per LLM call: one call over 30+ chapters merges and
// drops chapters, however strict the coverage rules are.
export const DESIGN_BATCH_CHAPTERS = 6;
const DESIGN_CONCURRENCY = 2;

async function designWithAI(playbook, chapters, batch = null) {
  const perChapter = Math.min(CHAPTER_CONTENT_CHARS, Math.floor(MAX_DIGEST_CHARS / chapters.length));
  const digest = chapters
    .map((c, i) => {
      const content = String(c.content || '');
      const sections = detectSections(content, c.number).map((s) => s.label);
      return `=== CHAPTER ${i + 1} ===
Number: ${c.number || i + 1}
Title: ${c.title}
Summary: ${c.summary || '(none)'}
Detected sections (${sections.length}):
${sections.length ? sections.map((s) => `  - ${s}`).join('\n') : '  (no numbered sections detected — identify sections from the content headings)'}
Content:
"""
${content.slice(0, perChapter)}
"""`;
    })
    .join('\n\n');

  const prompt = `You are a senior instructional designer building an engineering training course from a company playbook.
Playbook: "${playbook.title}"${playbook.version ? ` (version ${playbook.version})` : ''}${playbook.organization ? `, ${playbook.organization}` : ''}.
${batch
    ? `The playbook has ${batch.all.length} chapters in total:
${batch.all.map((c, i) => `  ${i + 1}. ${c.title}`).join('\n')}
This request covers ONLY chapters ${batch.from}–${batch.to} (${chapters.length} chapters), provided below with their summaries, detected sections and content. Design modules for these chapters only — the others are designed separately. Still give the course title, description and difficulty for the WHOLE playbook.`
    : `It has ${chapters.length} chapters, provided below with their summaries, detected sections and content.`}

Design a complete course with modules and lessons. STRICT COVERAGE RULES — these are mandatory:
1. Every chapter must be covered. Normally create one module per chapter (in the same order); only merge very small adjacent chapters when they are clearly one topic, and never drop a chapter.
2. Every section of every chapter must be covered by AT LEAST ONE lesson. Do not omit, skip or summarize away any section, procedure, standard, checklist or rule. If a chapter has no explicit sections, identify its logical topics from the content and cover each.
3. Lessons must be granular: one focused teachable topic per lesson (roughly 8-12 minutes of instruction). Split large sections into multiple lessons rather than cramming.
4. Traceability: every lesson must set "source_chapter" to the EXACT chapter title as given below, and "source_section" to the exact section heading (e.g. "3.2 Code Review Standards") or the topic heading it covers.
5. Each lesson needs a clear "teaching_objective" starting with an action verb ("Explain...", "Apply...", "Configure...") describing what the learner will be able to do.
6. Choose "video_type" per lesson from: concept (explaining an idea), deep_dive (detailed technical treatment), example (worked example/case), architecture (system design/diagrams), demonstration (step-by-step procedure), revision (recap/review). Consider ending long modules with a short revision lesson.
7. Each module has a title, a 1-2 sentence description and "source_chapters" listing the exact chapter title(s) it covers.
8. Provide a course title, a compelling 2-3 sentence course description, and an overall difficulty (beginner | intermediate | advanced).
9. Use only information in the playbook. Keep the playbook's terminology.

PLAYBOOK CHAPTERS
${digest}`;

  return invokeLLM({
    prompt,
    maxTokens: 64000,
    schema: {
      type: 'object',
      properties: {
        course_title: { type: 'string' },
        course_description: { type: 'string' },
        difficulty: { type: 'string', enum: DIFFICULTIES },
        modules: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              source_chapters: { type: 'array', items: { type: 'string' } },
              lessons: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    title: { type: 'string' },
                    teaching_objective: { type: 'string' },
                    video_type: { type: 'string', enum: VIDEO_TYPES },
                    source_chapter: { type: 'string' },
                    source_section: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
}

async function designCourseWithAI(playbook, chapters) {
  if (chapters.length <= DESIGN_BATCH_CHAPTERS + 2) return designWithAI(playbook, chapters);
  const groups = [];
  for (let i = 0; i < chapters.length; i += DESIGN_BATCH_CHAPTERS) groups.push({ from: i + 1, chapters: chapters.slice(i, i + DESIGN_BATCH_CHAPTERS) });
  const results = new Array(groups.length);
  let next = 0;
  const worker = async () => {
    while (next < groups.length) {
      const gi = next++;
      const g = groups[gi];
      results[gi] = await designWithAI(playbook, g.chapters, { all: chapters, from: g.from, to: g.from + g.chapters.length - 1 });
    }
  };
  await Promise.all(Array.from({ length: Math.min(DESIGN_CONCURRENCY, groups.length) }, worker));
  const first = results.find((r) => r?.course_title) || {};
  return {
    course_title: first.course_title,
    course_description: first.course_description,
    difficulty: first.difficulty,
    modules: results.flatMap((r) => (Array.isArray(r?.modules) ? r.modules : [])),
  };
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

/**
 * Coverage guarantee: every lesson points at a real chapter title, and every chapter the design
 * left without lessons gets a module of its own (lessons from its sections), placed in book order.
 */
export function ensureChapterCoverage(modules, chapters) {
  const titles = chapters.map((c) => String(c.title).trim());
  const indexOf = (name) => {
    const n = norm(name);
    if (!n) return -1;
    const exact = titles.findIndex((t) => norm(t) === n);
    if (exact >= 0) return exact;
    return titles.findIndex((t) => n.includes(norm(t)) || norm(t).includes(n));
  };
  for (const m of modules) {
    const srcs = (Array.isArray(m.source_chapters) ? m.source_chapters : []).map(indexOf).filter((i) => i >= 0);
    for (const l of m.lessons) {
      const i = indexOf(l.source_chapter);
      if (i >= 0) l.source_chapter = titles[i];
      else if (srcs.length === 1) l.source_chapter = titles[srcs[0]];
    }
    m.source_chapters = [...new Set([...srcs, ...m.lessons.map((l) => indexOf(l.source_chapter)).filter((i) => i >= 0)])]
      .sort((a, b) => a - b).map((i) => titles[i]);
  }
  const covered = new Set(modules.flatMap((m) => m.lessons.map((l) => indexOf(l.source_chapter))).filter((i) => i >= 0));
  const firstChapterOf = (m) => Math.min(...m.lessons.map((l) => indexOf(l.source_chapter)).filter((i) => i >= 0), Number.MAX_SAFE_INTEGER);
  const added = [];
  chapters.forEach((c, i) => {
    if (covered.has(i)) return;
    const title = titles[i];
    const mod = { title, description: String(c.summary || '').trim(), source_chapters: [title], lessons: lessonsForChapter({ ...c, title }), _first: i };
    const at = modules.findIndex((m) => (m._first ?? firstChapterOf(m)) > i);
    modules.splice(at < 0 ? modules.length : at, 0, mod);
    added.push(title);
  });
  for (const m of modules) delete m._first;
  return added;
}

export default async function processPlaybookStructure(payload = {}, ctx = {}) {
  const log = ctx.log || defaultLog;
  const playbookId = payload?.playbook_id ? String(payload.playbook_id) : '';
  const force = payload?.force === true || payload?.force === 'true';
  if (!playbookId) throw badRequest('playbook_id is required');
  const playbook = await entities.Playbook.get(playbookId);
  if (!playbook) throw notFound('Playbook not found');

  const courses = await entities.Course.filter({ playbook_id: playbookId });
  const active = courses.find((c) => c.status === 'pending_review' || c.status === 'published');
  if (active && !force) {
    return {
      ok: true,
      stage: 'structure',
      skipped: true,
      reason: 'An active course already exists for this playbook. Pass force: true to regenerate.',
      course_id: active.id,
      module_count: active.module_count || 0,
      lesson_count: active.lesson_count || 0,
      chapter_count: playbook.chapter_count || 0,
    };
  }
  return withPlaybookLock(playbookId, () => run(playbook, courses, log));
}

async function run(playbook, courses, log) {
  const playbookId = playbook.id;
  const sr = entities;
  try {
    const rawChapters = await sr.Chapter.filter({ playbook_id: playbookId });
    if (!rawChapters.length) throw pipelineError('No chapters found — run extraction first.');
    const chapters = sortChapters(rawChapters);

    await sr.Playbook.update(playbookId, { status: 'processing', progress: 60, error: '' });

    const useAI = aiEnabled();
    const result = useAI ? await designCourseWithAI(playbook, chapters) : buildDeterministicCourse(playbook, chapters);

    const modules = (Array.isArray(result?.modules) ? result.modules : [])
      .filter((m) => m && String(m.title || '').trim())
      .map((m) => ({ ...m, lessons: (Array.isArray(m.lessons) ? m.lessons : []).filter((l) => l && String(l.title || '').trim()) }))
      .filter((m) => m.lessons.length > 0);
    if (!modules.length) throw pipelineError(useAI ? 'The AI did not return any modules/lessons for this playbook.' : 'No lessons could be derived from the chapters.');
    const filledIn = ensureChapterCoverage(modules, chapters);
    if (filledIn.length) log.warn('pipeline.structure.coverage_filled', { playbook_id: playbookId, chapters: filledIn });

    // Archive previous courses (keeps learner progress/certificates intact).
    await Promise.all(
      courses.filter((c) => c.status !== 'archived').map((c) => sr.Course.update(c.id, { status: 'archived', published: false })),
    );
    const maxVersion = courses.reduce((mx, c) => Math.max(mx, parseInt(String(c.version || '0'), 10) || 0), 0);

    const course = await sr.Course.create({
      playbook_id: playbookId,
      title: String(result.course_title || playbook.title).trim() || playbook.title,
      description: String(result.course_description || '').trim(),
      status: 'pending_review',
      published: false,
      difficulty: DIFFICULTIES.includes(result?.difficulty) ? result.difficulty : 'beginner',
      version: String(maxVersion + 1),
      access_level: 'free',
      // Who may see the course follows its playbook's category.
      category: playbook.category || UNCLASSIFIED,
      module_count: 0,
      lesson_count: 0,
    });

    const chapterTitles = chapters.map((c) => String(c.title));
    let lessonCount = 0;
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      const sourceChapters = (Array.isArray(m.source_chapters) ? m.source_chapters : []).map((s) => String(s).trim()).filter(Boolean);
      const mod = await sr.Module.create({
        course_id: course.id,
        // Batched designs number their own modules ("Module 1: …") — the course shows its own order.
        title: String(m.title).trim().replace(/^module\s+\d+\s*[:.\-–—]\s*/i, '') || String(m.title).trim(),
        description: String(m.description || '').trim(),
        order: i,
        lesson_count: m.lessons.length,
        source_chapters: sourceChapters.join(', '),
      });
      const lessons = m.lessons.map((l, j) => ({
        module_id: mod.id,
        title: String(l.title).trim(),
        teaching_objective: String(l.teaching_objective || '').trim(),
        video_type: VIDEO_TYPES.includes(l.video_type) ? l.video_type : 'concept',
        source_playbook: playbook.title,
        source_chapter: String(l.source_chapter || sourceChapters[0] || chapterTitles[i] || '').trim(),
        source_section: String(l.source_section || '').trim(),
        duration_target: '8-12 minutes',
        status: 'pending',
        order: j,
      }));
      await sr.Lesson.bulkCreate(lessons);
      lessonCount += lessons.length;
    }

    await sr.Course.update(course.id, { module_count: modules.length, lesson_count: lessonCount });
    await sr.Playbook.update(playbookId, { status: 'needs_review', progress: 100, error: '' });
    log.info('pipeline.structure.done', { playbook_id: playbookId, ai: useAI, course_id: course.id, modules: modules.length, lessons: lessonCount });

    return {
      ok: true,
      stage: 'structure',
      course_id: course.id,
      module_count: modules.length,
      lesson_count: lessonCount,
      chapter_count: chapters.length,
    };
  } catch (e) {
    const message = errMsg(e);
    log.error('pipeline.structure.failed', { playbook_id: playbookId, error: message });
    try {
      await sr.Playbook.update(playbookId, { status: 'failed', error: message });
    } catch { /* ignore */ }
    throw asHttpError(e);
  }
}
