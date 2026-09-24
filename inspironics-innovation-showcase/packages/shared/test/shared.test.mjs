import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORIES, extensionOf, fileTypeOf, isSupported, tagForCategory } from '../src/index.js'

test('category tags are unique', () => {
  assert.equal(new Set(CATEGORIES.map((c) => c.tag)).size, CATEGORIES.length)
})

test('tagForCategory maps known names and slugs unknown ones', () => {
  assert.equal(tagForCategory('Command Decks'), 'command')
  assert.equal(tagForCategory('Grid & Power'), 'grid-power')
})

test('file types are matched case-insensitively', () => {
  assert.equal(extensionOf('IMG_0557.JPG'), 'jpg')
  assert.ok(isSupported('deck.PPTX'))
  assert.ok(!isSupported('notes.txt'))
  assert.equal(fileTypeOf('a.webp').kind, 'image')
  assert.equal(extensionOf('noext'), '')
})
