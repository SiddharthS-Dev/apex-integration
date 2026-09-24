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
