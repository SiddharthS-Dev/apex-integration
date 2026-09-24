/**
 * Error sink.
 *
 * The error boundary used to log to the console and stop there, which means a
 * failure in someone else's browser left no trace anywhere. This is the one
 * place errors are funnelled through, so wiring up a real service is a change
 * to `deliver()` and nothing else.
 *
 * With no endpoint configured it still logs, and it de-duplicates: a render
 * loop that throws every frame should not produce a thousand identical reports.
 */
import { env } from '#shared/config'

const seen = new Map()
const WINDOW_MS = 60_000
const MAX_PER_WINDOW = 3

const deliver = (payload) => {
  if (!env.errorEndpoint) return
  try {
    // keepalive so a report survives the page being torn down under it
    fetch(env.errorEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    }).catch(() => {})
  } catch {
    /* never let reporting be the thing that breaks */
  }
}

/**
 * @param {unknown} error
 * @param {{ source?: string, [key: string]: unknown }} [context]
 */
export function reportError(error, context = {}) {
  const err = error instanceof Error ? error : new Error(String(error))
  const key = `${context.source || 'app'}::${err.message}`

  const now = Date.now()
  const record = seen.get(key)
  if (record && now - record.first < WINDOW_MS) {
    record.count += 1
    if (record.count > MAX_PER_WINDOW) return
  } else {
    seen.set(key, { first: now, count: 1 })
  }

  console.error(`[${context.source || 'app'}]`, err, context)
  deliver({
    message: err.message,
    stack: err.stack,
    context,
    url: typeof location !== 'undefined' ? location.href : undefined,
    at: new Date().toISOString(),
  })
}

export function resetErrorReporting() {
  seen.clear()
}

/**
 * Catch what escapes React: async throws and rejected promises.
 * Call once, from the composition root.
 */
export function installGlobalErrorReporting() {
  if (typeof window === 'undefined' || window.__inspironicsReporting) return
  window.__inspironicsReporting = true

  window.addEventListener('error', (event) => {
    reportError(event.error || event.message, { source: 'window.error', filename: event.filename })
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportError(event.reason, { source: 'unhandledrejection' })
  })
}
