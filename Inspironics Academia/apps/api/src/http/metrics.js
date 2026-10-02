// In-process request/function metrics exposed at GET /api/metrics (admin).
const started = Date.now();
const routes = new Map();
const functions = new Map();

function bump(map, key, ms, ok) {
  const m = map.get(key) || { count: 0, errors: 0, totalMs: 0, maxMs: 0 };
  m.count += 1;
  if (!ok) m.errors += 1;
  m.totalMs += ms;
  m.maxMs = Math.max(m.maxMs, ms);
  map.set(key, m);
}

const summarize = (map) => Object.fromEntries([...map].map(([k, m]) => [k, { ...m, avgMs: Math.round(m.totalMs / m.count) }]));

export const metrics = {
  recordRequest(key, ms, status) { bump(routes, key, ms, status < 500); },
  recordFunction(name, ms, ok) { bump(functions, name, ms, ok); },
  snapshot() {
    return {
      uptime_s: Math.round((Date.now() - started) / 1000),
      memory_mb: Math.round(process.memoryUsage().rss / 1048576),
      routes: summarize(routes),
      functions: summarize(functions),
    };
  },
};
