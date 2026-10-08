import { strict as assert } from 'node:assert'
import test from 'node:test'
import { installBrowserStubs } from './helpers.mjs'

installBrowserStubs()
const { CLAUDE_SKILLS_CATEGORY, CATEGORY_NAMES } = await import('@inspironics/shared')
const { isClaudeSkill } = await import('../src/features/showcase/model/showcaseData.js')

test('Claude Skill Up Tools is a category the gallery knows', () => {
  assert.equal(CLAUDE_SKILLS_CATEGORY, 'Claude Skill Up Tools')
  assert.ok(CATEGORY_NAMES.includes(CLAUDE_SKILLS_CATEGORY))
})

test('a plate filed under it is in the collection; any other category is not', () => {
  assert.equal(isClaudeSkill({ cat: 'Claude Skill Up Tools' }), true)
  assert.equal(isClaudeSkill({ cat: 'Command Decks' }), false)
  assert.equal(isClaudeSkill({ cat: 'Unclassified' }), false)
  assert.equal(isClaudeSkill({ custom: true }), false)
})

test('plates sharing a file name in two Dropbox folders keep distinct keys', async () => {
  const { plateKey, relatedTo } = await import('../src/features/showcase/model/showcaseData.js')
  const a = { id: 'a1', f: 'same.jpg', cat: 'Command Decks', tech: [] }
  const b = { id: 'b2', f: 'same.jpg', cat: 'Command Decks', tech: [] }
  assert.notEqual(plateKey(a), plateKey(b))
  assert.equal(plateKey({ f: 'custom-x' }), 'custom-x')
  assert.deepEqual(relatedTo([a, b], a), [b], 'a namesake in another folder is related, not the plate itself')
})
