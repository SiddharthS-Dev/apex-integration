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

// A Word document as Word writes it: a generated table of contents (TOC field + PAGEREF entries in
// TOC styles), a table whose last column holds "Part VII", then the real Part headings.
async function makeWordDocx() {
  const run = (t) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
  const fld = (instr) => `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> ${instr} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
  const end = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  const p = (style, inner) => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr>${inner}</w:p>`;
  const tocEntry = (title, bm, page, first = '') => p('TOC1', `${first}<w:hyperlink w:anchor="${bm}">${run(title)}<w:r><w:tab/></w:r>${fld(`PAGEREF ${bm} \\h`)}${run(page)}${end}</w:hyperlink>`);
  const cell = (t) => `<w:tc>${p('', run(t))}</w:tc>`;
  const filler = (topic) => p('', run(`${topic} is explained in detail for engineers who operate the platform every day.`)).repeat(12);
  const body = [
    p('Title', run('Engineering Playbook')),
    p('TOCHeading', run('Table of Contents')),
    tocEntry('Copyright and Ownership', '_Toc1', '2', fld('TOC \\o "1-3" \\h \\z \\u')),
    tocEntry('Document Control', '_Toc2', '3'),
    tocEntry('Part 1 — Foundations', '_Toc3', '5') + end,
    p('Heading1', run('Copyright and Ownership')),
    filler('Copyright'),
    p('', run('PART 1')),
    p('', run('Foundations')),
    filler('The foundation'),
    `<w:tbl><w:tr>${cell('Advisory-first autonomy')}${cell('Observe before control')}${cell('Part VII')}</w:tr></w:tbl>`,
    filler('Doctrine'),
    p('', run('PART 2')),
    p('', run('Operations')),
    filler('Operations'),
  ].join('');
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

test('extractDocx drops Word field codes and the generated table of contents; table rows stay on one line', async () => {
  const { text } = await extractDocx(await makeWordDocx());
  assert.doesNotMatch(text, /PAGEREF|_Toc|TOC \\o|\\h/);
  assert.doesNotMatch(text, /^Document Control$/m, 'TOC entries are gone');
  assert.match(text, /^Advisory-first autonomy \| Observe before control \| Part VII$/m);
  assert.match(text, /^Copyright and Ownership$/m, 'the real heading stays');
});

test('chapters from a Word document follow its real headings, not its table of contents', async () => {
  const { text } = await extractDocx(await makeWordDocx());
  const { best } = detectChapters(text, extractTocFromText(text));
  assert.deepEqual(best.chapters.map((c) => [c.number, c.title]), [['Part 1', 'Foundations'], ['Part 2', 'Operations']]);
  assert.match(best.chapters[0].content, /Part VII/, 'the table cell is content, not a chapter');
});

test('an unnumbered TOC entry is not pasted onto a numbered heading it does not match', () => {
  const body = (t) => `${t} content explained for the engineering team in enough detail.\n`.repeat(30);
  const text = `${'Intro text.\n'.repeat(400)}Chapter 1 — Vision\n${body('Vision')}Chapter 2 — Platform\n${body('Platform')}`;
  const hits = chapters.detectHybridNumber(text, [{ title: 'Copyright and Ownership' }, { title: 'Document Control' }]);
  assert.equal(hits.length, 0);
  const named = chapters.detectHybridNumber(text, [{ title: 'Vision' }, { title: 'Platform' }]);
  assert.deepEqual(named.map((h) => h.title), ['Vision', 'Platform']);
});

test('lessons follow sub-chapters and numbered topics, never numbered lists or table rows', async () => {
  const { lessonsForChapter } = await import('../src/pipeline/courseBuilder.js');
  const para = (t) => `${t} is explained for the engineers who build and operate the platform.\n`.repeat(6);
  const part1 = `PART 1\nFoundations\n${para('Intro')}Chapter 1 — Vision\n1.1 The problem\n${para('Vision')}Chapter 2 — Doctrine\n2.1 Rules\n${para('Doctrine')}Chapter 3 — Governance\n${para('Governance')}`;
  assert.deepEqual(lessonsForChapter({ number: 'Part 1', title: 'Foundations', content: part1 }).map((l) => l.title), ['Vision', 'Doctrine', 'Governance']);

  const part6 = `PART 6\nDigital Twins\nChapters 88–109 — Twin architecture through simulation\n${para('Twins')}88–90. Twin architecture and state model\n${para('Architecture')}`
    + `Fig. 7. Simulation steps\n1. Historical replay\n2. Rule-based what-if analysis\n3. Data-driven forecast\n101. Twin hierarchy\n${para('Hierarchy')}105–109. Simulation progression\n${para('Simulation')}`
    + `Rev | Field | Value\n7 | Upgrade and migration effort\n`;
  const lessons = lessonsForChapter({ number: 'Part 6', title: 'Digital Twins', content: part6 });
  assert.deepEqual(lessons.map((l) => l.title), ['Twin architecture and state model', 'Twin hierarchy', 'Simulation progression']);
  assert.equal(lessons[0].source_section, '88–90. Twin architecture and state model');
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

test('letter-spaced chapter openers are found and part-page chapter lists are not mistaken for them', () => {
  const filler = (topic) => `${`Notes about ${topic}. `.repeat(40)}\n`;
  const parts = [`Front matter\n${'x'.repeat(6000)}\n`];
  const chaptersIn = [[1, 'AI Basics'], [2, 'AI for Everyone'], [10, 'Neural Networks'], [11, 'Deep Learning']];
  for (const [i, group] of [[0, chaptersIn.slice(0, 2)], [1, chaptersIn.slice(2)]]) {
    parts.push(`P A R T   ${i ? 'I I' : 'I'}\nPart title\nChapters in this part\n${group.map(([n, t]) => `Chapter ${n}   ${t}`).join('\n')}\n`);
    for (const [n, t] of group) parts.push(`C H A P T E R   ${String(n).split('').join(' ')}\n${t}\n${filler(t)}`);
  }
  const text = parts.join('\n');
  assert.equal(chapters.normalizeSpacedHeadings('C H A P T E R   1 0\nP A R T   I I I\nA B C   1'), 'Chapter 10\nPart III\nA B C   1');
  const { best } = detectChapters(text, []);
  assert.deepEqual(best.chapters.map((c) => c.title), chaptersIn.map(([, t]) => t));
  for (const c of best.chapters) assert.ok(c.content.length > 500, `${c.title} keeps its body, not just the list line`);
  assert.ok(best.chapters[2].content.startsWith('Chapter 10\nNeural Networks'));
});

// ---- automatic lesson quality check ------------------------------------------------------------

test('quality check: a grounded, complete lesson passes; problems are named', async () => {
  const { assessLessonQuality, balanceAnswerPositions } = await import('../src/pipeline/lessonQuality.js');
  const source = 'Telemetry flows through the gateway. Firmware updates follow the provisioning contract. Evidence supports traceability and governance of every controller.';
  const vocab = ['telemetry', 'gateway', 'firmware', 'provisioning', 'contract', 'evidence', 'traceability', 'governance', 'controller'];
  const script = Array.from({ length: 120 }, (_, i) => `Item a${i} links ${vocab[i % 9]} b${i} with ${vocab[(i * 4 + 2) % 9]} c${i}.`).join(' ');
  const q = (n, pos) => {
    const options = ['Firmware is staged', 'Telemetry is dropped', 'Gateway restarts', 'Evidence is lost'];
    return { question_text: `Question ${n}?`, options, correct_answer: options[pos], explanation: 'The provisioning contract says so.' };
  };
  const good = {
    video_title: 'Gateway and firmware', teaching_script: script, summary: 'One. Two. Three.',
    key_points: '- Keep evidence\n- Stage firmware\n- Watch telemetry\n- Govern controllers\n- Trace changes',
    examples: '- A gateway update', questions: [0, 1, 2, 3, 0, 1].map((p, i) => q(i, p)),
    flashcards: [1, 2, 3, 4, 5].map((n) => ({ front: `Term ${n}`, back: 'A precise meaning.' })),
  };
  const ok = assessLessonQuality(good, source);
  assert.equal(ok.passed, true, JSON.stringify(ok.issues));
  assert.equal(ok.score, 100);

  const looping = assessLessonQuality({ ...good, teaching_script: 'the gateway sends telemetry to the cloud. '.repeat(80) }, source);
  assert.ok(looping.issues.some((i) => i.code === 'repetition' && i.severity === 'error'));
  const offTopic = assessLessonQuality({ ...good, key_points: '- Marketing budgets\n- Quarterly spreadsheets', teaching_script: Array.from({ length: 120 }, (_, i) => `Topic z${i} discusses marketing budgets and quarterly spreadsheet planning y${i}.`).join(' ') }, source);
  assert.ok(offTopic.issues.some((i) => i.code === 'grounding' && i.severity === 'error'));
  const invented = assessLessonQuality({ ...good, summary: 'Latency drops by 73% within 450 ms.' }, source);
  assert.match(invented.issues.find((i) => i.code === 'numbers').message, /73%, 450/);
  const samePos = assessLessonQuality({ ...good, questions: [0, 1, 2, 3, 4, 5].map((i) => q(i, 2)) }, source);
  assert.ok(samePos.issues.some((i) => i.code === 'quiz_pattern'));
  const wrong = assessLessonQuality({ ...good, questions: good.questions.map((x, i) => (i ? x : { ...x, correct_answer: 'Not an option' })) }, source);
  assert.ok(wrong.issues.some((i) => i.code === 'quiz_answer' && i.severity === 'error'));

  const balanced = balanceAnswerPositions([0, 1, 2, 3, 4, 5].map((i) => q(i, 2)));
  assert.deepEqual(balanced.map((x) => x.options.indexOf(x.correct_answer)), [0, 1, 2, 3, 0, 1], 'answers spread over the positions');
  assert.ok(balanced.every((x) => x.options.length === 4 && new Set(x.options).size === 4));
});
