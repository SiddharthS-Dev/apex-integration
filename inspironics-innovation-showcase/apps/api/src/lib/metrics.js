/**
 * In-process counters and latency histograms, served to admins at
 * GET /api/admin/metrics (JSON) and GET /api/admin/metrics?format=prometheus.
 *
 * Per-instance and reset on restart — enough to answer "is Dropbox slow, is
 * the sync failing, who is hitting the rate limit" without an agent.
 */
const BUCKETS_MS = [5, 25, 100, 250, 500, 1000, 2500, 5000, 10000, 30000]

const keyOf = (name, labels) => {
  const l = Object.entries(labels || {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${String(v).replace(/"/g, '')}"`)
    .join(',')
  return l ? `${name}{${l}}` : name
}

export function createMetrics() {
  const counters = new Map()
  const histograms = new Map()
  const startedAt = Date.now()

  return {
    inc(name, labels, by = 1) {
      const k = keyOf(name, labels)
      counters.set(k, (counters.get(k) || 0) + by)
    },
    observe(name, labels, ms) {
      const k = keyOf(name, labels)
      let h = histograms.get(k)
      if (!h) {
        h = { count: 0, sum: 0, buckets: BUCKETS_MS.map(() => 0) }
        histograms.set(k, h)
      }
      h.count++
      h.sum += ms
      BUCKETS_MS.forEach((b, i) => {
        if (ms <= b) h.buckets[i]++
      })
    },
    snapshot() {
      return {
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        counters: Object.fromEntries(counters),
        histograms: Object.fromEntries(
          [...histograms].map(([k, h]) => [k, { count: h.count, avgMs: Math.round(h.sum / h.count), le: Object.fromEntries(BUCKETS_MS.map((b, i) => [b, h.buckets[i]])) }])
        ),
      }
    },
    prometheus() {
      const lines = []
      for (const [k, v] of counters) lines.push(`${k} ${v}`)
      for (const [k, h] of histograms) {
        const [name, labels = ''] = k.split(/(?={)/)
        const inner = labels.slice(1, -1)
        BUCKETS_MS.forEach((b, i) => lines.push(`${name}_bucket{${inner ? inner + ',' : ''}le="${b}"} ${h.buckets[i]}`))
        lines.push(`${name}_count${labels} ${h.count}`, `${name}_sum${labels} ${h.sum}`)
      }
      return lines.join('\n') + '\n'
    },
  }
}

/** Request log line + latency metric, labelled by the matched route, not the raw URL. */
export function requestMetrics({ metrics, log }) {
  return (req, res, next) => {
    const start = process.hrtime.bigint()
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6
      const routeName = req.route ? `${req.baseUrl}${req.route.path}` : req.path.startsWith('/api/') ? 'unmatched' : 'static'
      metrics.inc('http_requests_total', { method: req.method, route: routeName, status: res.statusCode })
      metrics.observe('http_request_ms', { route: routeName }, ms)
      if (req.path.startsWith('/api/')) {
        const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'debug'
        log[level](`${req.method} ${req.originalUrl.split('?')[0]} ${res.statusCode} ${ms.toFixed(0)}ms`, {
          user: req.user?.id,
        })
      }
    })
    next()
  }
}
