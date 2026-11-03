import assert from 'node:assert/strict';
import { test } from 'node:test';

const { ensureChapterCoverage } = await import('../src/pipeline/processPlaybookStructure.js');

const chapter = (n, title) => ({ number: `Chapter ${n}`, title, summary: `About ${title}.`, content: `${title}\n${n}.1 First topic\nText.\n${n}.2 Second topic\nText.\n` });

test('every chapter gets lessons, in book order, and lesson sources point at real chapters', () => {
  const chapters = [chapter(1, 'AI Basics'), chapter(2, 'Deep Learning'), chapter(3, 'RAG'), chapter(4, 'MLOps')];
  const modules = [
    { title: 'Foundations', source_chapters: ['AI Basics'], lessons: [{ title: 'Intro', source_chapter: 'ai basics ' }] },
    { title: 'Retrieval', source_chapters: ['RAG'], lessons: [{ title: 'Chunking', source_chapter: 'Chapter 3: RAG' }] },
  ];
  const added = ensureChapterCoverage(modules, chapters);
  assert.deepEqual(added, ['Deep Learning', 'MLOps']);
  assert.deepEqual(modules.map((m) => m.title), ['Foundations', 'Deep Learning', 'Retrieval', 'MLOps']);
  assert.equal(modules[0].lessons[0].source_chapter, 'AI Basics');
  assert.equal(modules[2].lessons[0].source_chapter, 'RAG');
  assert.deepEqual(modules[1].lessons.map((l) => l.source_section), ['2.1 First topic', '2.2 Second topic']);
  const covered = new Set(modules.flatMap((m) => m.lessons.map((l) => l.source_chapter)));
  for (const c of chapters) assert.ok(covered.has(c.title), `${c.title} has lessons`);
});

test('a fully covered design is left as it is', () => {
  const chapters = [chapter(1, 'AI Basics'), chapter(2, 'RAG')];
  const modules = [{ title: 'All', source_chapters: ['AI Basics', 'RAG'], lessons: [{ title: 'a', source_chapter: 'AI Basics' }, { title: 'b', source_chapter: 'RAG' }] }];
  assert.deepEqual(ensureChapterCoverage(modules, chapters), []);
  assert.equal(modules.length, 1);
});
