import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import JSZip from 'jszip';

// The playbook → course pipeline end to end, with the AI answered by a local stand-in for the Gemini API:
// extract chapters from a DOCX course book, design the course, write lesson content and build
// assessments. The fake AI misbehaves the way real models do (skips a chapter, numbers its modules,
// returns malformed quiz questions) so the safeguards are exercised too. No real network.

// ---- fake the AI provider -------------------------------------------------------------------------

const calls = [];
const behaviour = { designEmpty: false, lessonEmptyScript: false, examFails: false };

function designAnswer(prompt) {
  const titles = [...prompt.matchAll(/=== CHAPTER \d+ ===\r?\nNumber: [^\n]*\r?\nTitle: ([^\n]+)/g)].map((m) => m[1].trim());
  if (behaviour.designEmpty) return { course_title: 'x', course_description: '', difficulty: 'beginner', modules: [] };
  return {
    course_title: 'AI Engineering Course',
    course_description: 'From basics to production.',
    difficulty: 'intermediate',
    // "Skipped Topic" is left out on purpose: the coverage guarantee must add it back.
    modules: titles.filter((t) => t !== 'Skipped Topic').map((t, i) => ({
      title: `Module ${i + 1}: ${t}`,
      description: `About ${t}.`,
      source_chapters: [t],
      lessons: [
        { title: `${t} essentials`, teaching_objective: `Explain ${t}.`, video_type: 'concept', source_chapter: t, source_section: 'first' },
        { title: `${t} in practice`, teaching_objective: `Apply ${t}.`, video_type: 'not-a-type', source_chapter: t.toUpperCase(), source_section: 'second' },
      ],
    })),
  };
}

function lessonAnswer() {
  if (behaviour.lessonEmptyScript) return { video_title: 'x', teaching_script: '  ', mcqs: [], flashcards: [] };
  const mcq = (n, extra = {}) => ({
    question_text: `Question ${n}?`, options: ['Alpha', 'Beta', 'Gamma', 'Delta'], correct_answer: 'Beta',
    explanation: 'Because.', difficulty: 'intermediate', cognitive_level: 'application', source_section: 'first', ...extra,
  });
  return {
    video_title: 'Learning the essentials',
    teaching_script: `Welcome. Today we learn the essentials, step by step. ${'We walk through each rule of the chapter and apply it to a real engineering scenario. '.repeat(25)}`,
    summary: 'A short summary.',
    examples: ['Example one.', 'Example two.'],
    key_points: ['- Point one', 'Point two'],
    mcqs: [mcq(1), mcq(2), mcq(3), mcq(4), mcq(5, { difficulty: 'weird', cognitive_level: 'weird' }), mcq(6, { correct_answer: 'Not an option' }), mcq(7)],
    flashcards: [
      ...[1, 2, 3, 4, 5].map((n) => ({ front: `Term ${n}`, back: `Meaning ${n}.`, difficulty: 'basic', source_section: 'first' })),
      { front: '', back: 'no front' },
      { front: 'Term 6', back: 'one too many' },
    ],
  };
}

function examAnswer(prompt) {
  if (behaviour.examFails) return null;
  const total = Number(prompt.match(/write EXACTLY (\d+) questions/)?.[1] || 0);
  const lessons = [...prompt.matchAll(/- LESSON (\d+) \(/g)].map((m) => Number(m[1]));
  const questions = [];
  for (let i = 0; i < total; i++) {
    questions.push({
      lesson_index: lessons[i % lessons.length], question_text: `Exam question ${lessons[0]}-${i}?`,
      options: ['One', 'Two', 'Three', 'Four'], correct_answer: 'Three', explanation: 'Grounded.',
      difficulty: 'advanced', cognitive_level: 'analysis', source_section: '',
    });
  }
  // A duplicate and a malformed question are dropped.
  if (questions.length) questions.push({ ...questions[0] }, { question_text: 'Broken?', options: ['Only one'], correct_answer: 'x' });
  return { questions };
}

function answer(prompt) {
  if (prompt.includes('meticulous technical librarian')) return { title: 'AI Engineering Course Book', author: 'Training Team', version: '2.0', organization: 'Inspironics', toc: [] };
  if (prompt.includes('preparing an engineering playbook for a learning platform')) {
    const n = (prompt.match(/### CHAPTER index=/g) || []).length;
    return { title: 'AI Engineering Course Book', author: '', version: '2.0', organization: 'Inspironics', chapters: Array.from({ length: n }, (_, index) => ({ index, summary: `Summary of chapter ${index + 1}.`, corrected_title: '' })) };
  }
  if (prompt.includes('senior instructional designer')) return designAnswer(prompt);
  if (prompt.includes('recording a video lesson')) return lessonAnswer();
  if (prompt.includes('certification exam author')) return examAnswer(prompt);
  return {};
}

const ai = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => { raw += c; });
  req.on('end', () => {
    const body = JSON.parse(raw || '{}');
    // Gemini generateContent: the system prompt and the user prompt arrive separately.
    const prompt = [body.systemInstruction?.parts?.[0]?.text, body.contents?.[0]?.parts?.at(-1)?.text].filter(Boolean).join('\n\n');
    calls.push(prompt);
    const out = answer(prompt);
    if (out === null) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: { message: 'model overloaded' } })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } }));
  });
});
await new Promise((r) => ai.listen(0, '127.0.0.1', r));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-content-'));
Object.assign(process.env, {
  DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', LOG_LEVEL: 'error',
  AI_ENABLED: 'true', AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key', GEMINI_MODEL: 'gemini-test',
  GEMINI_BASE_URL: `http://127.0.0.1:${ai.address().port}/v1beta`, MEDIA_PROVIDER: 'none', ENABLE_CONTENT_CACHE: 'false',
});

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { objectKey, putObject } = await import('../src/files/objectStore.js');
const { entities } = await import('../src/repo/entities.js');
const processPlaybookExtract = (await import('../src/pipeline/processPlaybookExtract.js')).default;
const processPlaybookStructure = (await import('../src/pipeline/processPlaybookStructure.js')).default;
const generateLessonContent = (await import('../src/pipeline/generateLessonContent.js')).default;
const generateAssessment = (await import('../src/pipeline/generateAssessment.js')).default;

before(async () => { await migrate(await getDb()); });
after(async () => {
  ai.close();
  await closeDb();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---- a course book like the real one: Part pages listing their chapters, letter-spaced openers --

const CHAPTERS = ['AI Basics', 'Python for AI', 'Machine Learning', 'Neural Networks', 'Skipped Topic', 'Computer Vision', 'Language Models', 'Retrieval', 'Agents', 'MLOps'];

// Section headings that end in a number look like contents lines (page numbers), so none do here.
const SECTION = { 1: 'foundations', 2: 'in the field' };

function bookLines({ changed = '' } = {}) {
  const lines = ['AI Engineering — A Training Course Book', 'Version 2.0', 'Contents'];
  CHAPTERS.forEach((t, i) => lines.push(`${i + 1}  ${t}.................................${10 + i * 20}`));
  lines.push(...Array.from({ length: 60 }, (_, i) => `Front matter line ${i} explaining how to use this book in class sessions.`));
  CHAPTERS.forEach((t, i) => {
    const n = i + 1;
    if (i % 5 === 0) {
      lines.push(`P A R T   ${i ? 'I I' : 'I'}`, 'Chapters in this part', ...CHAPTERS.slice(i, i + 5).map((c, j) => `Chapter ${i + j + 1}   ${c}`));
    }
    lines.push(`C H A P T E R   ${String(n).split('').join(' ')}`, t);
    for (const s of [1, 2]) {
      lines.push(`${n}.${s} ${t} ${SECTION[s]}`);
      const body = changed === t ? `Rewritten guidance for ${t}. ` : `Guidance about ${t} part ${s}. `;
      lines.push(...Array.from({ length: 12 }, () => body.repeat(4)));
    }
  });
  return lines;
}

async function docx(lines) {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${lines.map((l) => `<w:p><w:r><w:t>${esc(l)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function uploadPlaybook(lines, extra = {}) {
  const key = objectKey('upload', Math.random());
  await putObject(key, await docx(lines));
  return entities.Playbook.create({ title: 'book', file_url: `upload:${key}`, file_name: 'ai_book.docx', file_type: 'docx', category: 'learning', ...extra });
}

const designCalls = () => calls.filter((p) => p.includes('senior instructional designer')).length;
let playbook;
let course;

test('extract: a course book becomes its chapters — part-page lists and letter-spaced openers handled', async () => {
  playbook = await uploadPlaybook(bookLines());
  const out = await processPlaybookExtract({ playbook_id: playbook.id });
  assert.equal(out.chapter_count, CHAPTERS.length);
  assert.equal(out.changes, undefined, 'first version: nothing to compare');

  const chapters = (await entities.Chapter.filter({ playbook_id: playbook.id })).sort((a, b) => parseInt(a.number.replace(/\D/g, ''), 10) - parseInt(b.number.replace(/\D/g, ''), 10));
  assert.deepEqual(chapters.map((c) => c.title), CHAPTERS);
  for (const [i, c] of chapters.entries()) {
    assert.ok(c.content.includes(`${i + 1}.1 ${c.title} foundations`) && c.content.includes(`${i + 1}.2 ${c.title} in the field`), `${c.title} keeps both sections`);
    const next = CHAPTERS[i + 1];
    if (next) assert.ok(!c.content.includes(`${i + 2}.1 ${next} foundations`), `${c.title} stops where ${next} begins`);
    assert.ok(c.content.length > 1500, `${c.title} is more than a heading line`);
    assert.equal(c.summary, `Summary of chapter ${i + 1}.`, 'summary from the AI');
    assert.equal(c.section_count, 2);
  }

  const pb = await entities.Playbook.get(playbook.id);
  assert.equal(pb.status, 'processed');
  assert.equal(pb.title, 'AI Engineering Course Book');
  assert.equal(pb.version, '2.0');
  assert.equal(pb.organization, 'Inspironics');
  assert.equal(pb.chapter_count, CHAPTERS.length);
  assert.match(pb.toc_summary, /AI Basics\n.*Python for AI/);
  const [version] = await entities.PlaybookVersion.filter({ playbook_id: playbook.id });
  assert.match(version.version_label, /^v1/);
  assert.equal(JSON.parse(version.chapters_snapshot).length, CHAPTERS.length);
});

test('extract: a new revision reports what changed and keeps a version per revision', async () => {
  const key = (await entities.Playbook.get(playbook.id)).file_url.slice('upload:'.length);
  await putObject(key, await docx(bookLines({ changed: 'Machine Learning' })));
  const out = await processPlaybookExtract({ playbook_id: playbook.id });
  assert.deepEqual(out.changes.added, []);
  assert.deepEqual(out.changes.removed, []);
  assert.deepEqual(out.changes.modified.map((m) => m.title), ['Machine Learning']);
  assert.equal((await entities.PlaybookVersion.filter({ playbook_id: playbook.id })).length, 2);
});

test('extract: bad requests and unreadable files fail clearly', async () => {
  await assert.rejects(processPlaybookExtract({}), { status: 400 });
  await assert.rejects(processPlaybookExtract({ playbook_id: 'missing' }), { status: 404 });

  const empty = await uploadPlaybook(['Too short.']);
  await assert.rejects(processPlaybookExtract({ playbook_id: empty.id }), /No extractable text/);
  const failed = await entities.Playbook.get(empty.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.error, /No extractable text/);

  const lost = await entities.Playbook.create({ title: 'lost', file_url: 'upload:0000' });
  await assert.rejects(processPlaybookExtract({ playbook_id: lost.id }), /Invalid object key|missing/);
  assert.equal((await entities.Playbook.get(lost.id)).status, 'failed');
});

test('structure: a long book is designed in batches and every chapter gets lessons', async () => {
  const before = designCalls();
  const out = await processPlaybookStructure({ playbook_id: playbook.id });
  assert.equal(designCalls() - before, 2, '10 chapters → two design calls of up to 6 chapters');
  assert.equal(out.chapter_count, CHAPTERS.length);
  assert.equal(out.module_count, CHAPTERS.length);

  course = await entities.Course.get(out.course_id);
  assert.equal(course.status, 'pending_review');
  assert.equal(course.category, 'learning', 'course follows its playbook category');
  assert.equal(course.difficulty, 'intermediate');
  assert.equal(course.version, '1');

  const modules = (await entities.Module.filter({ course_id: course.id })).sort((a, b) => a.order - b.order);
  assert.deepEqual(modules.map((m) => m.title), CHAPTERS.map((t) => t), 'book order, batch numbering ("Module 1:") removed');
  const lessons = (await Promise.all(modules.map((m) => entities.Lesson.filter({ module_id: m.id })))).flat();
  const byChapter = new Map();
  for (const l of lessons) byChapter.set(l.source_chapter, [...(byChapter.get(l.source_chapter) || []), l]);
  for (const t of CHAPTERS) assert.ok(byChapter.get(t)?.length >= 2, `${t} has lessons`);
  assert.deepEqual(byChapter.get('Skipped Topic').map((l) => l.source_section).sort(), ['5.1 Skipped Topic foundations', '5.2 Skipped Topic in the field'], 'the chapter the AI skipped is covered from its own sections');
  assert.ok(lessons.every((l) => ['concept', 'deep_dive', 'example', 'architecture', 'demonstration', 'revision'].includes(l.video_type)));
  assert.equal((await entities.Playbook.get(playbook.id)).status, 'needs_review');
});

test('structure: an active course is kept unless regeneration is forced', async () => {
  const skipped = await processPlaybookStructure({ playbook_id: playbook.id });
  assert.equal(skipped.skipped, true);
  assert.equal(skipped.course_id, course.id);

  const again = await processPlaybookStructure({ playbook_id: playbook.id, force: 'true' });
  assert.notEqual(again.course_id, course.id);
  assert.equal((await entities.Course.get(course.id)).status, 'archived', 'the old draft is archived, not deleted');
  assert.equal((await entities.Course.get(again.course_id)).version, '2');
  course = await entities.Course.get(again.course_id);
});

test('structure: no usable design fails the playbook with a clear error', async () => {
  await assert.rejects(processPlaybookStructure({}), { status: 400 });
  await assert.rejects(processPlaybookStructure({ playbook_id: 'missing' }), { status: 404 });

  const bare = await entities.Playbook.create({ title: 'bare', file_url: 'upload:none' });
  await assert.rejects(processPlaybookStructure({ playbook_id: bare.id }), /No chapters found/);

  behaviour.designEmpty = true;
  try {
    await assert.rejects(processPlaybookStructure({ playbook_id: playbook.id, force: true }), /did not return any modules/);
    const pb = await entities.Playbook.get(playbook.id);
    assert.equal(pb.status, 'failed');
    assert.match(pb.error, /did not return any modules/);
    assert.equal((await entities.Course.get(course.id)).status, 'pending_review', 'a failed rebuild leaves the current course alone');
  } finally {
    behaviour.designEmpty = false;
  }
});

const firstLesson = async () => {
  const [m] = (await entities.Module.filter({ course_id: course.id })).sort((a, b) => a.order - b.order);
  return (await entities.Lesson.filter({ module_id: m.id })).sort((a, b) => a.order - b.order)[0];
};

test('lesson content: script, takeaways, valid quiz questions and flashcards are saved for review', async () => {
  const lesson = await firstLesson();
  const out = await generateLessonContent({ lesson_id: lesson.id });
  assert.equal(out.question_count, 6, 'the question whose answer is not an option is dropped; at most 6 kept');
  assert.equal(out.flashcard_count, 5, 'empty cards dropped; at most 5 kept');

  const saved = await entities.Lesson.get(lesson.id);
  assert.equal(saved.status, 'pending_review');
  assert.equal(saved.video_title, 'Learning the essentials');
  assert.match(saved.teaching_script, /Welcome/);
  assert.equal(saved.key_points, '- Point one\n- Point two');
  assert.equal(saved.examples, '- Example one.\n- Example two.');

  const prompt = calls.findLast((p) => p.includes('recording a video lesson'));
  assert.ok(prompt.includes('1.1 AI Basics foundations'), 'the AI is given the source chapter text');

  const questions = await entities.Question.filter({ lesson_id: lesson.id });
  assert.ok(questions.every((q) => q.options.includes(q.correct_answer)));
  assert.ok(questions.some((q) => q.difficulty === 'basic' && q.cognitive_level === 'recall'), 'unknown levels fall back to defaults');

  await generateLessonContent({ lesson_id: lesson.id });
  assert.equal((await entities.Question.filter({ lesson_id: lesson.id })).length, 6, 'regenerating replaces, never duplicates');
  assert.equal((await entities.Flashcard.filter({ lesson_id: lesson.id })).length, 5);
});

test('lesson content: an empty script fails and the lesson goes back to pending', async () => {
  await assert.rejects(generateLessonContent({}), { status: 400 });
  await assert.rejects(generateLessonContent({ lesson_id: 'missing' }), { status: 404 });
  const [, second] = await entities.Lesson.filter({ module_id: (await firstLesson()).module_id });
  behaviour.lessonEmptyScript = true;
  try {
    // Incomplete answer (empty script, missing fields): rejected by the structure check or the
    // script check, retried once, then failed with the reason.
    await assert.rejects(generateLessonContent({ lesson_id: second.id }), /no teaching script|unexpected format/);
    assert.equal((await entities.Lesson.get(second.id)).status, 'pending');
  } finally {
    behaviour.lessonEmptyScript = false;
  }
});

test('assessments: module test, final assessment and certification exam', async () => {
  const modules = (await entities.Module.filter({ course_id: course.id })).sort((a, b) => a.order - b.order);
  const moduleTest = await generateAssessment({ course_id: course.id, type: 'module_test', module_id: modules[0].id });
  assert.equal(moduleTest.question_count, 15);
  const a = await entities.Assessment.get(moduleTest.assessment_id);
  assert.equal(a.title, 'AI Basics — Module Test');
  assert.equal(a.passing_score, 70);
  assert.equal(a.duration_minutes, 30);
  const qs = await entities.Question.filter({ assessment_id: a.id });
  assert.equal(new Set(qs.map((q) => q.question_text)).size, qs.length, 'no duplicate questions');
  assert.ok(qs.every((q) => q.correct_answer === 'Three' && q.options.length === 4));

  const final = await generateAssessment({ course_id: course.id });
  assert.equal(final.type, 'course_assessment');
  assert.equal(final.question_count, 50, 'questions are batched and capped at the exam size');
  const exam = await generateAssessment({ course_id: course.id, type: 'certification' });
  assert.equal(exam.question_count, 60);
  assert.equal((await entities.Assessment.get(exam.assessment_id)).duration_minutes, 90);
});

test('assessments: invalid requests and total AI failure are reported', async () => {
  await assert.rejects(generateAssessment({}), { status: 400 });
  await assert.rejects(generateAssessment({ course_id: course.id, type: 'quiz' }), { status: 400 });
  await assert.rejects(generateAssessment({ course_id: course.id, type: 'module_test' }), { status: 400 });
  await assert.rejects(generateAssessment({ course_id: 'missing' }), { status: 404 });
  await assert.rejects(generateAssessment({ course_id: course.id, type: 'module_test', module_id: 'missing' }), { status: 404 });

  const empty = await entities.Course.create({ title: 'Empty', status: 'pending_review' });
  await assert.rejects(generateAssessment({ course_id: empty.id }), /No lessons found/);

  behaviour.examFails = true;
  try {
    await assert.rejects(generateAssessment({ course_id: course.id }), /Question generation failed/);
  } finally {
    behaviour.examFails = false;
  }
});
