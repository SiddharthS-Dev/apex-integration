import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LAYOUT_NAMES, STORYBOARD_SCHEMA, VIDEO_STRUCTURES, codeIn, normalizeSlide, storyboardPrompt, structureFor, verbatimIn,
} from '../src/pipeline/videoPlan.js';
import { strictSchema } from '../src/ai/claude.js';

// A playbook chapter in the shape the extractor stores: headings, rules, a procedure, a table, config.
const CHAPTER = `3.1 Severity Levels
Every incident is assigned a severity within 5 minutes of detection.
Severity | Response time | Who is paged
P1 | 15 minutes | On-call engineer and incident commander
P2 | 1 hour | On-call engineer
3.2 Escalation Path
The on-call engineer must acknowledge a P1 page within 15 minutes. If the page is not acknowledged, it escalates to the secondary on-call.
Never close an incident before the customer impact has ended.
3.3 Paging Configuration
escalation_policy:
  ack_timeout: 15m
  repeat: 3`;

const opts = { source: CHAPTER, sectionFallback: 'Incident Response', fallbackPoints: ['From the narration'] };

test('a rule is kept only when its quote is really in the chapter', () => {
  const real = normalizeSlide({
    title: 'Acknowledge Fast', layout: 'rule', source_ref: '3.2 Escalation Path', points: ['Ack within 15 minutes'],
    quote: '“The on-call engineer must acknowledge a P1 page within 15 minutes.”',
  }, opts);
  assert.equal(real.layout, 'rule');
  assert.equal(real.quote, 'The on-call engineer must acknowledge a P1 page within 15 minutes.');
  assert.equal(real.source, '3.2 Escalation Path');

  const invented = normalizeSlide({ title: 'Ack', layout: 'rule', source_ref: '3.2', points: [], quote: 'Engineers must acknowledge every page within 5 minutes.' }, opts);
  assert.equal(invented.layout, 'points', 'an invented quote is never shown as the playbook\'s words');
  assert.deepEqual(invented.points, ['Engineers must acknowledge every page within 5 minutes']);
});

test('quotes match despite case, spacing and typographic quotes; short fragments do not count', () => {
  assert.ok(verbatimIn(CHAPTER, 'never close an  incident before the customer impact has ended'));
  assert.ok(!verbatimIn(CHAPTER, 'P1'), 'too short to prove anything');
  assert.ok(codeIn(CHAPTER, 'escalation_policy:\n  ack_timeout: 15m'));
  assert.ok(!codeIn(CHAPTER, 'ack_timeout: 5m'));
});

test('code is shown only when every line is from the chapter', () => {
  const ok = normalizeSlide({ title: 'Paging Policy', layout: 'code', source_ref: '3.3 Paging Configuration', points: ['Ack timeout is 15 minutes'], code: 'escalation_policy:\n  ack_timeout: 15m\n  repeat: 3', language: 'yaml' }, opts);
  assert.equal(ok.layout, 'code');
  assert.equal(ok.language, 'yaml');
  const made = normalizeSlide({ title: 'Paging Policy', layout: 'code', source_ref: '3.3', points: ['Ack timeout'], code: 'retries: 9' }, opts);
  assert.equal(made.layout, 'points');
});

test('structured layouts keep their shape and fall back when incomplete', () => {
  const table = normalizeSlide({
    title: 'Severity Response Times', layout: 'table', source_ref: '3.1 Severity Levels', points: [],
    table: { headers: ['Severity', 'Response time', 'Who is paged'], rows: [['P1', '15 minutes', 'On-call and IC'], ['P2', '1 hour', 'On-call'], ['P3', 'missing cell']] },
  }, opts);
  assert.equal(table.layout, 'table');
  assert.equal(table.table.rows.length, 2, 'ragged rows are dropped');
  assert.deepEqual(table.points[0], 'P1 — 15 minutes — On-call and IC', 'a text summary is derived');

  const decision = normalizeSlide({
    title: 'When a Page Goes Unanswered', layout: 'decision', source_ref: '3.2 Escalation Path', points: ['Escalate'], question: 'Page acknowledged?',
    branches: [{ when: 'Acknowledged in 15 min', then: 'Primary owns the incident' }, { when: 'Not acknowledged', then: 'Escalates to the secondary on-call' }],
  }, opts);
  assert.equal(decision.layout, 'decision');
  assert.equal(decision.branches.length, 2);

  const compare = normalizeSlide({
    title: 'Closing Incidents', layout: 'compare', source_ref: '3.2', points: ['Wait for impact to end'],
    columns: [{ label: 'Do', tone: 'do', items: ['Confirm impact has ended'] }, { label: "Don't", tone: 'dont', items: ['Close on a quiet dashboard'] }],
  }, opts);
  assert.equal(compare.layout, 'compare');
  assert.equal(compare.columns[1].tone, 'dont');

  const lonely = normalizeSlide({ title: 'Steps', layout: 'steps', source_ref: '', points: ['Only one'] }, opts);
  assert.equal(lonely.layout, 'points', 'one step is not a procedure');
  const empty = normalizeSlide({ title: 'Timeline', layout: 'timeline', source_ref: '', points: [], events: [{ label: 'T+0', text: 'Alert' }] }, opts);
  assert.deepEqual([empty.layout, empty.points], ['points', ['From the narration']]);
});

test('source references must exist in the chapter, otherwise the lesson section is used', () => {
  assert.equal(normalizeSlide({ title: 'x', layout: 'points', source_ref: '§ 3.1 Severity Levels', points: ['a b'] }, opts).source, '3.1 Severity Levels');
  assert.equal(normalizeSlide({ title: 'x', layout: 'points', source_ref: '9.9 Made Up Section', points: ['a b'] }, opts).source, 'Incident Response');
  assert.equal(normalizeSlide({ title: 'x', layout: 'mystery', source_ref: '', points: ['a b'] }, opts).layout, 'points');
});

test('each lesson type has a teaching order and only known layouts', () => {
  for (const [type, s] of Object.entries(VIDEO_STRUCTURES)) {
    assert.ok(s.flow.includes('→'), type);
    assert.ok(s.layouts.every((l) => LAYOUT_NAMES.includes(l)), type);
  }
  assert.equal(structureFor('unknown'), VIDEO_STRUCTURES.concept);
});

test('the slide prompt carries the chapter, the lesson structure and one part per slide', () => {
  const prompt = storyboardPrompt({
    lesson: { title: 'Escalation', video_type: 'demonstration' },
    segments: ['First part.', 'Second part.'],
    source: { playbook: 'SRE Playbook', version: 'v3 (2.1)', chapter: 'Incident Response', text: CHAPTER },
  });
  assert.match(prompt, /Return exactly 2 slides/);
  assert.match(prompt, /prerequisites → the procedure, step by step/);
  assert.match(prompt, /SRE Playbook" \(v3 \(2\.1\)\)/);
  assert.ok(prompt.includes('ack_timeout: 15m'), 'the chapter text is in the prompt');
  assert.match(prompt, /Part 2: Second part\./);
});

test('the storyboard schema is valid for structured outputs', () => {
  const strict = strictSchema(STORYBOARD_SCHEMA);
  const scene = strict.properties.scenes.items;
  assert.equal(scene.additionalProperties, false);
  assert.equal(scene.properties.table.additionalProperties, false);
  assert.deepEqual(scene.properties.layout.enum, LAYOUT_NAMES);
});
