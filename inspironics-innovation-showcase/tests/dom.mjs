/**
 * DOM harness for component tests.
 *
 * `node:test` has no environment concept, so jsdom is installed into globals
 * before React is imported. Import this module first in any component test.
 */
import globalJsdom from 'global-jsdom'
import { afterEach, beforeEach } from 'node:test'

let teardown = null

/**
 * Install a fresh jsdom per test, and reset the module-scoped browser state the
 * app keeps (storage keys, the scroll lock's reference count) so tests cannot
 * leak into each other.
 */
export function useDom() {
  beforeEach(() => {
    teardown = globalJsdom(undefined, { url: 'http://localhost/', pretendToBeVisual: true })

    // jsdom has no layout, so offsetWidth/offsetHeight are always 0 — which
    // makes the focus-trap's visibility filter reject everything. Report a size
    // for anything attached to the document.
    for (const prop of ['offsetWidth', 'offsetHeight']) {
      Object.defineProperty(window.HTMLElement.prototype, prop, {
        configurable: true,
        get() {
          return this.isConnected ? 24 : 0
        },
      })
    }

    // not implemented in jsdom, and the explorer uses both
    window.matchMedia = window.matchMedia || ((query) => ({
      matches: false,
      media: query,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }))
    globalThis.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    /*
     * Re-point the event constructors at the *current* window. A fresh jsdom
     * per test leaves some globals holding the previous realm's classes, and
     * `window.dispatchEvent(new CustomEvent(...))` then fails with "parameter 1
     * is not of type 'Event'" — which surfaced as the custom-item store
     * silently failing to announce a save.
     */
    for (const name of [
      'Event',
      'CustomEvent',
      'KeyboardEvent',
      'MouseEvent',
      'PointerEvent',
      'Node',
      'HTMLElement',
      'DocumentFragment',
    ]) {
      if (window[name]) globalThis[name] = window[name]
    }

    // React 18 wants this flag set to silence its act() environment warning
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    // let any queued React or timer work run against a document that still
    // exists, or it lands after teardown as "window is not defined"
    await new Promise((resolve) => setTimeout(resolve, 0))
    teardown?.()
    teardown = null
  })
}

/** Focused element, as a readable string, for assertions. */
export const activeDescription = () => {
  const el = document.activeElement
  if (!el || el === document.body) return 'body'
  return `${el.tagName.toLowerCase()}${el.textContent ? `[${el.textContent.trim().slice(0, 24)}]` : ''}`
}
