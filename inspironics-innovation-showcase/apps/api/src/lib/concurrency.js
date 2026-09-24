/**
 * Small concurrency primitives the sync and the token manager are built on.
 */

/**
 * Collapse concurrent calls for the same key into one in-flight promise.
 * The eighth worker asking for a fresh Dropbox token while the first is
 * refreshing waits for that refresh instead of starting its own.
 */
export function createSingleFlight() {
  const inflight = new Map()
  return function run(key, fn) {
    if (inflight.has(key)) return inflight.get(key)
    const p = Promise.resolve()
      .then(fn)
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
    return p
  }
}

/**
 * Run `worker` over `items` with at most `limit` in flight. Unbounded would
 * open a socket and fire an AI call per file simultaneously.
 *
 * Never rejects: each result is `{ ok: true, value }` or `{ ok: false, error }`,
 * so one bad file cannot abort the rest of a run. `shouldStop()` lets a caller
 * cut a run short between items.
 */
export async function mapPool(items, limit, worker, { shouldStop = () => false } = {}) {
  const results = new Array(items.length)
  let next = 0
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length && !shouldStop()) {
      const i = next++
      try {
        results[i] = { ok: true, value: await worker(items[i], i) }
      } catch (error) {
        results[i] = { ok: false, error }
      }
    }
  })
  await Promise.all(lanes)
  return results
}

/** Serialise async sections — used where SQLite needs one writer at a time. */
export function createMutex() {
  let tail = Promise.resolve()
  return function lock(fn) {
    const run = tail.then(fn, fn)
    tail = run.then(
      () => {},
      () => {}
    )
    return run
  }
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
