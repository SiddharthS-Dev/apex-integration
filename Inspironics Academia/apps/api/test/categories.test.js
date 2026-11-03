import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

// Role-based playbook categories: the one-off migration of existing playbooks to the Corporate
// Knowledge Base, audience-based access enforced by the API, classification, and category rules.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'academy-categories-'));
Object.assign(process.env, { DATA_DIR: dir, SQLITE_PATH: path.join(dir, 'test.db'), DATABASE_URL: '', AI_ENABLED: 'false', LOG_LEVEL: 'error' });
const silence = console.log;
console.log = () => {};

const { getDb, closeDb } = await import('../src/db/index.js');
const { migrate } = await import('../src/db/migrations.js');
const { runDataMigrations } = await import('../src/db/dataMigrations.js');
const { createApp } = await import('../src/app.js');
const { entities } = await import('../src/repo/entities.js');

let server;
let base;

function client() {
  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${base}/api${url}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  };
  const ok = async (...args) => {
    const r = await call(...args);
    assert.ok(r.status < 300, `${args[0]} ${args[1]} → ${r.status} ${JSON.stringify(r.data)}`);
    return r.data;
  };
  return { call, ok, list: (entity, q = {}) => ok('GET', `/entities/${entity}?q=${encodeURIComponent(JSON.stringify(q))}`) };
}

const admin = client();
const users = {};

before(async () => {
  const db = await getDb();
  await migrate(db);
  server = createApp().listen(0);
  await new Promise((r) => { server.once('listening', r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await admin.ok('POST', '/auth/register', { email: 'admin@example.com', password: 'Admin-pass-123', full_name: 'Ada Admin' });
  for (const audience of ['intern', 'employee', 'leadership']) {
    const c = client();
    const { user } = await c.ok('POST', '/auth/register', { email: `${audience}@example.com`, password: 'Learner-pass-123', full_name: audience });
    await admin.ok('PATCH', `/entities/User/${user.id}`, { audience });
    users[audience] = c;
  }
});

after(async () => {
  server?.close();
  await closeDb();
  console.log = silence;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('the standard categories are created on start', async () => {
  const cats = await users.intern.list('PlaybookCategory');
  assert.deepEqual(cats.map((c) => c.key).sort(), ['corporate', 'learning', 'strategic']);
  assert.ok(cats.every((c) => c.built_in));
});

test('migration: existing playbooks and their courses go to the Corporate Knowledge Base, nothing else changes', async () => {
  const db = await getDb();
  // Records as they were before categories existed.
  const pb = await entities.Playbook.create({ title: 'Legacy Dropbox Playbook', file_url: 'dropbox:id:1', source: 'dropbox', external_id: 'id:1', dropbox_path: '/Playbooks/legacy.docx', chapter_count: 2 });
  await entities.Chapter.create({ playbook_id: pb.id, title: 'Ch 1', content: 'x' });
  await entities.PlaybookVersion.create({ playbook_id: pb.id, version_label: 'v1' });
  const course = await entities.Course.create({ playbook_id: pb.id, title: 'Legacy course', status: 'published' });
  await db.run("DELETE FROM schema_migrations WHERE id = 'data_001_playbook_categories'");
  await runDataMigrations(db);

  const after = await entities.Playbook.get(pb.id);
  assert.deepEqual([after.category, after.category_source], ['corporate', 'migration']);
  assert.deepEqual([after.title, after.dropbox_path, after.external_id, after.chapter_count], ['Legacy Dropbox Playbook', '/Playbooks/legacy.docx', 'id:1', 2], 'metadata and Dropbox references untouched');
  assert.equal((await entities.Course.get(course.id)).category, 'corporate');
  assert.equal(await entities.Chapter.count({ playbook_id: pb.id }), 1);
  assert.equal(await entities.PlaybookVersion.count({ playbook_id: pb.id }), 1);

  // Running again changes nothing (and never overrides a later manual choice).
  await entities.Playbook.update(pb.id, { category: 'strategic', category_source: 'manual' });
  await runDataMigrations(db);
  assert.equal((await entities.Playbook.get(pb.id)).category, 'strategic');
  await entities.Course.delete(course.id);
  await entities.Playbook.delete(pb.id);
});

test('each audience sees only its categories — playbooks, courses and everything inside a course', async () => {
  const world = {};
  for (const category of ['learning', 'corporate', 'strategic']) {
    const pb = await admin.ok('POST', '/entities/Playbook', { title: `${category} playbook`, file_url: 'upload:x', category });
    const course = await admin.ok('POST', '/entities/Course', { playbook_id: pb.id, title: `${category} course`, status: 'published', category });
    const mod = await admin.ok('POST', '/entities/Module', { course_id: course.id, title: 'M' });
    const lesson = await admin.ok('POST', '/entities/Lesson', { module_id: mod.id, title: 'L', status: 'approved' });
    await admin.ok('POST', '/entities/Question', { lesson_id: lesson.id, question_text: 'Q?', options: ['a', 'b'], correct_answer: 'a', status: 'approved' });
    await admin.ok('POST', '/entities/Flashcard', { lesson_id: lesson.id, front: 'f', back: 'b', status: 'approved' });
    world[category] = { pb, course, lesson };
  }
  await admin.ok('POST', '/entities/Playbook', { title: 'needs review', file_url: 'upload:y' });

  const sees = async (who, entity) => (await users[who].list(entity)).length;
  for (const [who, n] of [['intern', 1], ['employee', 2], ['leadership', 3]]) {
    for (const entity of ['Playbook', 'Course', 'Module', 'Lesson', 'Question', 'Flashcard']) {
      assert.equal(await sees(who, entity), n, `${who} → ${entity}`);
    }
  }
  assert.equal((await admin.list('Playbook')).length, 4, 'admins see everything, Unclassified included');

  // Hidden records are hidden by id too.
  assert.equal((await users.intern.call('GET', `/entities/Course/${world.strategic.course.id}`)).status, 404);
  assert.equal((await users.intern.call('GET', `/entities/Lesson/${world.corporate.lesson.id}`)).status, 404);
  assert.equal((await users.leadership.call('GET', `/entities/Lesson/${world.corporate.lesson.id}`)).status, 200);
  // And a learner can't sit the final test of a course they can't see.
  assert.equal((await users.intern.call('POST', '/functions/submitFinalTest', { course_id: world.strategic.course.id, answers: [] })).status, 404);
});

test('uploads without a category wait in Unclassified; an admin choice is manual and moves the courses too', async () => {
  const pb = await admin.ok('POST', '/entities/Playbook', { title: 'Uploaded', file_url: 'upload:z' });
  assert.deepEqual([pb.category, pb.category_source], ['unclassified', 'upload']);
  const chosen = await admin.ok('POST', '/entities/Playbook', { title: 'Chosen', file_url: 'upload:w', category: 'learning', department: 'Engineering', skill_level: 'beginner', tech_tags: ['Python', 'Python', ' Git '] });
  assert.deepEqual([chosen.category, chosen.category_source, chosen.tech_tags], ['learning', 'manual', ['Python', 'Git']]);
  assert.equal((await admin.call('POST', '/entities/Playbook', { title: 'Bad', file_url: 'u', category: 'nope' })).status, 400);

  const course = await admin.ok('POST', '/entities/Course', { playbook_id: pb.id, title: 'Uploaded course', status: 'published', category: 'unclassified' });
  const moved = await admin.ok('PATCH', `/entities/Playbook/${pb.id}`, { category: 'strategic' });
  assert.deepEqual([moved.category, moved.category_source], ['strategic', 'manual']);
  let courseNow;
  for (let i = 0; i < 40 && courseNow?.category !== 'strategic'; i++) {
    courseNow = await entities.Course.get(course.id);
    if (courseNow.category !== 'strategic') await new Promise((r) => { setTimeout(r, 25); });
  }
  assert.equal(courseNow.category, 'strategic', 'the course follows its playbook');

  const r = await admin.ok('POST', '/functions/classifyPlaybooks', { playbook_ids: [pb.id, chosen.id], category: 'corporate', department: 'Platform' });
  assert.equal(r.updated, 2);
  assert.equal((await entities.Course.get(course.id)).category, 'corporate');
  assert.equal((await users.employee.call('POST', '/functions/classifyPlaybooks', { playbook_ids: [pb.id], category: 'learning' })).status, 403);
});

test('categories: standard ones cannot be deleted; a custom one sends its playbooks to Unclassified', async () => {
  const [corporate] = await admin.list('PlaybookCategory', { key: 'corporate' });
  assert.equal((await admin.call('DELETE', `/entities/PlaybookCategory/${corporate.id}`)).status, 403);
  const renamed = await admin.ok('PATCH', `/entities/PlaybookCategory/${corporate.id}`, { label: 'Company Knowledge', key: 'hacked', audiences: ['employee', 'leadership', 'bogus'] });
  assert.deepEqual([renamed.label, renamed.key, renamed.audiences], ['Company Knowledge', 'corporate', ['employee', 'leadership']]);

  const custom = await admin.ok('POST', '/entities/PlaybookCategory', { label: 'Sales Enablement', audiences: ['employee'] });
  assert.deepEqual([custom.key, custom.built_in], ['sales-enablement', false]);
  assert.equal((await admin.call('POST', '/entities/PlaybookCategory', { label: 'Sales enablement' })).status, 400, 'keys are unique');
  const pb = await admin.ok('POST', '/entities/Playbook', { title: 'Pitch deck guide', file_url: 'upload:s', category: 'sales-enablement' });
  assert.equal((await users.employee.list('Playbook', { id: pb.id })).length, 1, 'a custom category is visible to its audiences');
  assert.equal((await users.intern.list('Playbook', { id: pb.id })).length, 0);
  const del = await admin.ok('DELETE', `/entities/PlaybookCategory/${custom.id}`);
  assert.equal(del.moved_to_unclassified, 1);
  assert.equal((await entities.Playbook.get(pb.id)).category, 'unclassified');
});

test('user audiences: set by admins, validated, returned on /me', async () => {
  const me = await users.intern.ok('GET', '/auth/me');
  assert.equal(me.audience, 'intern');
  assert.equal((await admin.call('PATCH', `/entities/User/${me.id}`, { audience: 'ceo' })).status, 400);
  assert.equal((await users.intern.call('PATCH', `/entities/User/${me.id}`, { audience: 'leadership' })).status, 403);
  const invited = await admin.ok('POST', '/auth/invite', { email: 'newlead@example.com', audience: 'leadership' });
  assert.equal(invited.user.audience, 'leadership');
});
