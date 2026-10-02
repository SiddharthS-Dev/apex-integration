import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';

// Small extraction limit so the size check can be exercised; config is read at import time.
process.env.MAX_EXTRACT_MB = '1';
process.env.AI_ENABLED = 'false';

const chapters = await import('../src/pipeline/chapters.js');
const { extractDocx, extractText, detectFileType } = await import('../src/pipeline/text.js');
const { buildDeterministicCourse, guessVideoType } = await import('../src/pipeline/courseBuilder.js');

const {
  detectChapters, detectRegexHeadings, detectSections, extractTocFromText, heuristicTitle,
  needsTitleCorrection, parseTocSummary, sortChapters, summarizeChapter, countSections,
} = chapters;

// ---- synthetic playbook ------------------------------------------------------------------

const filler = (topic, n) => Array.from({ length: n }, (_, i) =>
  `Engineers working on ${topic} follow the documented practice number ${i + 1}. Each practice is reviewed quarterly by the platform group and recorded in the handbook.`,
).join('\n');

function samplePlaybook() {
  return [
    'Inspironics Engineering Handbook',
    'Version 2.1',
    '',
    'Table of Contents',
    'Part I — Foundations ........ 3',
    'Chapter 1: Introduction ........ 3',
    '1.1 Purpose ........ 4',
    'Chapter 2: Code Review Standards ........ 8',
    'Part II — Operations ........ 15',
    'Chapter 3: Incident Response ........ 15',
    'Chapter 4: Deployment Practices ........ 22',
    '',
    'Preface',
    filler('the preface', 30),
    '',
    'Part I — Foundations',
    'This part lays the groundwork for everything that follows in the handbook.',
    '',
    'Chapter 1: Introduction',
    'This chapter explains why the handbook exists. It sets expectations for every engineer. Later chapters build on it.',
    '1.1 Purpose',
    filler('the purpose', 12),
    '1.2 Scope',
    filler('the scope', 12),
    '',
    'Chapter 2: Code Review Standards',
    'Every change is reviewed before merge. Reviews focus on correctness and clarity.',
    '2.1 Review Checklist',
    filler('review checklists', 12),
    '2.2 Approval Rules',
    filler('approvals', 12),
    '',
    'Part II — Operations',
    'This part covers running production systems safely.',
    '',
    'Chapter 3: Incident Response',
    'Incidents are handled by the on-call engineer. Severity drives the response.',
    '3.1 Severity Levels',
    filler('severity levels', 12),
    'As described in 1.1 Purpose, incidents matter.',
    '3.2 On-call Escalation',
    filler('escalation', 12),
    '3.3 Postmortems',
    filler('postmortems', 12),
    '',
    'Chapter 4: Deployment Practices',
    'Deployments are automated and reversible. Every release is observable.',
    filler('deployments', 25),
    '',
    filler('deployment rollbacks', 25),
  ].join('\n');
}

// ---- chapter detection -------------------------------------------------------------------

test('synthetic playbook is long enough to exercise the TOC skip', () => {
  const text = samplePlaybook();
  assert.ok(text.length > 20000, `length ${text.length}`);
  assert.ok(text.indexOf('Chapter 4: Deployment Practices ....') < 5000, 'TOC sits inside the skip window');
  assert.ok(text.indexOf('\nChapter 1: Introduction\n') > 5000, 'body starts after the skip window');
});

test('extractTocFromText reads top-level entries and keeps the dominant keyword', () => {
  const toc = extractTocFromText(samplePlaybook());
  assert.deepEqual(toc, [
    { number: 'Chapter 1', title: 'Introduction' },
    { number: 'Chapter 2', title: 'Code Review Standards' },
    { number: 'Chapter 3', title: 'Incident Response' },
    { number: 'Chapter 4', title: 'Deployment Practices' },
  ]);
});

test('parseTocSummary parses stored summaries', () => {
  assert.deepEqual(parseTocSummary('Chapter 1. Intro\nPart II: Ops ..... 12\nAppendix'), [
    { number: 'Chapter 1', title: 'Intro' },
    { number: 'Part II', title: 'Ops' },
    { title: 'Appendix' },
  ]);
});

test('regex strategy prefers Chapter headings over Parts and skips TOC lines', () => {
  const text = samplePlaybook();
  const hits = detectRegexHeadings(text);
  assert.deepEqual(hits.map((h) => h.number), ['Chapter 1', 'Chapter 2', 'Chapter 3', 'Chapter 4']);
  assert.deepEqual(hits.map((h) => h.title), ['Introduction', 'Code Review Standards', 'Incident Response', 'Deployment Practices']);
  assert.ok(hits.every((h) => h.start > 5000));
});

test('regex strategy handles "Part II — Title" when parts are the only level', () => {
  const body = (t) => `${t}\n${filler(t, 8)}\n`;
  const text = [
    'Contents', 'Part I — Foundations ..... 2', 'Part II — Operations ..... 9', '',
    filler('intro', 40),
    body('Part I — Foundations'),
    body('Part II — Operations'),
    body('Part Three: Governance'),
  ].join('\n');
  const hits = detectRegexHeadings(text);
  assert.deepEqual(hits.map((h) => h.number), ['Part I', 'Part II', 'Part Three']);
  assert.deepEqual(hits.map((h) => h.title), ['Foundations', 'Operations', 'Governance']);
});

test('regex strategy ignores prose that merely starts with a keyword', () => {
  const text = `${filler('x', 40)}\nPart 2 of the process is to restart the service and verify the health checks pass.\n${filler('y', 5)}`;
  assert.equal(detectRegexHeadings(text).length, 0);
});

test('regex strategy picks up titles on the following line', () => {
  const text = `${filler('x', 40)}\nCHAPTER 1\nGetting Started\n${filler('a', 5)}\nCHAPTER 2\nAdvanced Topics\n${filler('b', 5)}`;
  const hits = detectRegexHeadings(text);
  assert.deepEqual(hits.map((h) => h.title), ['Getting Started', 'Advanced Topics']);
});

// Standards-style document: "Clause" headings in capitals, an indented overview list and bare
// cross-references that repeat the clause numbers before and inside the real bodies.
function clausePlaybook() {
  return [
    filler('the preamble', 40),
    'This document is organized as follows:',
    '  Clause 1 — Overview',
    '  Clause 2 — System Engineering',
    '  Clause 3 — Implementation, DevSecOps & Deployment',
    filler('orientation', 5),
    'CLAUSE 1 — OVERVIEW',
    filler('the overview', 10),
    'CLAUSE 2 — IEEE SYSTEM ENGINEERING (SYRS)',
    'Requirements follow IEEE 29148 and trace to the SyRS baseline.',
    'Clause 3',
    'and elaborated in the design subclauses.',
    filler('system engineering', 10),
    'CLAUSE 3 — IMPLEMENTATION, DEVSECOPS &',
    'DEPLOYMENT',
    'Our DevSecOps pipeline gates every release.',
    filler('delivery', 10),
  ].join('\n');
}

test('regex strategy reads Clause headings and prefers the real heading over lists and cross-references', () => {
  const text = clausePlaybook();
  const hits = detectRegexHeadings(text);
  assert.deepEqual(hits.map((h) => h.number), ['Clause 1', 'Clause 2', 'Clause 3']);
  for (const h of hits) assert.match(text.slice(h.start, h.start + 7), /^CLAUSE /);
  assert.deepEqual(hits.map((h) => h.title), [
    'Overview',
    'IEEE System Engineering (SyRS)',
    'Implementation, DevSecOps & Deployment', // wrapped title joined, spelling taken from the prose
  ]);
});

test('Clause headings take the TOC title for the same number when there is one', () => {
  const toc = [{ number: 'Clause 2', title: 'System Engineering' }, { number: 'Part 1', title: 'Wrong level' }];
  const hits = detectRegexHeadings(clausePlaybook(), toc);
  assert.deepEqual(hits.map((h) => h.title), ['Overview', 'System Engineering', 'Implementation, DevSecOps & Deployment']);
});

test('smartCase only rewrites all-caps titles', () => {
  assert.equal(chapters.smartCase('PRODUCT STRATEGY & MARKET ANALYSIS'), 'Product Strategy & Market Analysis');
  assert.equal(chapters.smartCase('LOW-LEVEL DESIGN AND THE API LAYER'), 'Low-Level Design and the API Layer');
  assert.equal(chapters.smartCase('Already Mixed Case'), 'Already Mixed Case');
});

test('detectChapters selects the strategy with the most chapters and keeps content verbatim', () => {
  const text = samplePlaybook();
  const toc = extractTocFromText(text);
  const { best, candidates } = detectChapters(text, toc);
  assert.deepEqual(candidates.map((c) => c.name), ['toc_guided', 'hybrid_number', 'regex_headings']);
  assert.equal(best.chapters.length, 4);
  assert.deepEqual(best.chapters.map((c) => c.title), ['Introduction', 'Code Review Standards', 'Incident Response', 'Deployment Practices']);
  const ch3 = best.chapters[2];
  assert.ok(ch3.content.startsWith('Chapter 3: Incident Response'));
  assert.ok(ch3.content.includes('3.2 On-call Escalation'));
  assert.ok(!ch3.content.includes('Chapter 4:'));
  assert.ok(!best.chapters[0].content.includes('........'), 'TOC is not part of chapter content');
  assert.equal(countSections(ch3.content), 3); // inline "1.1 Purpose" reference is not a heading
});

test('detectChapters without a TOC still finds chapters via regex headings', () => {
  const text = samplePlaybook().replace(/Table of Contents[\s\S]*?\n\nPreface/, 'Preface');
  const { best } = detectChapters(text, extractTocFromText(text));
  assert.equal(best.name, 'regex_headings');
  assert.equal(best.chapters.length, 4);
});

test('detectSections lists numbered sections of the chapter only', () => {
  const text = samplePlaybook();
  const { best } = detectChapters(text, extractTocFromText(text));
  const sections = detectSections(best.chapters[2].content, 'Chapter 3');
  assert.deepEqual(sections.map((s) => s.label), ['3.1 Severity Levels', '3.2 On-call Escalation', '3.3 Postmortems']);
  assert.deepEqual(detectSections(best.chapters[3].content, 'Chapter 4'), []);
});

test('title-correction heuristic', () => {
  assert.equal(needsTitleCorrection('Incident Response'), false);
  assert.equal(needsTitleCorrection('the process for incidents'), true);
  assert.equal(needsTitleCorrection('We deploy often. Rollbacks are cheap'), true);
  assert.equal(needsTitleCorrection('x'.repeat(130)), true);
  assert.equal(needsTitleCorrection(''), true);
  assert.equal(heuristicTitle('deployments are automated. Every release is observable.'), 'Deployments are automated');
  assert.equal(heuristicTitle('', 'Chapter 3'), 'Chapter 3');
});

test('summarizeChapter returns the first two sentences after the heading', () => {
  const content = 'Chapter 3: Incident Response\nIncidents are handled by the on-call engineer. Severity drives the response. Postmortems follow.\n3.1 Severity';
  assert.equal(summarizeChapter(content), 'Incidents are handled by the on-call engineer. Severity drives the response.');
});

test('sortChapters orders by chapter number (arabic, roman, keyword)', () => {
  const sorted = sortChapters([{ number: 'Part III' }, { number: 'Chapter 1' }, { number: '' }, { number: '2' }]);
  assert.deepEqual(sorted.map((c) => c.number), ['Chapter 1', '2', 'Part III', '']);
});

// ---- DOCX / file type --------------------------------------------------------------------

async function makeDocx(paragraphs, { title = 'Ops Playbook', creator = 'Platform Team', company = 'Inspironics' } = {}) {
  const zip = new JSZip();
  const body = paragraphs.map((p) => `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`).join('');
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  zip.file('docProps/core.xml', `<?xml version="1.0"?><cp:coreProperties xmlns:cp="x" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${title}</dc:title><dc:creator>${creator}</dc:creator></cp:coreProperties>`);
  zip.file('docProps/app.xml', `<?xml version="1.0"?><Properties><Company>${company}</Company></Properties>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('extractDocx turns paragraphs into lines, decodes entities and reads core properties', async () => {
  const buf = await makeDocx([
    'Chapter 1: Introduction',
    'R&amp;D teams use &lt;tags&gt; &quot;carefully&quot;.',
    'Tab<w:tab/>separated<w:br/>line break',
  ]);
  const { text, info } = await extractDocx(buf);
  assert.equal(text, 'Chapter 1: Introduction\nR&D teams use <tags> "carefully".\nTab\tseparated\nline break');
  assert.deepEqual(info, { title: 'Ops Playbook', author: 'Platform Team', organization: 'Inspironics', subject: '' });
});

test('extractText detects DOCX by extension and by magic bytes', async () => {
  const buf = await makeDocx(['Hello world']);
  assert.equal((await extractText({ file_name: 'playbook.docx' }, buf)).kind, 'docx');
  assert.equal(detectFileType({ file_name: 'blob' }, buf), 'docx');
  assert.equal(detectFileType({ file_type: 'pdf' }, Buffer.from('x')), 'pdf');
  assert.equal(detectFileType({}, Buffer.from('%PDF-1.4')), 'pdf');
  assert.throws(() => detectFileType({ file_name: 'a.xyz' }, Buffer.from('nope')), /Unsupported file type/);
});

test('extractText rejects invalid DOCX and files over MAX_EXTRACT_MB', async () => {
  await assert.rejects(extractText({ file_name: 'bad.docx' }, Buffer.from('PK not really a zip')), /Invalid DOCX/);
  await assert.rejects(extractText({ file_name: 'big.docx' }, Buffer.alloc(1024 * 1024 + 1)), /extraction limit of 1 MB/);
});

// ---- deterministic course ----------------------------------------------------------------

test('buildDeterministicCourse: one module per chapter, one lesson per numbered section', () => {
  const text = samplePlaybook();
  const { best } = detectChapters(text, extractTocFromText(text));
  const chs = best.chapters.map((c) => ({ ...c, summary: summarizeChapter(c.content) }));
  const course = buildDeterministicCourse({ title: 'Inspironics Engineering Handbook', version: '2.1' }, chs);

  assert.equal(course.course_title, 'Inspironics Engineering Handbook');
  assert.equal(course.difficulty, 'beginner');
  assert.match(course.course_description, /4 chapters/);
  assert.equal(course.modules.length, 4);
  assert.deepEqual(course.modules.map((m) => m.title), ['Introduction', 'Code Review Standards', 'Incident Response', 'Deployment Practices']);
  assert.deepEqual(course.modules[2].source_chapters, ['Incident Response']);

  const ops = course.modules[2].lessons;
  assert.deepEqual(ops.map((l) => l.source_section), ['3.1 Severity Levels', '3.2 On-call Escalation', '3.3 Postmortems']);
  assert.deepEqual(ops.map((l) => l.title), ['Severity Levels', 'On-call Escalation', 'Postmortems']);
  assert.ok(ops.every((l) => l.source_chapter === 'Incident Response' && l.teaching_objective.startsWith('Explain')));

  // Chapter 4 has no numbered sections and ~8k chars → split into 2–3 lessons.
  const deploy = course.modules[3].lessons;
  assert.ok(deploy.length >= 2 && deploy.length <= 3, `got ${deploy.length}`);
  assert.ok(deploy.every((l) => l.source_chapter === 'Deployment Practices' && l.source_section));
  for (const m of course.modules) {
    for (const l of m.lessons) assert.ok(['concept', 'deep_dive', 'example', 'architecture', 'demonstration', 'revision'].includes(l.video_type));
  }
});

test('buildDeterministicCourse: short chapter without sections → single lesson', () => {
  const course = buildDeterministicCourse({ title: 'Tiny' }, [{ number: '1', title: 'Overview', content: 'Overview\nThis is short. It has no sections.' }]);
  assert.equal(course.modules.length, 1);
  assert.deepEqual(course.modules[0].lessons, [{
    title: 'Overview',
    teaching_objective: 'Explain the key concepts, practices and rules of "Overview".',
    video_type: 'concept',
    source_chapter: 'Overview',
    source_section: 'Overview',
  }]);
  assert.equal(course.modules[0].description, 'This is short.');
});

test('guessVideoType heuristics', () => {
  assert.equal(guessVideoType('Deployment Checklist'), 'demonstration');
  assert.equal(guessVideoType('System Architecture'), 'architecture');
  assert.equal(guessVideoType('Case Study: Outage'), 'example');
  assert.equal(guessVideoType('Chapter Recap'), 'revision');
  assert.equal(guessVideoType('Severity Levels'), 'concept');
});
