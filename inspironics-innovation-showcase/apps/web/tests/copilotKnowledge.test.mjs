import { strict as assert } from 'node:assert'
import test from 'node:test'
import { installBrowserStubs } from './helpers.mjs'

const stubs = installBrowserStubs()
const { CopilotNote } = await import('../src/features/copilot/model/copilotKnowledge.js')

const KEY = 'inspironics.copilot.notes.v1'

test('CopilotNote ignores malformed persisted entries', () => {
  stubs.reset()
  localStorage.setItem(
    KEY,
    JSON.stringify([
      null,
      'not a note',
      { ownerId: 'user-1', sessionId: 'session-1', text: 'Keep this', createdAt: 1 },
    ])
  )

  assert.deepEqual(CopilotNote.list({ id: 'user-1' }, 'session-1').map((note) => note.text), ['Keep this'])
})

test('the copilot describes itself honestly: a catalogue search, no fake thinking delay', async () => {
  const { readFileSync } = await import('node:fs')
  const { answerQuestion } = await import('../src/features/copilot/model/copilotKnowledge.js')
  const hi = answerQuestion({ items: [], cats: [], techs: [], totalCount: 7, stats: {}, productCounts: {} }, 'hello')
  assert.match(hi.text, /\*\*7\*\* plates in this library's catalogue/)
  assert.doesNotMatch(hi.text, /indexed|baked into the artwork/)

  const panel = readFileSync(new URL('../src/features/copilot/components/CopilotPanel.jsx', import.meta.url), 'utf8')
  assert.match(panel, /keyword search, not a language model/)
  assert.doesNotMatch(panel, /every plate in the estate indexed/)
  assert.doesNotMatch(panel, /setTimeout/, 'answers are not delayed to look like thinking')
})
