// Runs `fn(item, index)` over `items` with at most `limit` in flight. Never rejects: resolves to an
// array of { ok: true, value } | { ok: false, error } in input order.
export async function mapPool(items, limit, fn) {
  const results = new Array(items.length);
  const width = Math.max(1, Math.min(Number(limit) || 1, items.length));
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      try {
        results[i] = { ok: true, value: await fn(items[i], i) };
      } catch (error) {
        results[i] = { ok: false, error };
      }
    }
  }
  await Promise.all(Array.from({ length: width }, worker));
  return results;
}
