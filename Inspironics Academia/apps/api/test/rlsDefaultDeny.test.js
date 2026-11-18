import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ENTITIES, ruleFor, ruleToQuery } from '@academy/shared';

const admin = { id: 'a1', role: 'admin' };
const learner = { id: 'u1', role: 'user' };
const ACTIONS = ['read', 'create', 'update', 'delete'];

test('row-level rules: the documented grammar still works', () => {
  assert.equal(ruleToQuery({}, learner), true, '{} is everyone signed in');
  assert.equal(ruleToQuery({ user_condition: { role: 'admin' } }, admin), true);
  assert.equal(ruleToQuery({ user_condition: { role: 'admin' } }, learner), false);
  assert.deepEqual(ruleToQuery({ 'data.user_id': '{{user.id}}' }, learner), { user_id: 'u1' });
  assert.equal(ruleToQuery({ 'data.user_id': '{{user.id}}' }, null), false, 'no user, no match');
  assert.deepEqual(
    ruleToQuery({ $or: [{ user_condition: { role: 'admin' } }, { 'data.user_id': '{{user.id}}' }] }, learner),
    { user_id: 'u1' },
  );
  assert.equal(ruleToQuery({ $or: [] }, admin), false, 'an empty $or matches nothing');
});

test('row-level rules: missing or malformed rules deny instead of allowing everyone', () => {
  for (const rule of [undefined, null, 'admin', 42, true, [], [{}]]) {
    assert.equal(ruleToQuery(rule, admin), false, `rule ${JSON.stringify(rule)} denies`);
  }
  assert.equal(ruleFor({ rls: {} }, 'delete'), undefined);
  assert.equal(ruleToQuery(ruleFor({ rls: {} }, 'delete'), admin), false, 'a forgotten action denies');
  assert.equal(ruleToQuery(ruleFor(undefined, 'read'), admin), false, 'an unknown entity denies');
});

test('row-level rules: unknown keys and mixed $or deny, so a typo cannot open access', () => {
  assert.equal(ruleToQuery({ user_id: '{{user.id}}' }, learner), false, 'missing the data. prefix');
  assert.equal(ruleToQuery({ 'data.user_id': '{{user.id}}', role: 'admin' }, learner), false);
  assert.equal(ruleToQuery({ user_condition: 'admin' }, admin), false, 'user_condition must be an object');
  assert.equal(
    ruleToQuery({ $or: [{}], user_condition: { role: 'admin' } }, learner),
    false,
    '$or next to other keys would drop them, so it denies',
  );
  assert.equal(ruleToQuery({ $or: { user_condition: { role: 'admin' } } }, admin), false, '$or needs an array');
});

test('row-level rules: every entity defines all four actions in the known grammar', () => {
  for (const [name, schema] of Object.entries(ENTITIES)) {
    for (const action of ACTIONS) {
      const rule = ruleFor(schema, action);
      assert.ok(rule && typeof rule === 'object', `${name}.${action} has a rule`);
      // An admin passes every rule in use today. If a rule were malformed it would now deny the
      // admin too, which this catches before it reaches users.
      assert.notEqual(ruleToQuery(rule, admin), false, `${name}.${action} is well-formed`);
    }
  }
});
