// Chapter detection for extracted playbook text (pure functions, no I/O).
// Ported from the legacy processPlaybookExtract: three strategies (TOC-guided, hybrid number,
// regex headings), pick the one with the most chapters, plus the title-correction heuristic.

export const MAX_CHAPTER_CHARS = 12000;
export const TOC_SKIP_CHARS = 5000;
// Top-level heading words. "Clause" and "Article" cover standards and legal-style documents
// (e.g. an IEEE-style playbook built from "CLAUSE 5 — …" headings).
export const KEYWORDS = ['Chapter', 'Volume', 'Part', 'Book', 'Module', 'Unit', 'Clause', 'Article'];
const KW = KEYWORDS.map((k) => k.toLowerCase()).join('|');
const KW_PREFIX = new RegExp(`^(${KW})\\s+`, 'i');
export const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

// ---- helpers -----------------------------------------------------------------------------

export function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function romanToInt(s) {
  const map = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  const up = String(s).toUpperCase();
  if (!/^[IVXLCDM]+$/.test(up)) return NaN;
  let total = 0;
  for (let i = 0; i < up.length; i++) {
    const v = map[up[i]];
    const next = map[up[i + 1]] || 0;
    total += v < next ? -v : v;
  }
  return total;
}

export function intToRoman(n) {
  const table = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, sym] of table) {
    while (n >= v) { out += sym; n -= v; }
  }
  return out;
}

export function parseNum(raw) {
  if (!raw) return NaN;
  const s = String(raw).trim().replace(KW_PREFIX, '').replace(/[.:)\]]+$/, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const w = NUMBER_WORDS[s.toLowerCase()];
  if (w) return w;
  return romanToInt(s);
}

function keywordOf(raw) {
  if (!raw) return null;
  const m = String(raw).trim().match(new RegExp(`^(${KW})\\b`, 'i'));
  return m ? m[1] : null;
}

// Sort key for stored Chapter.number values ("3", "Chapter 3", "Part II"); unknown → last.
export function chapterOrder(number) {
  const s = String(number || '').trim().replace(KW_PREFIX, '').replace(/[.:)]+$/, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const r = romanToInt(s);
  return Number.isNaN(r) ? Number.MAX_SAFE_INTEGER : r;
}

export function sortChapters(chapters) {
  return chapters
    .map((c, i) => ({ c, i }))
    .sort((a, b) => chapterOrder(a.c.number) - chapterOrder(b.c.number) || a.i - b.i)
    .map((x) => x.c);
}

function lineStartOf(text, idx) {
  return text.lastIndexOf('\n', idx - 1) + 1;
}

function lineEndOf(text, idx) {
  const e = text.indexOf('\n', idx);
  return e === -1 ? text.length : e;
}

function looksLikeTocLine(rest) {
  return /\.{3,}|…{2,}|\s\d{1,4}\s*$/.test(rest);
}

export function tocSkip(text) {
  // Skip the TOC region; for very small documents skip proportionally less.
  return text.length > TOC_SKIP_CHARS * 4 ? TOC_SKIP_CHARS : Math.floor(text.length * 0.05);
}

// ---- table of contents -------------------------------------------------------------------

/** Parse a stored toc_summary (or raw TOC lines) into entries { number?, title }. */
export function parseTocSummary(toc) {
  const entries = [];
  for (const rawLine of String(toc || '').split('\n')) {
    const line = rawLine.trim().replace(/\.{3,}\s*\d+\s*$/, '').replace(/\s+\d+\s*$/, '').trim();
    if (!line) continue;
    const m = line.match(new RegExp(`^((?:${KW})\\s+)?([0-9]{1,3}|[IVXLCDM]{1,7})\\s*[.:)\\-—–]\\s*(.+)$`, 'i'));
    if (m) entries.push({ number: `${m[1] || ''}${m[2]}`.trim(), title: m[3].trim() });
    else entries.push({ title: line });
  }
  return entries;
}

/**
 * Non-AI TOC reader: finds a "Contents" / "Table of Contents" heading near the start of the
 * document and parses the top-level entry lines that follow it (dotted leaders / page numbers).
 */
export function extractTocFromText(text, { searchChars = 20000 } = {}) {
  const head = text.slice(0, searchChars);
  const m = head.match(/^[ \t]*(?:table of contents|contents)[ \t]*:?[ \t]*$/im);
  if (!m) return [];
  const lines = head.slice(m.index + m[0].length).split('\n');
  const picked = [];
  let misses = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (looksLikeTocLine(line) && line.length <= 160) {
      misses = 0;
      if (/^(?:section\s+)?\d+\.\d+/i.test(line)) continue; // sub-section entry
      picked.push(line);
    } else if (picked.length && ++misses >= 5) {
      break;
    }
  }
  const entries = parseTocSummary(picked.join('\n')).filter((e) => e.title.length >= 2);
  // Mixed levels ("Part I" + "Chapter 1"): keep the keyword with the most entries.
  const byKw = new Map();
  for (const e of entries) {
    const kw = keywordOf(e.number);
    if (kw) byKw.set(kw.toLowerCase(), (byKw.get(kw.toLowerCase()) || 0) + 1);
  }
  if (byKw.size > 1) {
    const best = [...byKw.entries()].sort((a, b) => b[1] - a[1] || (a[0] === 'chapter' ? -1 : 1))[0][0];
    return entries.filter((e) => (keywordOf(e.number) || '').toLowerCase() === best);
  }
  return entries;
}

// ---- detection strategies ----------------------------------------------------------------

/** Strategy 1: TOC-guided — search for each TOC title (in order) as a heading line. */
export function detectTocGuided(text, toc) {
  const hits = [];
  let cursor = tocSkip(text);
  toc.forEach((entry, i) => {
    const words = entry.title
      .replace(/[^\p{L}\p{N}&'’\s-]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 12);
    if (!words.length) return;
    const re = new RegExp(words.map(escapeRe).join('[\\s\\W]{1,6}'), 'giu');
    re.lastIndex = cursor;
    let m;
    while ((m = re.exec(text))) {
      const ls = lineStartOf(text, m.index);
      const prefix = text.slice(ls, m.index);
      const rest = text.slice(m.index + m[0].length, lineEndOf(text, m.index + m[0].length));
      const prefixOk = prefix.length <= 40 && prefix.trim().split(/\s+/).filter(Boolean).length <= 3 && !/[,;]\s*$/.test(prefix);
      const restOk = rest.trim().length <= 60 && !looksLikeTocLine(rest);
      if (prefixOk && restOk) {
        // If the heading's label sits on its own line above ("Chapter 3" / "Title"), start there.
        let start = ls;
        if (ls > 0) {
          const prevStart = lineStartOf(text, ls - 1);
          const prevLine = text.slice(prevStart, ls - 1).trim();
          if (new RegExp(`^(${KW})?\\s*([0-9]{1,3}|[IVXLCDM]{1,7})[.:]?$`, 'i').test(prevLine)) start = prevStart;
        }
        hits.push({ number: entry.number || String(i + 1), title: entry.title, start });
        cursor = m.index + m[0].length;
        break;
      }
    }
  });
  return hits;
}

/** Strategy 2: hybrid — search for "<Keyword> <number>" headings, titles taken from the TOC. */
export function detectHybridNumber(text, toc) {
  const hits = [];
  let cursor = tocSkip(text);
  toc.forEach((entry, i) => {
    let n = parseNum(entry.number);
    if (Number.isNaN(n)) n = i + 1;
    const kw = keywordOf(entry.number);
    const kwAlt = kw ? escapeRe(kw) : KEYWORDS.join('|');
    const wordForm = Object.keys(NUMBER_WORDS).find((k) => NUMBER_WORDS[k] === n);
    const numAlt = [String(n), intToRoman(n), wordForm].filter(Boolean).map((x) => escapeRe(String(x))).join('|');
    const re = new RegExp(`(^|\\n)[ \\t]*(?:${kwAlt})[ \\t]+(?:${numAlt})(?!\\w|\\.\\d)`, 'gi');
    re.lastIndex = cursor;
    const titleProbe = entry.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
    let first = null;
    let chosen = null;
    let m;
    let guard = 0;
    while ((m = re.exec(text)) && guard++ < 50) {
      const lineEnd = lineEndOf(text, m.index + m[0].length);
      if (looksLikeTocLine(text.slice(m.index + m[0].length, lineEnd))) continue;
      if (!first) first = m;
      const around = text.slice(m.index, m.index + 300).toLowerCase();
      if (!titleProbe.length || titleProbe.every((w) => around.includes(w))) { chosen = m; break; }
    }
    const pick = chosen || first;
    if (pick) {
      const start = pick.index + (pick[1] ? pick[1].length : 0);
      hits.push({ number: entry.number || String(n), title: entry.title, start });
      cursor = pick.index + pick[0].length;
    }
  });
  return hits;
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'via', 'with']);

// How the document itself spells a word in running prose (lines that also contain lowercase):
// "IEEE" stays upper, "DEVSECOPS" becomes "DevSecOps". null when the prose never uses it.
export function proseSpelling(text, word) {
  const core = word.replace(/^\W+|\W+$/g, '');
  if (core.length < 2 || !text) return null;
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(core)}(?![\\p{L}\\p{N}])`, 'giu');
  const counts = new Map();
  let m;
  let seen = 0;
  while ((m = re.exec(text)) && seen++ < 400) {
    const line = text.slice(lineStartOf(text, m.index), lineEndOf(text, m.index));
    if (line === line.toUpperCase()) continue; // another all-caps heading
    counts.set(m[0], (counts.get(m[0]) || 0) + 1);
  }
  if (!counts.size) return null;
  const [form] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return word.replace(core, form);
}

/**
 * "PRODUCT STRATEGY & MARKET ANALYSIS" → "Product Strategy & Market Analysis"; other titles
 * unchanged. With `text`, acronyms and mixed-case names follow the document's own spelling.
 */
export function smartCase(title, text = '') {
  const t = String(title || '').trim();
  if (!/[A-Z]/.test(t) || t !== t.toUpperCase()) return t;
  let inParens = false;
  return t.split(/\s+/).map((word, i) => {
    if (word.startsWith('(')) inParens = true;
    const bare = word.replace(/\W/g, '');
    const lower = word.toLowerCase();
    const inPar = inParens;
    if (word.endsWith(')')) inParens = false;
    if (i > 0 && SMALL_WORDS.has(lower)) return lower;
    const prose = proseSpelling(text, word);
    if (prose && prose !== prose.toLowerCase()) return prose === prose.toUpperCase() ? word : prose; // acronym / DevSecOps
    if (!prose && (inPar || /\d/.test(word) || bare.length <= 3)) return word; // likely an acronym
    return lower.replace(/(^|[-/])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
  }).join(' ');
}

// How heading-like one occurrence is: documents often repeat "Clause 5 — Title" in overview lists
// and cross-references before the real heading, so the best-scoring occurrence wins, not the first.
function headingScore(line, sep, title) {
  let score = 0;
  if (sep && title) score += 2; // "Clause 5 — Title"
  const letters = line.replace(/[^\p{L}]/gu, '');
  if (letters.length >= 6 && letters === letters.toUpperCase()) score += 2; // "CLAUSE 5 — TITLE"
  if (/^[ \t]/.test(line)) score -= 1; // indented list entry
  return score;
}

/** Strategy 3: pure regex headings like "Chapter 1: Title" or "Part II — Title". */
export function detectRegexHeadings(text, toc = []) {
  const numberWords = Object.keys(NUMBER_WORDS).join('|');
  const re = new RegExp(
    `^[ \\t]*(${KEYWORDS.join('|')})[ \\t]+([0-9]{1,3}|[IVXLCDM]{1,7}|${numberWords})(?!\\w|\\.\\d)[ \\t]*([:.\\-—–])?[ \\t]*(.*)$`,
    'gim',
  );
  const skip = tocSkip(text);
  const raw = [];
  let m;
  while ((m = re.exec(text))) {
    const kw = m[1];
    const num = parseNum(m[2]);
    if (Number.isNaN(num)) continue;
    const sep = m[3];
    let title = (m[4] || '').trim();
    if (looksLikeTocLine(title)) continue;
    const nextLines = () => text.slice(m.index + m[0].length).split('\n').map((l) => l.trim()).filter(Boolean);
    if (!title) {
      // Title on the following non-empty line.
      const after = nextLines()[0] || '';
      if (after.length > 0 && after.length <= 120 && !looksLikeTocLine(after)) title = after;
    } else if (!sep && (title.length > 80 || /^[a-z]/.test(title))) {
      continue; // Prose like "Part 2 of the process is ..."
    } else if (/(?:[&,\-–—:]|\b(?:and|of|for|the))$/i.test(title)) {
      // Title wrapped onto the next line ("IMPLEMENTATION, DEVSECOPS &" / "DEPLOYMENT").
      const cont = nextLines()[0] || '';
      if (cont && cont.length <= 60 && !looksLikeTocLine(cont)) title = `${title} ${cont}`;
    }
    const kwName = kw[0].toUpperCase() + kw.slice(1).toLowerCase();
    raw.push({ kw: kwName, num, label: `${kwName} ${m[2]}`, title: title || `${kwName} ${m[2]}`, start: m.index, score: headingScore(m[0], sep, title) });
  }
  if (!raw.length) return [];

  // Keep the heading level with the most distinct entries (e.g. Chapters over Parts).
  const byKw = new Map();
  for (const r of raw) byKw.set(r.kw, [...(byKw.get(r.kw) || []), r]);
  let bestKw = '';
  let bestCount = -1;
  for (const [kw, list] of byKw) {
    const distinct = new Set(list.map((r) => r.num)).size;
    if (distinct > bestCount || (distinct === bestCount && kw === 'Chapter')) { bestKw = kw; bestCount = distinct; }
  }
  const list = byKw.get(bestKw) || [];

  // De-duplicate by number: prefer occurrences after the TOC region, then the most heading-like one,
  // then the earliest.
  const byNum = new Map();
  for (const r of list) {
    const prev = byNum.get(r.num);
    if (!prev || (prev.start < skip && r.start >= skip) || (r.start >= skip && r.score > prev.score)) byNum.set(r.num, r);
  }
  // Prefer the TOC's (usually properly cased) title for the same number.
  const sameLevel = (e) => e.number && (keywordOf(e.number) || bestKw).toLowerCase() === bestKw.toLowerCase();
  const tocTitle = new Map(toc.filter(sameLevel).map((e) => [parseNum(e.number), e.title]));
  return [...byNum.values()]
    .sort((a, b) => a.start - b.start)
    .map((r) => ({ number: r.label, title: tocTitle.get(r.num) || smartCase(r.title, text), start: r.start }));
}

/**
 * Non-AI last resort: plain numbered top-level headings ("1 Introduction", "2. Scope") that
 * appear in sequence 1, 2, 3… after the TOC region.
 */
export function detectNumberedHeadings(text) {
  const re = /^[ \t]*(\d{1,2})\.?[ \t]+([A-Z][^\n]{2,80})$/gm;
  const hits = [];
  let expected = 1;
  re.lastIndex = tocSkip(text);
  let m;
  while ((m = re.exec(text))) {
    const n = parseInt(m[1], 10);
    const title = m[2].trim();
    if (n !== expected || looksLikeTocLine(title) || /[.!?,;:]$/.test(title)) continue;
    hits.push({ number: String(n), title, start: m.index });
    expected++;
  }
  return hits;
}

export function buildChapters(text, hits) {
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const deduped = [];
  for (const h of sorted) {
    if (deduped.length && h.start - deduped[deduped.length - 1].start < 50) continue;
    deduped.push(h);
  }
  const chapters = [];
  deduped.forEach((h, i) => {
    const end = i + 1 < deduped.length ? deduped[i + 1].start : text.length;
    const content = text.slice(h.start, end).trim();
    if (content.length < 40) return;
    chapters.push({ number: String(h.number || i + 1), title: h.title.trim(), content });
  });
  return chapters;
}

/** Run all strategies; the one with the most chapters wins (ties keep the listed order). */
export function detectChapters(text, toc = []) {
  const candidates = [
    { name: 'toc_guided', chapters: toc.length ? buildChapters(text, detectTocGuided(text, toc)) : [] },
    { name: 'hybrid_number', chapters: toc.length ? buildChapters(text, detectHybridNumber(text, toc)) : [] },
    { name: 'regex_headings', chapters: buildChapters(text, detectRegexHeadings(text, toc)) },
  ];
  const ranked = [...candidates].sort((a, b) => b.chapters.length - a.chapters.length);
  return { best: ranked[0], candidates };
}

// ---- sections, titles, summaries ---------------------------------------------------------

export function countSections(content) {
  const found = new Set();
  const re = /^[ \t]*(?:section[ \t]+)?(\d+(?:\.\d+)+)\.?[ \t]+\S/gim;
  let m;
  while ((m = re.exec(content))) found.add(m[1]);
  return found.size;
}

/**
 * Numbered sub-section headings inside chapter content → [{ number, title, label }].
 * When the chapter number is known, sections of other chapters (cross references) are dropped.
 */
export function detectSections(content, chapterNumber, limit = 40) {
  const out = [];
  const seen = new Set();
  const re = /^[ \t]*(?:section[ \t]+)?(\d+(?:\.\d+)+)\.?[ \t]+([^\n]{2,100})$/gim;
  let m;
  while ((m = re.exec(String(content || '')))) {
    const rest = m[2].trim();
    if (/\.{3,}|\s\d{1,4}$/.test(rest)) continue; // TOC line
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
    out.push({ number: m[1], title: rest, label: `${m[1]} ${rest}` });
    if (out.length >= limit) break;
  }
  const major = parseNum(chapterNumber);
  if (!Number.isNaN(major)) {
    const own = out.filter((s) => parseInt(s.number, 10) === major);
    if (own.length) return own;
  }
  return out;
}

export function needsTitleCorrection(title) {
  const t = (title || '').trim();
  if (!t) return true;
  if (/^[a-z]/.test(t)) return true; // starts lowercase
  if (t.length > 120) return true; // too long
  const words = t.split(/\s+/).length;
  // Sentence-like: many words, terminal punctuation, or an internal sentence break.
  if (words > 14) return true;
  if (/[.!?]$/.test(t) && words > 4) return true;
  if (/[.!?]\s+[A-Z]/.test(t)) return true;
  return false;
}

/** Non-AI title correction: first clause, at most 10 words, capitalised. */
export function heuristicTitle(title, number) {
  const first = String(title || '').trim().split(/(?<=[.!?])\s+/)[0].replace(/[.!?:;,]+$/, '');
  const words = first.split(/\s+/).filter(Boolean).slice(0, 10).join(' ');
  if (!words) return number ? `Chapter ${String(number).replace(/^chapter\s+/i, '')}` : 'Untitled chapter';
  return words[0].toUpperCase() + words.slice(1);
}

const SECTION_HEADING = /^\s*(?:section\s+)?\d+(?:\.\d+)+\.?\s+\S/i;

/** Non-AI summary: the first ~2 sentences of the chapter body (heading lines skipped). */
export function summarizeChapter(content, maxSentences = 2) {
  const lines = String(content || '').split('\n');
  let i = 0;
  // Leading heading block: short lines without terminal punctuation.
  while (i < lines.length && i < 6) {
    const l = lines[i].trim();
    if (!l || (l.length <= 100 && !/[.!?]["')\]]?$/.test(l))) { i++; continue; }
    break;
  }
  const body = lines.slice(i).filter((l) => !SECTION_HEADING.test(l)).join(' ').replace(/\s+/g, ' ').trim();
  const sentences = body.match(/[^.!?]+[.!?]+(?=\s|$)/g) || [];
  let out = sentences.slice(0, maxSentences).map((s) => s.trim()).join(' ');
  if (!out) out = body.slice(0, 300);
  if (out.length > 600) out = `${out.slice(0, 597).replace(/\s+\S*$/, '')}…`;
  return out;
}

/** Split text into ≤ maxChars chunks at paragraph (then line) boundaries. */
export function splitContent(text, maxChars) {
  const paras = String(text || '').split(/\n{2,}/);
  const chunks = [];
  let cur = '';
  const push = () => { if (cur.trim()) chunks.push(cur.trim()); cur = ''; };
  for (const p of paras) {
    if (p.length > maxChars) {
      push();
      for (let k = 0; k < p.length; k += maxChars) chunks.push(p.slice(k, k + maxChars).trim());
      continue;
    }
    if (cur && cur.length + p.length + 2 > maxChars) push();
    cur += (cur ? '\n\n' : '') + p;
  }
  push();
  return chunks.filter(Boolean);
}

/** Split into `parts` roughly equal chunks at paragraph boundaries. */
export function splitEvenly(text, parts) {
  if (parts <= 1) return [String(text || '').trim()];
  const target = Math.ceil(String(text || '').length / parts);
  const paras = String(text || '').split(/\n{2,}|\n(?=[A-Z0-9])/);
  const chunks = [];
  let cur = '';
  for (const p of paras) {
    cur += (cur ? '\n\n' : '') + p;
    if (cur.length >= target && chunks.length < parts - 1) { chunks.push(cur.trim()); cur = ''; }
  }
  if (cur.trim()) chunks.push(cur.trim());
  return chunks.filter(Boolean);
}

/** Locate the line where `startText` (first words of a chapter) occurs, from `from`. */
export function findStart(text, startText, from) {
  const words = String(startText || '')
    .replace(/[^\p{L}\p{N}&'’\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 10);
  if (words.length < 2) return -1;
  const re = new RegExp(words.map(escapeRe).join('[\\s\\W]{1,6}'), 'giu');
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? lineStartOf(text, m.index) : -1;
}
