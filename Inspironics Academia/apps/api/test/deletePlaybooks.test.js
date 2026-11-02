import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Deleting playbooks: generated content goes with them, learner records stay, and a Dropbox
// playbook can be kept out of future syncs.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-delete-'));
Object.assign(process.env, { DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', AI_ENABLED: 'false', LOG_LEVEL: 'error' });
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { entities } = await import('../src/repo/entities.js');
const { default: deletePlaybooks, ignoredDropboxIds } = await import('../src/pipeline/deletePlaybooks.js');

before(async () => { await migrate(await getDb()); });
after(async () => {
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

async function playbookWithCourse(title, extra = {}) {
  const pb = await entities.Playbook.create({ title, file_url: 'dropbox:x', ...extra });
  await entities.Chapter.create({ playbook_id: pb.id, title: 'Ch 1', content: 'text' });
  await entities.PlaybookVersion.create({ playbook_id: pb.id, version_label: 'v1' });
  const course = await entities.Course.create({ playbook_id: pb.id, title: `${title} course` });
  const mod = await entities.Module.create({ course_id: course.id, title: 'M' });
  const lesson = await entities.Lesson.create({ module_id: mod.id, title: 'L' });
  await entities.Question.create({ lesson_id: lesson.id, question_text: 'Q?', options: ['a', 'b'], correct_answer: 'a' });
  await entities.Flashcard.create({ lesson_id: lesson.id, front: 'f', back: 'b' });
  const assessment = await entities.Assessment.create({ course_id: course.id, title: 'Final' });
  await entities.Question.create({ assessment_id: assessment.id, question_text: 'Q2?', options: ['a', 'b'], correct_answer: 'a' });
  await entities.Certificate.create({ user_id: 'u1', course_id: course.id, course_title: course.title });
  return pb;
}

const count = async (name) => (await entities[name].list(null, 10000)).length;

test('deleting a playbook removes its generated content and keeps learner records', async () => {
  const keep = await playbookWithCourse('Keep me');
  const gone = await playbookWithCourse('Delete me', { source: 'dropbox', external_id: 'id:abc' });
  const r = await deletePlaybooks({ playbook_ids: [gone.id] });
  assert.deepEqual([r.deleted, r.kept_out_of_sync], [1, 1]);
  for (const [name, n] of Object.entries({ Playbook: 1, Chapter: 1, PlaybookVersion: 1, Course: 1, Module: 1, Lesson: 1, Question: 2, Flashcard: 1, Assessment: 1 })) {
    assert.equal(await count(name), n, name);
  }
  assert.equal(await count('Certificate'), 2, 'certificates are learners\' records');
  assert.ok((await ignoredDropboxIds()).has('id:abc'), 'kept out of future syncs');
  assert.equal((await entities.Playbook.get(keep.id)).title, 'Keep me');
});

test('delete all, without keeping files out of syncs', async () => {
  await playbookWithCourse('Another', { source: 'dropbox', external_id: 'id:def' });
  const r = await deletePlaybooks({ all: true, keep_out_of_sync: false });
  assert.equal(r.deleted, 2);
  assert.equal(r.kept_out_of_sync, 0);
  assert.equal(await count('Playbook'), 0);
  assert.equal(await count('Chapter'), 0);
  assert.ok(!(await ignoredDropboxIds()).has('id:def'));
  await assert.rejects(() => deletePlaybooks({}), /playbook_ids/);
});
