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

// "Device identity" → "device identity", but acronyms keep their case: "CK Platform", "AIoT", "OTA".
const lower1 = (s) => (s && !/^[A-Z][A-Z0-9]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s);

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

// Table rows ("a | b | c"), captions ("TABLE 15 — …", "Fig. 6. …") and list items are content,
// not lesson titles.
const NOT_A_TITLE = /\s\|\s|^(?:table|figure|fig\.)\s*\d+/i;

function firstHeadingLine(chunk) {
  const line = String(chunk || '').split('\n').map((l) => l.trim()).find(Boolean) || '';
  return line.length >= 3 && line.length <= 80 && !/[.!?,;]$/.test(line) && !NOT_A_TITLE.test(line) ? line : '';
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

/**
 * Sub-chapters inside a chapter ("Chapter 5 — Platform Differentiation" inside "Part 1"): a part
 * that groups several chapters gets one lesson per chapter instead of a length-based split.
 */
export function subChapterHeadings(content) {
  const re = /^[ \t]*Chapter[ \t]+(\d{1,3})[ \t]*[—–:-][ \t]*(\S[^\n]{1,100})$/gim;
  const hits = [];
  let m;
  while ((m = re.exec(content))) {
    const n = Number(m[1]);
    if (hits.length && n <= hits[hits.length - 1].n) continue; // a cross-reference, not the next chapter
    hits.push({ n, title: m[2].trim(), label: m[0].trim(), start: m.index });
  }
  return hits.length >= 2 ? hits : [];
}

/**
 * Numbered topic headings ("22. OTA firmware lifecycle", "12–14. Device identity, registry…").
 * Only an increasing run counts, so a numbered list inside a figure ("1. Historical replay")
 * never becomes a lesson.
 */
export function numberedTopicHeadings(content) {
  const re = /^[ \t]*(\d{1,3})(?:[ \t]*[–-][ \t]*(\d{1,3}))?\.[ \t]+([A-Z][^\n]{2,100})$/gm;
  const found = [];
  let m;
  while ((m = re.exec(content))) {
    const title = m[3].trim();
    if (/[.:;,]$/.test(title) || NOT_A_TITLE.test(title)) continue;
    const from = Number(m[1]);
    const to = m[2] ? Number(m[2]) : from;
    if (to < from) continue;
    found.push({ from, to, title, label: m[0].trim(), start: m.index });
  }
  // A part that announces its range ("Chapters 88–109 — …") only has topics inside that range;
  // numbered lists ("1. Historical replay") fall outside it.
  const range = content.slice(0, 3000).match(/^[ \t]*Chapters?[ \t]+(\d{1,3})[ \t]*[–-][ \t]*(\d{1,3})\b/im);
  if (range) {
    const [lo, hi] = [Number(range[1]), Number(range[2])];
    const inside = found.filter((f) => f.from >= lo && f.to <= hi);
    if (inside.length >= 2) found.splice(0, found.length, ...inside);
  }
  // Longest chain of headings whose numbers keep increasing (from > previous to).
  const best = found.map(() => ({ len: 1, prev: -1 }));
  for (let i = 0; i < found.length; i++) {
    for (let j = 0; j < i; j++) {
      if (found[i].from > found[j].to && best[j].len + 1 > best[i].len) best[i] = { len: best[j].len + 1, prev: j };
    }
  }
  let end = best.reduce((bi, b, i) => (b.len > best[bi].len ? i : bi), 0);
  const chain = [];
  while (end >= 0 && found.length) { chain.unshift(found[end]); end = best[end].prev; }
  return chain.length >= 2 ? chain : [];
}

// One lesson per heading; text before the first heading becomes an overview lesson when it has
// real substance (a part's introduction), otherwise it is covered by the first lesson.
function lessonsFromHeadings(chapterTitle, content, headings, label) {
  const lessons = [];
  const intro = content.slice(0, headings[0].start).trim();
  if (intro.length >= 1200) {
    lessons.push({
      title: `${chapterTitle}: overview`,
      teaching_objective: objectiveFor(chapterTitle, chapterTitle),
      video_type: 'concept',
      source_chapter: chapterTitle,
      source_section: `${chapterTitle} — introduction`,
    });
  }
  for (const h of headings) {
    const t = clip(h.title.replace(/[.:]+$/, ''), 90);
    lessons.push({
      title: t,
      teaching_objective: objectiveFor(t, chapterTitle),
      video_type: guessVideoType(t),
      source_chapter: chapterTitle,
      source_section: label(h),
    });
  }
  return lessons;
}

export function lessonsForChapter(chapter) {
  const title = String(chapter.title || '').trim();
  const content = String(chapter.content || '');
  const subChapters = subChapterHeadings(content);
  if (subChapters.length) return lessonsFromHeadings(title, content, subChapters, (h) => h.label);
  const topics = numberedTopicHeadings(content);
  if (topics.length) return lessonsFromHeadings(title, content, topics, (h) => h.label);
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
