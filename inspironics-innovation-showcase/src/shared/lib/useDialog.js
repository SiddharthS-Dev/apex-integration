import { useEffect, useRef } from 'react'
import { lockScroll } from './scrollLock.js'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

const focusableIn = (root) =>
  [...root.querySelectorAll(FOCUSABLE)].filter(
    (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement
  )

/**
 * Modal dialog behaviour: scroll lock, focus containment, focus restore, and
 * Escape to close.
 *
 * The three overlays in this app (the lightbox, the add-plate modal and the
 * copilot panel) each had Escape and a scroll lock but no focus management, so
 * a keyboard or screen-reader user could tab straight past the overlay into the
 * page behind it. Containing focus is the part that makes them actual dialogs
 * rather than a div on top.
 *
 * Pair it with `role="dialog"`, `aria-modal="true"` and a label on the same
 * element the returned ref is attached to.
 *
 * @param {boolean} open
 * @param {() => void} onClose
 * @param {{ closeOnEscape?: boolean, lockScroll?: boolean, trapFocus?: boolean }} [options]
 *   `trapFocus: false` for a non-modal popover — focus still moves in and is
 *   restored on close, but the rest of the page stays reachable by keyboard.
 * @returns {import('react').MutableRefObject<any>} attach to the dialog root
 */
export function useDialog(open, onClose, options = {}) {
  const { closeOnEscape = true, lockScroll: shouldLock = true, trapFocus = true } = options
  /** @type {import('react').MutableRefObject<any>} */
  const ref = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return

    const root = ref.current
    // Remember where focus came from, so closing puts it back rather than
    // dumping the user at the top of the document.
    const restoreTo = document.activeElement
    const release = shouldLock ? lockScroll() : null

    // Move focus in: the first control, else the dialog itself.
    const initial = root && (focusableIn(root)[0] || root)
    if (initial) {
      if (initial === root && !root.hasAttribute('tabindex')) root.setAttribute('tabindex', '-1')
      initial.focus({ preventScroll: true })
    }

    const onKeyDown = (event) => {
      if (closeOnEscape && event.key === 'Escape') {
        event.stopPropagation()
        closeRef.current?.()
        return
      }
      if (!trapFocus || event.key !== 'Tab' || !root) return

      const items = focusableIn(root)
      if (items.length === 0) {
        event.preventDefault()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement

      // wrap at both ends, and pull focus back if it has escaped the dialog
      if (!root.contains(active)) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && active === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && active === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('keydown', onKeyDown, true)
      release?.()
      if (restoreTo instanceof HTMLElement && document.contains(restoreTo)) {
        restoreTo.focus({ preventScroll: true })
      }
    }
  }, [open, closeOnEscape, shouldLock, trapFocus])

  return ref
}
