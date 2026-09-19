import { strict as assert } from 'node:assert'
import test from 'node:test'
import { installBrowserStubs } from './helpers.mjs'

const stubs = installBrowserStubs()
const { addCustomItem, loadCustomItems, removeCustomItem, clearCustomItems } = await import(
  '../src/features/showcase/model/customItems.js'
)

const KEY = 'inspironics.customItems.v1'

test('an added item carries the shape the gallery expects', () => {
  stubs.reset()
  const item = addCustomItem({ title: '  Edge Mesh  ', imageUrl: 'https://x/y.png', tech: ['Edge AI'], esg: true })

  assert.equal(item.title, 'Edge Mesh', 'title is trimmed')
  assert.equal(item.custom, true)
  assert.equal(item.esg, true)
  assert.equal(item.ai, false)
  assert.deepEqual(item.tech, ['Edge AI'])
  // every url field the gallery may read is populated from the one input
  for (const k of ['t', 'full', 'thumbUrl', 'fullUrl']) assert.equal(item[k], 'https://x/y.png')
  assert.match(item.f, /^custom-/)
  assert.ok(Date.parse(item.addedAt))
})

test('items are stored newest first and survive a reload', () => {
  stubs.reset()
  addCustomItem({ title: 'First', imageUrl: 'a' })
  addCustomItem({ title: 'Second', imageUrl: 'b' })
  assert.deepEqual(
    loadCustomItems().map((i) => i.title),
    ['Second', 'First']
  )
})

test('adding an item announces the change exactly once', () => {
  stubs.reset()
  let fired = 0
  window.addEventListener('inspironics:custom-items', () => (fired += 1))
  addCustomItem({ title: 'Announced', imageUrl: 'a' })
  assert.equal(fired, 1)
})

test('a full quota throws, stores nothing and announces nothing', () => {
  stubs.reset()
  addCustomItem({ title: 'Existing', imageUrl: 'a' })
  const before = localStorage.getItem(KEY)

  let fired = 0
  window.addEventListener('inspironics:custom-items', () => (fired += 1))
  stubs.failWrites()

  assert.throws(
    () => addCustomItem({ title: 'Too big', imageUrl: 'data:image/png;base64,' + 'A'.repeat(1000) }),
    /storage is full/i
  )
  assert.equal(fired, 0, 'no change event on a failed write')
  assert.equal(localStorage.getItem(KEY), before, 'storage untouched')
})

test('remove drops exactly one item', () => {
  stubs.reset()
  const a = addCustomItem({ title: 'A', imageUrl: 'a' })
  addCustomItem({ title: 'B', imageUrl: 'b' })
  removeCustomItem(a.f)
  assert.deepEqual(
    loadCustomItems().map((i) => i.title),
    ['B']
  )
})

test('clear empties the store', () => {
  stubs.reset()
  addCustomItem({ title: 'A', imageUrl: 'a' })
  clearCustomItems()
  assert.deepEqual(loadCustomItems(), [])
})

test('corrupt storage reads as empty rather than throwing', () => {
  stubs.reset()
  localStorage.setItem(KEY, '{not json')
  assert.deepEqual(loadCustomItems(), [])
  localStorage.setItem(KEY, '{"not":"an array"}')
  assert.deepEqual(loadCustomItems(), [])
})
