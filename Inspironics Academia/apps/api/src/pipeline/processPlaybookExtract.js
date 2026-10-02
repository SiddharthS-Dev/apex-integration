import { aiEnabled, invokeLLM } from '../ai/claude.js';
import { loadPlaybookBytes } from '../files/playbookSource.js';
import { badRequest, notFound } from '../lib/errors.js';
import { log as defaultLog } from '../lib/logger.js';
import { entities } from '../repo/entities.js';
import {
  MAX_CHAPTER_CHARS, buildChapters, countSections, detectChapters, detectNumberedHeadings, extractTocFromText,
  findStart, heuristicTitle, needsTitleCorrection, parseTocSummary, splitContent, summarizeChapter, tocSkip,
} from './chapters.js';
import { extractText } from './text.js';
import { asHttpError, errMsg, pick, pipelineError, withPlaybookLock } from './util.js';

// processPlaybookExtract — load a playbook file (PDF / DOCX), extract its text, detect chapters,
// enrich with metadata + summaries (LLM when enabled, heuristics otherwise) and persist Chapters
// plus a PlaybookVersion snapshot.
//
// Payload: { playbook_id }
// Returns: { ok: true, stage: 'extract', playbook_id, chapter_count }

const TOC_LLM_SAMPLE = 15000;
const FALLBACK_SAMPLE = 200000;
const EMPTY_META = { title: '', author: '', version: '', organization: '' };

const metaOf = (res) => ({
  title: String(res?.title || '').trim(),
  author: String(res?.author || '').trim(),
  version: String(res?.version || '').trim(),
  organization: String(res?.organization || '').trim(),
});

const META_PROPS = {
  title: { type: 'string' },
  author: { type: 'string' },
  version: { type: 'string' },
  organization: { type: 'string' },
};

// ---- non-AI metadata ---------------------------------------------------------------------

function cleanDocTitle(t) {
  const s = String(t || '').trim();
  if (s.length < 3 || s.length > 200) return '';
  if (/^microsoft (word|powerpoint)|^untitled|\.(docx?|pdf|txt)$/i.test(s)) return '';
  return s;
}

export function titleFromFileName(name) {
  const base = String(name || '').split(/[\\/]/).pop().replace(/\.[a-z0-9]+$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim();
  return base ? base[0].toUpperCase() + base.slice(1) : '';
}

export function versionFrom(text) {
  const m = String(text || '').match(/\b(?:version|ver\.?|rev(?:ision)?)\s*[:#]?\s*(v?\d+(?:\.\d+){0,3}[a-z]?|[A-Z]\b)/i)
    || String(text || '').match(/\bv(\d+(?:\.\d+){1,3})\b/i);
  return m ? m[1] : '';
}

function documentMeta(text, info, playbook) {
  return {
    title: cleanDocTitle(info?.title),
    author: String(info?.author || '').trim(),
    organization: String(info?.organization || '').trim(),
    version: versionFrom(text.slice(0, 4000)) || versionFrom(titleFromFileName(playbook.file_name)),
  };
}

// ---- LLM paths ---------------------------------------------------------------------------

async function fetchTocViaLLM(text) {
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
  const res = await invokeLLM({
    prompt,
    maxTokens: 8000,
    effort: 'medium',
    schema: {
      type: 'object',
      properties: {
        ...META_PROPS,
        toc: {
          type: 'array',
          items: { type: 'object', properties: { number: { type: 'string' }, title: { type: 'string' } } },
        },
      },
    },
  });
  const toc = (Array.isArray(res?.toc) ? res.toc : [])
    .filter((e) => e && typeof e.title === 'string' && e.title.trim())
    .map((e) => ({ number: String(e.number || '').trim() || undefined, title: e.title.trim() }));
  return { toc, meta: metaOf(res) };
}

async function enrichChapters(text, chapters) {
  const perChapter = Math.max(600, Math.min(3000, Math.floor(120000 / chapters.length)));
  const blocks = chapters.map((c, i) => `### CHAPTER index=${i}
Detected number: ${c.number}
Detected title: ${c.title}
Title needs correction: ${needsTitleCorrection(c.title) ? 'YES' : 'NO'}
Excerpt:
"""
${c.content.slice(0, perChapter)}
"""`);

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

  const res = await invokeLLM({
    prompt,
    maxTokens: 32000,
    schema: {
      type: 'object',
      properties: {
        ...META_PROPS,
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: { index: { type: 'integer' }, summary: { type: 'string' }, corrected_title: { type: 'string' } },
          },
        },
      },
    },
  });

  const byIndex = new Map();
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
  return metaOf(res);
}

async function llmFallbackChapters(text) {
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
  const res = await invokeLLM({
    prompt,
    maxTokens: 64000,
    schema: {
      type: 'object',
      properties: {
        ...META_PROPS,
        chapters: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              number: { type: 'string' },
              title: { type: 'string' },
              start_text: { type: 'string' },
              summary: { type: 'string' },
              section_count: { type: 'integer' },
              key_content: { type: 'string' },
            },
          },
        },
      },
    },
  });

  const items = (Array.isArray(res?.chapters) ? res.chapters : []).filter((c) => c && String(c.title || '').trim());
  // Locate each chapter's start in the verbatim text so content stays verbatim where possible.
  let cursor = tocSkip(text);
  const located = items.map((c) => {
    const pos = findStart(text, c.start_text, cursor);
    if (pos >= 0) cursor = pos + 1;
    return { c, pos };
  });
  const positions = located.map((l) => l.pos).filter((p) => p >= 0);
  const chapters = located.map(({ c, pos }, i) => {
    let content = '';
    if (pos >= 0) {
      const next = positions.find((p) => p > pos);
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
  return { chapters, meta: metaOf(res) };
}

// ---- non-AI fallbacks --------------------------------------------------------------------

function heuristicFallbackChapters(text, title) {
  const numbered = buildChapters(text, detectNumberedHeadings(text));
  const avg = numbered.length ? numbered.reduce((s, c) => s + c.content.length, 0) / numbered.length : 0;
  if (numbered.length >= 2 && avg >= 500) return numbered;
  // No recognisable structure: keep all text by splitting it into ≤12k-char parts.
  const parts = splitContent(text, MAX_CHAPTER_CHARS);
  return parts.map((content, i) => ({
    number: String(i + 1),
    title: parts.length > 1 ? `${title} — Part ${i + 1}` : title,
    content,
  }));
}

// ---- handler -----------------------------------------------------------------------------

export default async function processPlaybookExtract(payload = {}, ctx = {}) {
  const log = ctx.log || defaultLog;
  const playbookId = payload?.playbook_id ? String(payload.playbook_id) : '';
  if (!playbookId) throw badRequest('playbook_id is required');
  const playbook = await entities.Playbook.get(playbookId);
  if (!playbook) throw notFound('Playbook not found');
  return withPlaybookLock(playbookId, () => run(playbook, log));
}

async function run(playbook, log) {
  const playbookId = playbook.id;
  const sr = entities;
  const useAI = aiEnabled();
  try {
    if (!playbook.file_url) throw pipelineError('Playbook has no file_url');
    await sr.Playbook.update(playbookId, { status: 'processing', progress: 15, error: '' });

    // 1. Load + parse -----------------------------------------------------------------------
    const bytes = await loadPlaybookBytes(playbook);
    const { text, info } = await extractText(playbook, bytes);
    if (text.length < 200) {
      throw pipelineError('No extractable text found in the file (it may be a scanned image or empty).');
    }
    await sr.Playbook.update(playbookId, { progress: 30 });
    const docMeta = documentMeta(text, info, playbook);
    const fallbackTitle = pick(docMeta.title, playbook.title, titleFromFileName(playbook.file_name), 'Playbook');

    // 2. Table of contents ------------------------------------------------------------------
    let toc = [];
    let tocMeta = EMPTY_META;
    if (playbook.toc_summary && String(playbook.toc_summary).trim()) toc = parseTocSummary(String(playbook.toc_summary));
    if (!toc.length && useAI) {
      try {
        ({ toc, meta: tocMeta } = await fetchTocViaLLM(text));
      } catch (e) {
        log.warn('pipeline.extract.toc_llm_failed', { playbook_id: playbookId, error: errMsg(e) });
      }
    }
    if (!toc.length) toc = extractTocFromText(text);

    // 3. Chapter detection: three strategies, pick the one with most results -----------------
    const { best, candidates } = detectChapters(text, toc);
    log.info('pipeline.extract.detection', {
      playbook_id: playbookId,
      ai: useAI,
      toc_entries: toc.length,
      results: candidates.map((c) => `${c.name}=${c.chapters.length}`).join(', '),
    });

    let chapters;
    let meta = EMPTY_META;
    if (best.chapters.length >= 2) {
      // Verbatim content; LLM only for metadata, summaries and conditional title fixes.
      chapters = best.chapters;
      if (useAI) {
        try {
          meta = await enrichChapters(text, chapters);
        } catch (e) {
          log.warn('pipeline.extract.enrich_failed', { playbook_id: playbookId, error: errMsg(e) });
        }
      }
      chapters.forEach((c) => { c.section_count = countSections(c.content); });
    } else if (useAI) {
      ({ chapters, meta } = await llmFallbackChapters(text));
      chapters.forEach((c) => { c.section_count = countSections(c.content) || c.section_count || 0; });
    } else {
      chapters = heuristicFallbackChapters(text, fallbackTitle);
      chapters.forEach((c) => { c.section_count = countSections(c.content); });
    }

    if (!chapters.length) {
      // Last resort: treat the whole document as a single chapter.
      chapters = [{ number: '1', title: pick(meta.title, tocMeta.title, fallbackTitle), content: text, summary: '', section_count: countSections(text) }];
    }

    // Heuristic summaries / title fixes wherever the LLM didn't provide them.
    for (const c of chapters) {
      if (!c.summary) c.summary = summarizeChapter(c.content);
      if (needsTitleCorrection(c.title)) c.title = heuristicTitle(c.title, c.number);
    }

    await sr.Playbook.update(playbookId, { progress: 40 });

    // 4. Update playbook metadata -----------------------------------------------------------
    const title = useAI ? pick(meta.title, tocMeta.title, playbook.title, docMeta.title) : pick(docMeta.title, playbook.title, fallbackTitle);
    const version = pick(meta.version, tocMeta.version, docMeta.version, playbook.version);
    const author = pick(meta.author, tocMeta.author, docMeta.author, playbook.author);
    const organization = pick(meta.organization, tocMeta.organization, docMeta.organization, playbook.organization);
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

    // 5. Replace chapters -------------------------------------------------------------------
    await sr.Chapter.deleteMany({ playbook_id: playbookId });
    const records = chapters.map((c) => ({
      playbook_id: playbookId,
      title: c.title.slice(0, 300),
      number: String(c.number || ''),
      summary: c.summary || '',
      content: c.content.slice(0, MAX_CHAPTER_CHARS),
      section_count: c.section_count || 0,
    }));
    await sr.Chapter.bulkCreate(records);

    // 6. Version snapshot -------------------------------------------------------------------
    const n = (await sr.PlaybookVersion.count({ playbook_id: playbookId })) + 1;
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
      chapters_snapshot: JSON.stringify(records.map((r) => ({ number: r.number, title: r.title, summary: r.summary, content: r.content }))),
    });

    await sr.Playbook.update(playbookId, { status: 'processed', error: '' });
    return { ok: true, stage: 'extract', playbook_id: playbookId, chapter_count: records.length };
  } catch (e) {
    const message = errMsg(e);
    log.error('pipeline.extract.failed', { playbook_id: playbookId, error: message });
    try {
      await sr.Playbook.update(playbookId, { status: 'failed', error: message });
    } catch { /* ignore */ }
    throw asHttpError(e);
  }
}
