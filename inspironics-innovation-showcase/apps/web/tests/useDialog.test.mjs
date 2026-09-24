/**
 * The dialog behaviour that the three overlays rely on. This is the part that
 * was missing entirely — Escape and a scroll lock, but no focus management —
 * so it is worth testing directly rather than through a whole component.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { activeDescription, useDom } from './dom.mjs'

useDom()

/** Render a small dialog harness and drive it. */
async function mount({ trapFocus = true, lockScroll = true } = {}) {
  const [{ createElement: h, useState }, { createRoot }, { act }, { useDialog }] = await Promise.all([
    import('react'),
    import('react-dom/client'),
    import('react'),
    import('../src/shared/lib/useDialog.js'),
  ])

  const closed = { count: 0 }

  function Harness() {
    const [open, setOpen] = useState(false)
    const ref = useDialog(open, () => {
      closed.count += 1
      setOpen(false)
    }, { trapFocus, lockScroll })

    return h(
      'div',
      null,
      h('button', { id: 'opener', onClick: () => setOpen(true) }, 'open'),
      h('button', { id: 'outside' }, 'outside'),
      open
        ? h(
            'div',
            { ref, role: 'dialog', 'aria-modal': 'true', 'aria-label': 'test dialog', id: 'dialog' },
            h('button', { id: 'first' }, 'first'),
            h('input', { id: 'middle' }),
            h('button', { id: 'last' }, 'last')
          )
        : null
    )
  }

  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => root.render(h(Harness)))

  const press = async (key, init = {}) =>
    act(async () => {
      document.activeElement.dispatchEvent(
        new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      )
    })

  return { act, root, closed, press }
}

test('opening moves focus into the dialog', async () => {
  const { act, closed } = await mount()
  document.querySelector('#opener').focus()
  await act(async () => document.querySelector('#opener').click())

  assert.equal(document.activeElement.id, 'first', `focus went to ${activeDescription()}`)
  assert.equal(closed.count, 0)
})

test('Tab wraps from the last control back to the first', async () => {
  const { act, press } = await mount()
  await act(async () => document.querySelector('#opener').click())

  document.querySelector('#last').focus()
  await press('Tab')
  assert.equal(document.activeElement.id, 'first')
})

test('Shift+Tab wraps backwards from the first control', async () => {
  const { act, press } = await mount()
  await act(async () => document.querySelector('#opener').click())

  document.querySelector('#first').focus()
  await press('Tab', { shiftKey: true })
  assert.equal(document.activeElement.id, 'last')
})

test('focus that escapes the dialog is pulled back in', async () => {
  const { act, press } = await mount()
  await act(async () => document.querySelector('#opener').click())

  // this is what used to happen freely: focus parked behind the overlay
  document.querySelector('#outside').focus()
  await press('Tab')
  assert.equal(document.activeElement.id, 'first', 'focus must not stay outside a modal dialog')
})

test('Escape closes and focus returns to whatever opened it', async () => {
  const { act, press, closed } = await mount()
  const opener = document.querySelector('#opener')
  opener.focus()
  await act(async () => opener.click())
  assert.equal(document.activeElement.id, 'first')

  await press('Escape')
  assert.equal(closed.count, 1)
  assert.equal(document.activeElement.id, 'opener', `focus went to ${activeDescription()}`)
})

test('a non-modal popover moves focus in but does not trap it', async () => {
  const { act, press } = await mount({ trapFocus: false, lockScroll: false })
  await act(async () => document.querySelector('#opener').click())
  assert.equal(document.activeElement.id, 'first')

  document.querySelector('#outside').focus()
  await press('Tab')
  assert.equal(document.activeElement.id, 'outside', 'a non-modal popover must leave the page reachable')
})

test('the body scroll lock is applied while open and released on close', async () => {
  const { act, press } = await mount()
  assert.equal(document.body.style.overflow, '')

  await act(async () => document.querySelector('#opener').click())
  assert.equal(document.body.style.overflow, 'hidden')

  await press('Escape')
  assert.equal(document.body.style.overflow, '')
})

test('a non-modal popover leaves body scrolling alone', async () => {
  const { act } = await mount({ trapFocus: false, lockScroll: false })
  await act(async () => document.querySelector('#opener').click())
  assert.equal(document.body.style.overflow, '')
})
