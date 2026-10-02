// processPlaybookStructure — turn a processed playbook's chapters into a course
// (modules -> lessons) with full coverage and traceability to the source.
//
// Payload: { playbook_id, force? }   (admin only)
// Returns: { ok: true, stage: 'structure', course_id, module_count, lesson_count, chapter_count }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';

const CHAPTER_CONTENT_CHARS = 8000;
const MAX_DIGEST_CHARS = 400000;
const VIDEO_TYPES = ['concept', 'deep_dive', 'example', 'architecture', 'demonstration', 'revision'];
const DIFFICULTIES = ['beginner', 'intermediate', 'advanced'];

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function romanToInt(s: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const up = s.toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return NaN;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = map[up[i]];
    const next = map[up[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

function chapterOrder(number: unknown): number {
  const s = String(number || '').trim().replace(/^(chapter|volume|part|book|module|unit)\s+/i, '').replace(/[.:)]+$/, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const r = romanToInt(s);
  return isNaN(r) ? Number.MAX_SAFE_INTEGER : r;
}

/** Detect sub-section headings in chapter content so the LLM gets an explicit coverage checklist. */
function detectSections(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const re = /^[ \t]*(?:section[ \t]+)?(\d+(?:\.\d+)+)\.?[ \t]+([^\n]{2,100})$/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) {
    const rest = m[2].trim();
    if (/\.{3,}|\s\d{1,4}$/.test(rest)) continue; // TOC line
    const key = m[1];
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(`${m[1]} ${rest}`);
    if (out.length >= 40) break;
  }
  return out;
}

Deno.serve(async (req) => {
  let base44: any;
  let playbookId: string | undefined;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    playbookId = body?.playbook_id;
    const force = !!body?.force;
    if (!playbookId) return Response.json({ error: 'playbook_id is required' }, { status: 400 });

    const sr = base44.asServiceRole.entities;
    const playbook = await sr.Playbook.get(playbookId);
    if (!playbook) return Response.json({ error: 'Playbook not found' }, { status: 404 });

    const courses: any[] = (await sr.Course.filter({ playbook_id: playbookId })) || [];
    const active = courses.find((c) => c.status === 'pending_review' || c.status === 'published');
    if (active && !force) {
      return Response.json({
        ok: true,
        stage: 'structure',
        skipped: true,
        reason: 'An active course already exists for this playbook. Pass force: true to regenerate.',
        course_id: active.id,
        module_count: active.module_count || 0,
        lesson_count: active.lesson_count || 0,
        chapter_count: playbook.chapter_count || 0,
      });
    }

    const rawChapters: any[] = (await sr.Chapter.filter({ playbook_id: playbookId })) || [];
    if (!rawChapters.length) throw new Error('No chapters found — run extraction first.');
    const chapters = rawChapters
      .map((c, i) => ({ c, i }))
      .sort((a, b) => {
        const d = chapterOrder(a.c.number) - chapterOrder(b.c.number);
        return d !== 0 ? d : a.i - b.i;
      })
      .map((x) => x.c);

    await sr.Playbook.update(playbookId, { status: 'processing', progress: 60, error: '' });

    // Digest: title + summary + up to 8k content per chapter (trimmed if the total is huge).
    const perChapter = Math.min(CHAPTER_CONTENT_CHARS, Math.floor(MAX_DIGEST_CHARS / chapters.length));
    const digest = chapters
      .map((c, i) => {
        const content = String(c.content || '');
        const sections = detectSections(content);
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
It has ${chapters.length} chapters, provided below with their summaries, detected sections and content.

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

    const result = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
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
                    required: ['title', 'teaching_objective', 'source_chapter', 'source_section'],
                  },
                },
              },
              required: ['title', 'lessons'],
            },
          },
        },
        required: ['course_title', 'modules'],
      },
    });

    const modules = (Array.isArray(result?.modules) ? result.modules : [])
      .filter((m: any) => m && String(m.title || '').trim())
      .map((m: any) => ({
        ...m,
        lessons: (Array.isArray(m.lessons) ? m.lessons : []).filter((l: any) => l && String(l.title || '').trim()),
      }))
      .filter((m: any) => m.lessons.length > 0);
    if (!modules.length) throw new Error('The AI did not return any modules/lessons for this playbook.');

    // Archive previous courses (keeps learner progress/certificates intact).
    await Promise.all(
      courses
        .filter((c) => c.status !== 'archived')
        .map((c) => sr.Course.update(c.id, { status: 'archived', published: false })),
    );
    const maxVersion = courses.reduce((mx, c) => Math.max(mx, parseInt(String(c.version || '0'), 10) || 0), 0);

    const difficulty = DIFFICULTIES.includes(result?.difficulty) ? result.difficulty : 'beginner';
    const course = await sr.Course.create({
      playbook_id: playbookId,
      title: String(result.course_title || playbook.title).trim(),
      description: String(result.course_description || '').trim(),
      status: 'pending_review',
      published: false,
      difficulty,
      version: String(maxVersion + 1),
      access_level: 'free',
      module_count: 0,
      lesson_count: 0,
    });

    const chapterTitles = chapters.map((c) => String(c.title));
    let lessonCount = 0;
    for (let i = 0; i < modules.length; i++) {
      const m = modules[i];
      const sourceChapters = (Array.isArray(m.source_chapters) ? m.source_chapters : [])
        .map((s: any) => String(s).trim())
        .filter(Boolean);
      const mod = await sr.Module.create({
        course_id: course.id,
        title: String(m.title).trim(),
        description: String(m.description || '').trim(),
        order: i,
        lesson_count: m.lessons.length,
        source_chapters: sourceChapters.join(', '),
      });
      const lessons = m.lessons.map((l: any, j: number) => ({
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

    return Response.json({
      ok: true,
      stage: 'structure',
      course_id: course.id,
      module_count: modules.length,
      lesson_count: lessonCount,
      chapter_count: chapters.length,
    });
  } catch (e) {
    const message = errMsg(e);
    console.error('processPlaybookStructure failed:', message);
    if (base44 && playbookId) {
      try {
        await base44.asServiceRole.entities.Playbook.update(playbookId, { status: 'failed', error: message });
      } catch (_) { /* ignore */ }
    }
    return Response.json({ error: message }, { status: 500 });
  }
});
