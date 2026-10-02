import { detectSections, splitEvenly, summarizeChapter } from './chapters.js';

// Deterministic (non-AI) course design: one module per chapter, one lesson per numbered
// section ("3.2 Title"); chapters without numbered sections get 1–3 lessons by splitting content.
// Output has the same shape as the LLM design so persistence is shared.

export const VIDEO_TYPES = ['concept', 'deep_dive', 'example', 'architecture', 'demonstration', 'revision'];

export function guessVideoType(title) {
  const t = String(title || '').toLowerCase();
  if (/\b(summary|recap|review|revision|key takeaways|conclusion)\b/.test(t)) return 'revision';
  if (/\b(example|case stud|scenario|walkthrough|worked)\w*/.test(t)) return 'example';
  if (/\b(architecture|design|topology|system overview|diagram|components?)\b/.test(t)) return 'architecture';
  if (/\b(how to|procedure|steps?|setup|set up|install\w*|configur\w*|checklist|runbook|deploy\w*)\b/.test(t)) return 'demonstration';
  if (/\b(deep dive|internals|advanced|in depth)\b/.test(t)) return 'deep_dive';
  return 'concept';
}

const lower1 = (s) => (s ? s[0].toLowerCase() + s.slice(1) : s);

function objectiveFor(topic, chapterTitle) {
  const t = String(topic || '').replace(/[.:;]+$/, '');
  return t === chapterTitle
    ? `Explain the key concepts, practices and rules of "${chapterTitle}".`
    : `Explain ${lower1(t)} and apply it as described in "${chapterTitle}".`;
}

// Only the shallowest numbering level present becomes lessons (3.2 over 3.2.1).
function topLevelSections(sections) {
  if (!sections.length) return sections;
  const depth = (s) => s.number.split('.').length;
  const min = Math.min(...sections.map(depth));
  return sections.filter((s) => depth(s) === min);
}

function firstHeadingLine(chunk) {
  const line = String(chunk || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length >= 3 && line.length <= 80 && !/[.!?,;]$/.test(line) ? line : '';
}

export function lessonsForChapter(chapter) {
  const title = String(chapter.title || '').trim();
  const content = String(chapter.content || '');
  const sections = topLevelSections(detectSections(content, chapter.number));
  if (sections.length) {
    return sections.map((s) => ({
      title: s.title,
      teaching_objective: objectiveFor(s.title, title),
      video_type: guessVideoType(s.title),
      source_chapter: title,
      source_section: s.label,
    }));
  }
  const parts = content.length < 3000 ? 1 : content.length < 7000 ? 2 : 3;
  const chunks = splitEvenly(content, parts);
  if (chunks.length <= 1) {
    return [{ title, teaching_objective: objectiveFor(title, title), video_type: guessVideoType(title), source_chapter: title, source_section: title }];
  }
  return chunks.map((chunk, i) => {
    const heading = i > 0 ? firstHeadingLine(chunk) : '';
    const lessonTitle = heading && heading !== title ? heading : `${title} (Part ${i + 1} of ${chunks.length})`;
    return {
      title: lessonTitle,
      teaching_objective: objectiveFor(heading || title, title),
      video_type: guessVideoType(lessonTitle),
      source_chapter: title,
      source_section: heading || `${title} — part ${i + 1} of ${chunks.length}`,
    };
  });
}

export function buildDeterministicCourse(playbook, chapters) {
  const modules = chapters.map((c) => {
    const title = String(c.title || '').trim() || `Chapter ${c.number || ''}`.trim();
    return {
      title,
      description: String(c.summary || '').trim() || summarizeChapter(c.content, 1),
      source_chapters: [title],
      lessons: lessonsForChapter({ ...c, title }),
    };
  });
  const names = modules.map((m) => m.title);
  const listed = names.length > 5 ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more` : names.join(', ');
  return {
    course_title: String(playbook.title || 'Playbook course').trim(),
    course_description: `A structured course built from the "${playbook.title}" playbook${playbook.version ? ` (version ${playbook.version})` : ''}. It covers ${names.length} chapter${names.length === 1 ? '' : 's'}: ${listed}.`,
    difficulty: 'beginner',
    modules,
  };
}
