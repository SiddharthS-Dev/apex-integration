/**
 * A real component, rendered and driven: the add-plate modal.
 *
 * It is the one place a visitor writes data, and the interesting paths are the
 * ones the browser smoke script covers slowly — validation, the storage-quota
 * failure, and the dialog semantics. Here they run in milliseconds.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { useDom } from './dom.mjs'

useDom()

async function mount({ open = true } = {}) {
  const [{ createElement: h, act }, { createRoot }, mod] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('../src/features/showcase/components/AddImageModal.jsx'),
  ])
  const AddImageModal = mod.default

  const added = []
  const closes = { count: 0 }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)

  await act(async () =>
    root.render(
      h(AddImageModal, {
        open,
        cats: ['Systems & Architecture', 'Command Decks'],
        techs: ['Edge AI', 'Security'],
        onClose: () => {
          closes.count += 1
        },
        onAdded: (item) => added.push(item),
      })
    )
  )

  const form = () => document.querySelector('form')
  const setField = async (placeholderMatch, value) =>
    act(async () => {
      const input = [...form().querySelectorAll('input')].find((i) => placeholderMatch.test(i.placeholder || ''))
      assert.ok(input, `no input matching ${placeholderMatch}`)
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, value)
      input.dispatchEvent(new window.Event('input', { bubbles: true }))
    })

  // dispatch the event rather than requestSubmit(): jsdom's implementation does
  // not reach React's delegated listener for portalled content
  const submit = async () =>
    act(async () => {
      form().dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }))
    })
  const errorText = () => [...form().querySelectorAll('p')].map((p) => p.textContent).join(' | ')

  return { act, added, closes, form, setField, submit, errorText }
}

test('it renders as a labelled modal dialog', async () => {
  await mount()
  const dialog = document.querySelector('[role="dialog"]')
  assert.ok(dialog, 'no element with role=dialog')
  assert.equal(dialog.getAttribute('aria-modal'), 'true')
  assert.match(dialog.getAttribute('aria-label') || '', /plate/i)
})

test('focus lands inside the dialog on open', async () => {
  await mount()
  assert.ok(
    document.querySelector('[role="dialog"]').contains(document.activeElement),
    `focus was on ${document.activeElement?.tagName}`
  )
})

test('Escape asks the parent to close', async () => {
  const { act, closes } = await mount()
  await act(async () => {
    document.activeElement.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    )
  })
  assert.equal(closes.count, 1)
})

test('it refuses a plate with no title', async () => {
  const { submit, errorText, added } = await mount()
  await submit()
  assert.match(errorText(), /title/i)
  assert.equal(added.length, 0)
})

test('it refuses a plate with no image', async () => {
  const { setField, submit, errorText, added } = await mount()
  await setField(/Edge Inference/, 'Titled but imageless')
  await submit()
  assert.match(errorText(), /image/i)
  assert.equal(added.length, 0)
})

test('a valid plate is saved and handed to the parent', async () => {
  const { setField, submit, added, errorText } = await mount()
  await setField(/Edge Inference/, '  Edge Inference Mesh  ')
  await setField(/https/, 'https://example.com/plate.png')
  await submit()

  assert.equal(errorText().includes('storage'), false, errorText())
  assert.equal(added.length, 1)
  assert.equal(added[0].title, 'Edge Inference Mesh', 'title is trimmed')
  assert.equal(added[0].custom, true)

  const stored = JSON.parse(localStorage.getItem('inspironics.customItems.v1'))
  assert.equal(stored.length, 1)
  assert.equal(stored[0].title, 'Edge Inference Mesh')
})

test('a full quota is reported and nothing is persisted', async () => {
  const { setField, submit, added, errorText } = await mount()

  // exactly the failure the 4 MB upload cap used to hide. Swap the whole
  // Storage object: which of window.localStorage / globalThis.localStorage the
  // module reaches is not something the test should have to know.
  const real = globalThis.localStorage
  const quotaFull = {
    getItem: (k) => real.getItem(k),
    removeItem: (k) => real.removeItem(k),
    clear: () => real.clear(),
    key: (i) => real.key(i),
    get length() {
      return real.length
    },
    setItem() {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    },
  }
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: quotaFull })
  try {
    await setField(/Edge Inference/, 'Too big')
    await setField(/https/, 'data:image/png;base64,' + 'A'.repeat(2048))
    await submit()
  } finally {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: real })
  }

  assert.match(errorText(), /storage is full/i)
  assert.equal(added.length, 0, 'the parent must not be told it succeeded')
  assert.ok(document.querySelector('form'), 'the modal stays open so the visitor can act')
  assert.equal(localStorage.getItem('inspironics.customItems.v1'), null)
})

test('closed, it renders nothing at all', async () => {
  await mount({ open: false })
  assert.equal(document.querySelector('[role="dialog"]'), null)
  assert.equal(document.querySelector('form'), null)
})
