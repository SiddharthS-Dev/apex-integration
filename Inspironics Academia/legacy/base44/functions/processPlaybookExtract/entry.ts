// processPlaybookExtract — download an uploaded playbook (PDF / DOCX), extract its text,
// detect chapters, enrich with LLM metadata + summaries, and persist Chapters and a
// PlaybookVersion snapshot.
//
// Payload: { playbook_id }   (admin only)
// Returns: { ok: true, stage: 'extract', playbook_id, chapter_count }

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';
import pdf from 'npm:pdf-parse@1.1.1/lib/pdf-parse.js';
import JSZip from 'npm:jszip@3.10.1';
import { Buffer } from 'node:buffer';

const MAX_CHAPTER_CHARS = 12000;
const TOC_SKIP_CHARS = 5000;
const TOC_LLM_SAMPLE = 15000;
const FALLBACK_SAMPLE = 200000;
const KEYWORDS = ['Chapter', 'Volume', 'Part', 'Book', 'Module', 'Unit'];
const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

type TocEntry = { number?: string; title: string };
type Hit = { number?: string; title: string; start: number };
type DraftChapter = { number: string; title: string; content: string; summary?: string; section_count?: number };

// ---------------------------------------------------------------------------
// Generic helpers
// ---------------------------------------------------------------------------

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<unknown>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
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

function intToRoman(n: number): string {
  const table: [number, string][] = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'], [100, 'C'], [90, 'XC'],
    [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, sym] of table) {
    while (n >= v) { out += sym; n -= v; }
  }
  return out;
}

function parseNum(raw?: string): number {
  if (!raw) return NaN;
  const s = String(raw).trim().replace(/^(chapter|volume|part|book|module|unit)\s+/i, '').replace(/[.:)\]]+$/, '');
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const w = NUMBER_WORDS[s.toLowerCase()];
  if (w) return w;
  return romanToInt(s);
}

function keywordOf(raw?: string): string | null {
  if (!raw) return null;
  const m = String(raw).trim().match(/^(chapter|volume|part|book|module|unit)\b/i);
  return m ? m[1] : null;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function normalizeText(s: string): string {
  return s
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(/ /g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// File download + parsing
// ---------------------------------------------------------------------------

async function downloadFile(base44: any, fileUrl: string): Promise<ArrayBuffer> {
  let url = fileUrl;
  if (!/^http/i.test(fileUrl)) {
    const res = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
      file_uri: fileUrl,
      expires_in: 600,
    });
    url = res?.signed_url;
    if (!url) throw new Error('Could not create a signed URL for the private playbook file');
  }
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Failed to download playbook file (HTTP ${resp.status})`);
  return await resp.arrayBuffer();
}

function detectFileType(playbook: any, buf: ArrayBuffer): 'pdf' | 'docx' | 'text' {
  const ft = String(playbook.file_type || '').toLowerCase();
  const name = String(playbook.file_name || playbook.file_url || '').toLowerCase().split('?')[0];
  if (ft.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (ft.includes('docx') || ft.includes('wordprocessingml') || ft.includes('msword') || name.endsWith('.docx')) return 'docx';
  if (ft.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md')) return 'text';
  // Fall back to magic bytes.
  const b = new Uint8Array(buf.slice(0, 4));
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf'; // %PDF
  if (b[0] === 0x50 && b[1] === 0x4b) return 'docx'; // PK (zip)
  throw new Error(`Unsupported file type "${playbook.file_type || name}". Upload a PDF or DOCX file.`);
}

async function extractPdfText(buf: ArrayBuffer): Promise<string> {
  const data = await pdf(Buffer.from(new Uint8Array(buf)));
  return String(data?.text || '');
}

async function extractDocxText(buf: ArrayBuffer): Promise<string> {
  const zip = await JSZip.loadAsync(new Uint8Array(buf));
  const docFile = zip.file('word/document.xml');
  if (!docFile) throw new Error('Invalid DOCX: word/document.xml not found');
  const xml: string = await docFile.async('string');
  const text = xml
    .replace(/<w:tab\s*\/>/g, '\t')
    .replace(/<w:br\s*\/>/g, '\n')
    .replace(/<w:cr\s*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXmlEntities(text);
}

// ---------------------------------------------------------------------------
// Table of contents
// ---------------------------------------------------------------------------

function parseTocSummary(toc: string): TocEntry[] {
  const entries: TocEntry[] = [];
  for (const rawLine of toc.split('\n')) {
    const line = rawLine.trim().replace(/\.{3,}\s*\d+\s*$/, '').replace(/\s+\d+\s*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^((?:chapter|volume|part|book|module|unit)\s+)?([0-9]{1,3}|[IVXLCDM]{1,7})\s*[.:)\-—–]\s*(.+)$/i);
    if (m) entries.push({ number: `${m[1] || ''}${m[2]}`.trim(), title: m[3].trim() });
    else entries.push({ title: line });
  }
  return entries;
}

async function fetchTocViaLLM(base44: any, text: string) {
  const sample = text.slice(0, TOC_LLM_SAMPLE);
  const prompt = `You are a meticulous technical librarian. Below are the first ~${TOC_LLM_SAMPLE.toLocaleString()} characters of an engineering playbook, extracted from a PDF/DOCX (layout may be noisy: broken lines, page numbers, running headers).

Tasks:
1. Identify the document metadata: title, author (person or team), version (e.g. "2.1", "v3", "Rev B"), and organization. Use "" when a value is not present — never invent.
2. Extract the TOP-LEVEL table of contents in reading order. Prefer an explicit "Contents" / "Table of Contents" section. If none exists, list the top-level chapter headings visible in the text.
   - Copy each title EXACTLY as printed (same words and capitalization) but WITHOUT page numbers, dotted leaders or the chapter keyword.
   - "number" is the label as printed including its keyword when there is one (e.g. "Chapter 3", "Part II", "4"); use "" if unnumbered.
   - Include only top-level entries (chapters/parts), not sub-sections like 3.1 or 3.2.
   - Do not include front matter such as "Contents", "Copyright", "Revision History" unless they are real chapters.

DOCUMENT START
"""
${sample}
"""
DOCUMENT END`;
  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        version: { type: 'string' },
        organization: { type: 'string' },
        toc: {
          type: 'array',
          items: {
            type: 'object',
            properties: { number: { type: 'string' }, title: { type: 'string' } },
            required: ['title'],
          },
        },
      },
      required: ['toc'],
    },
  });
  const toc: TocEntry[] = (Array.isArray(res?.toc) ? res.toc : [])
    .filter((e: any) => e && typeof e.title === 'string' && e.title.trim())
    .map((e: any) => ({ number: String(e.number || '').trim() || undefined, title: e.title.trim() }));
  return {
    toc,
    meta: {
      title: String(res?.title || '').trim(),
      author: String(res?.author || '').trim(),
      version: String(res?.version || '').trim(),
      organization: String(res?.organization || '').trim(),
    },
  };
}

// ---------------------------------------------------------------------------
// Chapter detection strategies
// ---------------------------------------------------------------------------

function tocSkip(text: string): number {
  // Skip the TOC region; for very small documents skip proportionally less.
  return text.length > TOC_SKIP_CHARS * 4 ? TOC_SKIP_CHARS : Math.floor(text.length * 0.05);
}

function lineStartOf(text: string, idx: number): number {
  return text.lastIndexOf('\n', idx - 1) + 1;
}

function lineEndOf(text: string, idx: number): number {
  const e = text.indexOf('\n', idx);
  return e === -1 ? text.length : e;
}

function looksLikeTocLine(rest: string): boolean {
  return /\.{3,}|…{2,}|\s\d{1,4}\s*$/.test(rest);
}

/** Strategy 1: TOC-guided — search for each TOC title (in order) as a heading line. */
function detectTocGuided(text: string, toc: TocEntry[]): Hit[] {
  const hits: Hit[] = [];
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
    let m: RegExpExecArray | null;
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
          if (/^(chapter|volume|part|book|module|unit)?\s*([0-9]{1,3}|[IVXLCDM]{1,7})[.:]?$/i.test(prevLine)) start = prevStart;
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
function detectHybridNumber(text: string, toc: TocEntry[]): Hit[] {
  const hits: Hit[] = [];
  let cursor = tocSkip(text);
  toc.forEach((entry, i) => {
    let n = parseNum(entry.number);
    if (isNaN(n)) n = i + 1;
    const kw = keywordOf(entry.number);
    const kwAlt = kw ? escapeRe(kw) : KEYWORDS.join('|');
    const wordForm = Object.keys(NUMBER_WORDS).find((k) => NUMBER_WORDS[k] === n);
    const numAlt = [String(n), intToRoman(n), wordForm].filter(Boolean).map((x) => escapeRe(String(x))).join('|');
    const re = new RegExp(`(^|\\n)[ \\t]*(?:${kwAlt})[ \\t]+(?:${numAlt})(?!\\w|\\.\\d)`, 'gi');
    re.lastIndex = cursor;
    const titleProbe = entry.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3).slice(0, 2);
    let first: RegExpExecArray | null = null;
    let chosen: RegExpExecArray | null = null;
    let m: RegExpExecArray | null;
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

/** Strategy 3: pure regex headings like "Chapter 1: Title" or "Part II — Title". */
function detectRegexHeadings(text: string): Hit[] {
  const numberWords = Object.keys(NUMBER_WORDS).join('|');
  const re = new RegExp(
    `^[ \\t]*(${KEYWORDS.join('|')})[ \\t]+([0-9]{1,3}|[IVXLCDM]{1,7}|${numberWords})(?!\\w|\\.\\d)[ \\t]*([:.\\-—–])?[ \\t]*(.*)$`,
    'gim',
  );
  const skip = tocSkip(text);
  const raw: { kw: string; num: number; label: string; title: string; start: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const kw = m[1];
    const num = parseNum(m[2]);
    if (isNaN(num)) continue;
    const sep = m[3];
    let title = (m[4] || '').trim();
    if (looksLikeTocLine(title)) continue;
    if (!title) {
      // Title on the following non-empty line.
      const after = text.slice(m.index + m[0].length).split('\n').map((l) => l.trim()).find(Boolean) || '';
      if (after.length > 0 && after.length <= 120 && !looksLikeTocLine(after)) title = after;
    } else if (!sep && (title.length > 80 || /^[a-z]/.test(title))) {
      continue; // Prose like "Part 2 of the process is ..."
    }
    raw.push({ kw: kw[0].toUpperCase() + kw.slice(1).toLowerCase(), num, label: `${kw} ${m[2]}`, title: title || `${kw} ${m[2]}`, start: m.index });
  }
  if (!raw.length) return [];

  // Keep the heading level with the most distinct entries (e.g. Chapters over Parts).
  const byKw = new Map<string, typeof raw>();
  for (const r of raw) byKw.set(r.kw, [...(byKw.get(r.kw) || []), r]);
  let bestKw = '';
  let bestCount = -1;
  for (const [kw, list] of byKw) {
    const distinct = new Set(list.map((r) => r.num)).size;
    if (distinct > bestCount || (distinct === bestCount && kw === 'Chapter')) { bestKw = kw; bestCount = distinct; }
  }
  const list = byKw.get(bestKw) || [];

  // De-duplicate by number, preferring occurrences after the TOC region.
  const byNum = new Map<number, (typeof raw)[number]>();
  for (const r of list) {
    const prev = byNum.get(r.num);
    if (!prev || (prev.start < skip && r.start >= skip)) byNum.set(r.num, r);
  }
  return [...byNum.values()]
    .sort((a, b) => a.start - b.start)
    .map((r) => ({ number: r.label, title: r.title, start: r.start }));
}

function buildChapters(text: string, hits: Hit[]): DraftChapter[] {
  const sorted = [...hits].sort((a, b) => a.start - b.start);
  const deduped: Hit[] = [];
  for (const h of sorted) {
    if (deduped.length && h.start - deduped[deduped.length - 1].start < 50) continue;
    deduped.push(h);
  }
  const chapters: DraftChapter[] = [];
  deduped.forEach((h, i) => {
    const end = i + 1 < deduped.length ? deduped[i + 1].start : text.length;
    const content = text.slice(h.start, end).trim();
    if (content.length < 40) return;
    chapters.push({ number: String(h.number || i + 1), title: h.title.trim(), content });
  });
  return chapters;
}

function countSections(content: string): number {
  const found = new Set<string>();
  const re = /^[ \t]*(?:section[ \t]+)?(\d+(?:\.\d+)+)\.?[ \t]+\S/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) found.add(m[1]);
  return found.size;
}

function needsTitleCorrection(title: string): boolean {
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

// ---------------------------------------------------------------------------
// LLM enrichment
// ---------------------------------------------------------------------------

async function enrichChapters(base44: any, text: string, chapters: DraftChapter[]) {
  const perChapter = Math.max(600, Math.min(3000, Math.floor(120000 / chapters.length)));
  const blocks = chapters.map((c, i) => {
    const flag = needsTitleCorrection(c.title);
    return `### CHAPTER index=${i}
Detected number: ${c.number}
Detected title: ${c.title}
Title needs correction: ${flag ? 'YES' : 'NO'}
Excerpt:
"""
${c.content.slice(0, perChapter)}
"""`;
  });

  const prompt = `You are an expert technical editor preparing an engineering playbook for a learning platform.
The chapters below were detected automatically and their content is kept VERBATIM — do not rewrite content.

Your job:
1. From the document opening, identify metadata: title, author, version, organization. Use "" when not stated — never invent values.
2. For EVERY chapter (by index) write a factual 2-4 sentence summary of what the chapter teaches, based only on its excerpt. Mention the key concepts, practices or procedures covered.
3. Title correction — ONLY for chapters marked "Title needs correction: YES": provide "corrected_title", a concise heading (max 10 words, Title Case) taken from the actual heading in the excerpt when visible, otherwise a faithful descriptive title. For chapters marked NO, return "corrected_title": "".

Return one entry per chapter, using the same index values (0..${chapters.length - 1}).

DOCUMENT OPENING
"""
${text.slice(0, 6000)}
"""

CHAPTERS
${blocks.join('\n\n')}`;

  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        version: { type: 'string' },
        organization: { type: 'string' },
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              index: { type: 'number' },
              summary: { type: 'string' },
              corrected_title: { type: 'string' },
            },
            required: ['index', 'summary'],
          },
        },
      },
      required: ['chapters'],
    },
  });

  const byIndex = new Map<number, any>();
  for (const c of Array.isArray(res?.chapters) ? res.chapters : []) {
    if (typeof c?.index === 'number') byIndex.set(Math.round(c.index), c);
  }
  chapters.forEach((c, i) => {
    const info = byIndex.get(i);
    if (!info) return;
    c.summary = String(info.summary || '').trim();
    const corrected = String(info.corrected_title || '').trim();
    if (corrected && needsTitleCorrection(c.title)) c.title = corrected;
  });

  return {
    title: String(res?.title || '').trim(),
    author: String(res?.author || '').trim(),
    version: String(res?.version || '').trim(),
    organization: String(res?.organization || '').trim(),
  };
}

function findStart(text: string, startText: string, from: number): number {
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

async function llmFallbackChapters(base44: any, text: string) {
  const sample = text.slice(0, FALLBACK_SAMPLE);
  const prompt = `You are an expert technical editor. Automatic chapter detection failed for the engineering playbook below, so you must identify its structure.

Tasks:
1. Metadata: title, author, version, organization ("" when not stated — never invent).
2. Split the document into its logical top-level chapters in reading order (typically 3-30). If the document has no explicit chapters, group it into coherent topic chapters based on its headings.
   For each chapter return:
   - "number": the chapter label as printed (e.g. "1", "Part II"), or its ordinal position if unnumbered.
   - "title": a concise, faithful chapter title (max 10 words, Title Case).
   - "start_text": the EXACT first 8-15 words where the chapter begins in the document (usually its heading line), copied verbatim so it can be located by text search. Skip the table of contents — point to the chapter body.
   - "summary": a factual 2-4 sentence summary of what the chapter covers.
   - "section_count": number of sub-sections/headings in the chapter.
   - "key_content": a faithful, detailed condensation of the chapter's content (up to ~800 words) preserving procedures, rules, numbers and terminology. Used only if the chapter cannot be located.

DOCUMENT
"""
${sample}
"""`;
  const res = await base44.asServiceRole.integrations.Core.InvokeLLM({
    prompt,
    response_json_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        author: { type: 'string' },
        version: { type: 'string' },
        organization: { type: 'string' },
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: 'string' },
              title: { type: 'string' },
              start_text: { type: 'string' },
              summary: { type: 'string' },
              section_count: { type: 'number' },
              key_content: { type: 'string' },
            },
            required: ['title', 'summary'],
          },
        },
      },
      required: ['chapters'],
    },
  });

  const items = (Array.isArray(res?.chapters) ? res.chapters : []).filter((c: any) => c && String(c.title || '').trim());
  // Locate each chapter's start in the verbatim text so content stays verbatim where possible.
  let cursor = tocSkip(text);
  const located = items.map((c: any) => {
    const pos = findStart(text, c.start_text, cursor);
    if (pos >= 0) cursor = pos + 1;
    return { c, pos };
  });
  const positions = located.map((l: any) => l.pos).filter((p: number) => p >= 0);
  const chapters: DraftChapter[] = located.map(({ c, pos }: any, i: number) => {
    let content = '';
    if (pos >= 0) {
      const next = positions.find((p: number) => p > pos);
      content = text.slice(pos, next ?? text.length).trim();
    }
    if (!content) content = String(c.key_content || c.summary || '').trim();
    return {
      number: String(c.number || i + 1).trim(),
      title: String(c.title).trim(),
      content,
      summary: String(c.summary || '').trim(),
      section_count: typeof c.section_count === 'number' ? Math.max(0, Math.round(c.section_count)) : undefined,
    };
  });

  return {
    chapters,
    meta: {
      title: String(res?.title || '').trim(),
      author: String(res?.author || '').trim(),
      version: String(res?.version || '').trim(),
      organization: String(res?.organization || '').trim(),
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  let base44: any;
  let playbookId: string | undefined;
  try {
    base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    playbookId = body?.playbook_id;
    if (!playbookId) return Response.json({ error: 'playbook_id is required' }, { status: 400 });

    const sr = base44.asServiceRole.entities;
    const playbook = await sr.Playbook.get(playbookId);
    if (!playbook) return Response.json({ error: 'Playbook not found' }, { status: 404 });
    if (!playbook.file_url) throw new Error('Playbook has no file_url');

    await sr.Playbook.update(playbookId, { status: 'processing', progress: 15, error: '' });

    // 1. Download + parse -----------------------------------------------------
    const buf = await downloadFile(base44, playbook.file_url);
    const kind = detectFileType(playbook, buf);
    let rawText = '';
    if (kind === 'pdf') rawText = await extractPdfText(buf);
    else if (kind === 'docx') rawText = await extractDocxText(buf);
    else rawText = new TextDecoder().decode(buf);
    const text = normalizeText(rawText);
    if (text.length < 200) {
      throw new Error('No extractable text found in the file (it may be a scanned image or empty).');
    }
    await sr.Playbook.update(playbookId, { progress: 30 });

    // 2. Table of contents ---------------------------------------------------
    let toc: TocEntry[] = [];
    let tocMeta = { title: '', author: '', version: '', organization: '' };
    if (playbook.toc_summary && String(playbook.toc_summary).trim()) {
      toc = parseTocSummary(String(playbook.toc_summary));
    }
    if (!toc.length) {
      try {
        const r = await fetchTocViaLLM(base44, text);
        toc = r.toc;
        tocMeta = r.meta;
      } catch (e) {
        console.error('TOC LLM call failed, continuing with regex detection only:', errMsg(e));
      }
    }

    // 3. Chapter detection: three strategies, pick the one with most results --
    const candidates: { name: string; chapters: DraftChapter[] }[] = [
      { name: 'toc_guided', chapters: toc.length ? buildChapters(text, detectTocGuided(text, toc)) : [] },
      { name: 'hybrid_number', chapters: toc.length ? buildChapters(text, detectHybridNumber(text, toc)) : [] },
      { name: 'regex_headings', chapters: buildChapters(text, detectRegexHeadings(text)) },
    ];
    candidates.sort((a, b) => b.chapters.length - a.chapters.length);
    const best = candidates[0];
    console.log('Chapter detection results:', candidates.map((c) => `${c.name}=${c.chapters.length}`).join(', '));

    let chapters: DraftChapter[];
    let meta = { title: '', author: '', version: '', organization: '' };

    if (best.chapters.length >= 2) {
      // Verbatim content; LLM only for metadata, summaries and conditional title fixes.
      chapters = best.chapters;
      try {
        meta = await enrichChapters(base44, text, chapters);
      } catch (e) {
        console.error('Chapter enrichment failed, continuing without summaries:', errMsg(e));
      }
      chapters.forEach((c) => { c.section_count = countSections(c.content); });
    } else {
      const r = await llmFallbackChapters(base44, text);
      chapters = r.chapters;
      meta = r.meta;
      chapters.forEach((c) => {
        const counted = countSections(c.content);
        c.section_count = counted || c.section_count || 0;
      });
    }

    if (!chapters.length) {
      // Last resort: treat the whole document as a single chapter.
      chapters = [{
        number: '1',
        title: meta.title || tocMeta.title || playbook.title,
        content: text,
        summary: '',
        section_count: countSections(text),
      }];
    }

    await sr.Playbook.update(playbookId, { progress: 40 });

    // 4. Update playbook metadata --------------------------------------------
    const pick = (...vals: string[]) => vals.find((v) => v && v.trim()) || '';
    const title = pick(meta.title, tocMeta.title, playbook.title);
    const version = pick(meta.version, tocMeta.version, playbook.version || '');
    const author = pick(meta.author, tocMeta.author, playbook.author || '');
    const organization = pick(meta.organization, tocMeta.organization, playbook.organization || '');
    const tocSummary = chapters.map((c) => `${c.number ? `${c.number}. ` : ''}${c.title}`).join('\n');

    await sr.Playbook.update(playbookId, {
      title,
      version,
      author,
      organization,
      toc_summary: tocSummary,
      chapter_count: chapters.length,
      progress: 50,
    });

    // 5. Replace chapters ----------------------------------------------------
    const old = await sr.Chapter.filter({ playbook_id: playbookId });
    await inBatches(old || [], 20, (c: any) => sr.Chapter.delete(c.id));

    const records = chapters.map((c) => ({
      playbook_id: playbookId,
      title: c.title.slice(0, 300),
      number: String(c.number || ''),
      summary: c.summary || '',
      content: c.content.slice(0, MAX_CHAPTER_CHARS),
      section_count: c.section_count || 0,
    }));
    await sr.Chapter.bulkCreate(records);

    // 6. Version snapshot ----------------------------------------------------
    const versions = await sr.PlaybookVersion.filter({ playbook_id: playbookId });
    const n = (versions?.length || 0) + 1;
    await sr.PlaybookVersion.create({
      playbook_id: playbookId,
      version_label: `v${n}${version ? ` (${version})` : ''}`,
      title,
      author,
      organization,
      chapter_count: records.length,
      toc_summary: tocSummary,
      file_name: playbook.file_name || '',
      file_size: playbook.file_size || 0,
      chapters_snapshot: JSON.stringify(
        records.map((r) => ({ number: r.number, title: r.title, summary: r.summary, content: r.content })),
      ),
    });

    await sr.Playbook.update(playbookId, { status: 'processed', error: '' });

    return Response.json({ ok: true, stage: 'extract', playbook_id: playbookId, chapter_count: records.length });
  } catch (e) {
    const message = errMsg(e);
    console.error('processPlaybookExtract failed:', message);
    if (base44 && playbookId) {
      try {
        await base44.asServiceRole.entities.Playbook.update(playbookId, { status: 'failed', error: message });
      } catch (_) { /* ignore */ }
    }
    return Response.json({ error: message }, { status: 500 });
  }
});
