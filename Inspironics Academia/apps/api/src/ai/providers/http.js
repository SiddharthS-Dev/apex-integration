import { HttpError } from '../../lib/errors.js';

// Shared HTTP helper for providers called over REST: JSON in/out, a timeout, and retries with
// exponential backoff (honouring Retry-After) for 429, 5xx and network failures.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const backoffMs = (attempt, retryAfter) => {
  const sec = Number(retryAfter);
  if (Number.isFinite(sec) && sec > 0) return Math.min(sec, 60) * 1000;
  return Math.min(1000 * 2 ** attempt, 20_000) + Math.floor(Math.random() * 250);
};

export async function postJson(url, body, { headers = {}, timeoutMs = 10 * 60_000, attempts = 3, label = 'AI provider', raw = false } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastErr = new HttpError(502, `${label} unreachable (${err.name === 'TimeoutError' ? 'timed out' : err.message})`, { retryable: true });
      if (attempt + 1 < attempts) { await sleep(backoffMs(attempt)); continue; }
      throw lastErr;
    }
    if (res.ok) return raw ? res : res.json();
    const text = await res.text().catch(() => '');
    let detail = text;
    try { const j = JSON.parse(text); detail = j.error?.message || j.error || j.message || text; } catch { /* plain text */ }
    detail = String(typeof detail === 'string' ? detail : JSON.stringify(detail)).slice(0, 700);
    // A per-day quota does not clear in seconds: no quick retries for it.
    const dailyQuota = res.status === 429 && /per\s*day|PerDay/i.test(detail);
    const retryable = !dailyQuota && (res.status === 429 || res.status >= 500);
    lastErr = new HttpError(res.status === 429 ? 429 : res.status === 401 || res.status === 403 ? 503 : 502,
      `${label} error (${res.status})${detail ? `: ${detail}` : ''}`, { retryable, upstreamStatus: res.status });
    if (retryable && attempt + 1 < attempts) { await sleep(backoffMs(attempt, res.headers.get('retry-after'))); continue; }
    throw lastErr;
  }
  throw lastErr;
}
