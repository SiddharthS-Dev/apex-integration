/**
 * Browser stubs for the unit tests.
 *
 * The modules under test are the ones that hold real logic but no React:
 * the auth service, the custom-item store and the ecosystem route matching.
 * They only need localStorage and a window that can dispatch events, so there
 * is no reason to pull in a full DOM.
 */
export function installBrowserStubs() {
  const store = new Map()
  let writeFailure = null

  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => {
      if (writeFailure) {
        const err = new Error(writeFailure)
        err.name = 'QuotaExceededError'
        throw err
      }
      store.set(k, String(v))
    },
    removeItem: (k) => void store.delete(k),
    clear: () => store.clear(),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size
    },
  }

  const listeners = new Map()
  globalThis.window = {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(type, (listeners.get(type) || []).filter((f) => f !== fn)),
    dispatchEvent: (event) => {
      ;(listeners.get(event.type) || []).forEach((fn) => fn(event))
      return true
    },
  }
  globalThis.CustomEvent = class CustomEvent {
    constructor(type, opts = {}) {
      this.type = type
      this.detail = opts.detail
    }
  }

  return {
    store,
    /** Make localStorage.setItem fail the way a full quota does. */
    failWrites(message = 'QuotaExceededError') {
      writeFailure = message
    },
    allowWrites() {
      writeFailure = null
    },
    reset() {
      writeFailure = null
      store.clear()
      listeners.clear()
    },
  }
}
