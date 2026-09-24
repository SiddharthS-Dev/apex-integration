/**
 * Small async primitives shared by the Dropbox layer: bounded exponential
 * backoff, a single-flight mutex, and a bounded worker pool.
 *
 * These are deliberately dependency-free and injectable (sleep/random) so the
 * retry and concurrency tests run instantly and deterministically.
 */

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Bounded exponential backoff with full jitter.
 *
 * attempt 0 -> base, 1 -> 2*base, 2 -> 4*base … capped at `cap`.
 * Jitter spreads retries so a fleet of instances does not stampede Dropbox in
 * lockstep after a rate limit.
 *
 * @param {number} attempt zero-based retry number
 * @param {{base?: number, cap?: number, jitter?: boolean, random?: () => number}} opts
 */
export function backoffDelay(attempt, { base = 500, cap = 16000, jitter = true, random = Math.random } = {}) {
  const exponential = Math.min(cap, base * 2 ** Math.max(0, attempt));
  if (!jitter) return exponential;
  // Full jitter: uniformly random in [base, exponential], never below `base`
  // so a retry storm cannot degenerate into a tight loop.
  const low = Math.min(base, exponential);
  return Math.round(low + random() * (exponential - low));
}

/**
 * Single-flight mutex.
 *
 * The token-refresh race in the spec: three requests find an expired token, but
 * only one may call Dropbox. The other two await the same promise and reuse its
 * result. This is the in-process half; the cross-instance half is the advisory
 * lock in the database (see lockRepository).
 */
export class Mutex {
  #chain = Promise.resolve();

  /** Runs `fn` with exclusive access; queued callers run in arrival order. */
  run(fn) {
    const result = this.#chain.then(fn, fn);
    // Swallow rejections on the chain itself so one failure does not poison the
    // queue — the caller still sees the rejection through `result`.
    this.#chain = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

/**
 * Coalesces concurrent calls into one in-flight operation.
 *
 * Unlike Mutex, followers do not run `fn` at all: they receive the leader's
 * result. That is exactly the token-refresh semantics — B and C must reuse A's
 * token, not mint two more.
 */
export class SingleFlight {
  #inflight = null;

  run(fn) {
    if (this.#inflight) return this.#inflight;
    this.#inflight = (async () => fn())().finally(() => {
      this.#inflight = null;
    });
    return this.#inflight;
  }

  get busy() {
    return this.#inflight !== null;
  }
}

/**
 * Runs `worker` over `items` with at most `limit` in flight.
 *
 * Never rejects: each result is reported as {status, value|reason, item} so one
 * bad file cannot abort a 10,000-file sync (spec §55/§56).
 */
export async function mapPool(items, limit, worker) {
  const list = [...items];
  const results = new Array(list.length);
  const width = Math.max(1, Math.min(limit, list.length));
  let cursor = 0;

  const runner = async () => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      try {
        results[index] = { status: 'fulfilled', value: await worker(list[index], index), item: list[index] };
      } catch (error) {
        results[index] = { status: 'rejected', reason: error, item: list[index] };
      }
    }
  };

  await Promise.all(Array.from({ length: width }, runner));
  return results;
}

/**
 * Rejects with a TimeoutError if `promise` has not settled in `ms`.
 * `onTimeout` lets the caller abort the underlying work (an AbortController).
 */
export function withTimeout(promise, ms, { message = 'Operation timed out.', onTimeout } = {}) {
  if (!ms || ms <= 0) return promise;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        onTimeout?.();
      } finally {
        const error = new Error(message);
        error.name = 'TimeoutError';
        error.code = 'ETIMEDOUT';
        reject(error);
      }
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}
