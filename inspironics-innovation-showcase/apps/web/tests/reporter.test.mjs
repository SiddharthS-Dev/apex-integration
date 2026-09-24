import { strict as assert } from 'node:assert'
import test from 'node:test'

const { reportError, installGlobalErrorReporting } = await import('../src/shared/lib/reporter.js')

test('reportError deduplicates repeated errors in the same window', () => {
  const originalConsoleError = console.error
  const calls = []
  console.error = (...args) => calls.push(args)

  try {
    reportError(new Error('same bug'))
    reportError(new Error('same bug'))
    reportError(new Error('same bug'))
    reportError(new Error('same bug'))

    assert.equal(calls.length, 3)
  } finally {
    console.error = originalConsoleError
  }
})

test('installGlobalErrorReporting attaches listeners only once', () => {
  const originalWindow = globalThis.window
  const seen = []
  const mockWindow = {
    __inspironicsReporting: false,
    addEventListener(type) {
      seen.push(type)
    },
  }

  globalThis.window = mockWindow

  try {
    installGlobalErrorReporting()
    installGlobalErrorReporting()
    assert.deepEqual(seen, ['error', 'unhandledrejection'])
  } finally {
    globalThis.window = originalWindow
  }
})
