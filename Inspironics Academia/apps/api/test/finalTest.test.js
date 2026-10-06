import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ENTITIES, FINAL_TEST_SAMPLE, gradeFinalTest, loadFinalTestPool, matchesQuery, newCertificateId, ruleFor, ruleToQuery,
} from '@academy/shared';

// An in-memory `filter` over a few tables, the shape loadFinalTestPool expects.
function memory(tables) {
  return (name, query, _sort, limit) => (tables[name] || []).filter((r) => matchesQuery(r, query)).slice(0, limit);
}

const q = (id, extra = {}) => ({ id, status: 'approved', options: ['a', 'b'], correct_answer: 'a', ...extra });

test('pool prefers a published certification assessment and uses all its approved questions', async () => {
  const filter = memory({
    Assessment: [
      { id: 'draft', course_id: 'c1', status: 'draft', type: 'certification' },
      { id: 'course', course_id: 'c1', status: 'published', type: 'course_assessment' },
      { id: 'cert', course_id: 'c1', status: 'published', type: 'certification', passing_score: 80 },
    ],
    Question: [
      q('q1', { assessment_id: 'cert' }), q('q2', { assessment_id: 'cert' }),
      q('q3', { assessment_id: 'cert', status: 'pending_review' }), q('q4', { assessment_id: 'course' }),
    ],
  });
  const pool = await loadFinalTestPool(filter, 'c1');
  assert.equal(pool.assessment.id, 'cert');
  assert.deepEqual(pool.questions.map((x) => x.id), ['q1', 'q2']);
  assert.equal(pool.count, 2);
});

test('pool falls back to approved questions of approved lessons, sampled', async () => {
  const lessonQs = Array.from({ length: 40 }, (_, i) => q(`l${i}`, { lesson_id: 'L1' }));
  const filter = memory({
    Assessment: [],
    Module: [{ id: 'm1', course_id: 'c1' }],
    Lesson: [{ id: 'L1', module_id: 'm1', status: 'approved' }, { id: 'L2', module_id: 'm1', status: 'pending' }],
    Question: [...lessonQs, q('pending-lesson', { lesson_id: 'L2' }), q('in-assessment', { lesson_id: 'L1', assessment_id: 'x' })],
  });
  const pool = await loadFinalTestPool(filter, 'c1');
  assert.equal(pool.assessment, null);
  assert.equal(pool.questions.length, 40);
  assert.equal(pool.count, FINAL_TEST_SAMPLE);
});

test('grading scores by marks against the stored answers and the assessment pass mark', () => {
  const pool = { assessment: { passing_score: 80 }, questions: [q('q1', { marks: 3 }), q('q2')], count: 2 };
  assert.deepEqual(
    gradeFinalTest(pool, [{ question_id: 'q1', selected: 'a' }, { question_id: 'q2', selected: 'b' }]),
    { score: 3, total: 4, percentage: 75, passed: false, passing_score: 80 },
  );
  const all = gradeFinalTest(pool, [{ question_id: 'q1', selected: 'a' }, { question_id: 'q2', selected: 'a' }]);
  assert.equal(all.passed, true);
  // Unanswered questions still count towards the total.
  assert.equal(gradeFinalTest(pool, [{ question_id: 'q1', selected: null }, { question_id: 'q2', selected: null }]).percentage, 0);
});

test('grading rejects answers that are not one sitting of the test', () => {
  const pool = { assessment: null, questions: [q('q1'), q('q2'), q('q3')], count: 2 };
  const ok = [{ question_id: 'q1', selected: 'a' }, { question_id: 'q2', selected: 'a' }];
  assert.ok(gradeFinalTest(pool, ok));
  assert.equal(gradeFinalTest(pool, [ok[0]]), null, 'too few');
  assert.equal(gradeFinalTest(pool, [...ok, { question_id: 'q3', selected: 'a' }]), null, 'too many');
  assert.equal(gradeFinalTest(pool, [ok[0], ok[0]]), null, 'repeated');
  assert.equal(gradeFinalTest(pool, [ok[0], { question_id: 'other', selected: 'a' }]), null, 'foreign question');
  assert.equal(gradeFinalTest(pool, 'nope'), null, 'not an array');
  assert.equal(gradeFinalTest({ assessment: null, questions: [], count: 0 }, []), null, 'empty test');
});

test('learners cannot create certificates; admins can', () => {
  const rule = ruleFor(ENTITIES.Certificate, 'create');
  assert.equal(ruleToQuery(rule, { id: 'u1', role: 'user' }), false);
  assert.equal(ruleToQuery(rule, { id: 'a1', role: 'admin' }), true);
});

test('certificate ids are unique and well formed', () => {
  const ids = new Set(Array.from({ length: 200 }, newCertificateId));
  assert.equal(ids.size, 200);
  for (const id of ids) assert.match(id, /^IEA-[0-9A-Z]+-[0-9A-Z]{6}$/);
});
