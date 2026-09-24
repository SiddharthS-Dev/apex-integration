/**
 * Metrics registry — Prometheus text exposition, no dependency.
 *
 * Counters and histograms only; that covers everything the spec asks for
 * (request counts, error counts, refresh counts, sync outcomes, latencies) and
 * keeps the whole thing small enough to read in one sitting.
 */

const DEFAULT_BUCKETS = [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60, 300];

const serializeLabels = (labels) => {
  const keys = Object.keys(labels).sort();
  if (!keys.length) return '';
  return keys.map((key) => `${key}="${String(labels[key]).replace(/["\\\n]/g, '_')}"`).join(',');
};

export class Metrics {
  #counters = new Map(); // name -> { help, values: Map<labelKey, {labels, value}> }
  #gauges = new Map();
  #histograms = new Map();

  counter(name, help = '') {
    if (!this.#counters.has(name)) this.#counters.set(name, { help, values: new Map() });
    return this.#counters.get(name);
  }

  /** Increments a counter. Labels are the dimensions (outcome, reason, …). */
  increment(name, labels = {}, value = 1, help = '') {
    const metric = this.counter(name, help);
    const key = serializeLabels(labels);
    const current = metric.values.get(key) ?? { labels, value: 0 };
    current.value += value;
    metric.values.set(key, current);
    return current.value;
  }

  /** Sets a gauge (a value that can go down: queue depth, last duration). */
  gauge(name, value, labels = {}, help = '') {
    if (!this.#gauges.has(name)) this.#gauges.set(name, { help, values: new Map() });
    const metric = this.#gauges.get(name);
    metric.values.set(serializeLabels(labels), { labels, value });
  }

  /** Records a duration in seconds. */
  observe(name, seconds, labels = {}, help = '') {
    if (!this.#histograms.has(name)) {
      this.#histograms.set(name, { help, buckets: DEFAULT_BUCKETS, values: new Map() });
    }
    const metric = this.#histograms.get(name);
    const key = serializeLabels(labels);
    const entry = metric.values.get(key) ?? {
      labels,
      counts: new Array(DEFAULT_BUCKETS.length).fill(0),
      sum: 0,
      count: 0,
    };
    for (let i = 0; i < DEFAULT_BUCKETS.length; i += 1) {
      if (seconds <= DEFAULT_BUCKETS[i]) entry.counts[i] += 1;
    }
    entry.sum += seconds;
    entry.count += 1;
    metric.values.set(key, entry);
  }

  /** Times an async function and records the result under `name`. */
  async time(name, labels, fn) {
    const start = process.hrtime.bigint();
    try {
      const result = await fn();
      this.observe(name, Number(process.hrtime.bigint() - start) / 1e9, { ...labels, outcome: 'success' });
      return result;
    } catch (error) {
      this.observe(name, Number(process.hrtime.bigint() - start) / 1e9, { ...labels, outcome: 'error' });
      throw error;
    }
  }

  /** Prometheus text format. */
  render() {
    const lines = [];

    const emitSimple = (store, type) => {
      for (const [name, metric] of store) {
        if (metric.help) lines.push(`# HELP ${name} ${metric.help}`);
        lines.push(`# TYPE ${name} ${type}`);
        if (!metric.values.size) lines.push(`${name} 0`);
        for (const { labels, value } of metric.values.values()) {
          const labelText = serializeLabels(labels);
          lines.push(`${name}${labelText ? `{${labelText}}` : ''} ${value}`);
        }
      }
    };

    emitSimple(this.#counters, 'counter');
    emitSimple(this.#gauges, 'gauge');

    for (const [name, metric] of this.#histograms) {
      if (metric.help) lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} histogram`);
      for (const entry of metric.values.values()) {
        const base = serializeLabels(entry.labels);
        metric.buckets.forEach((bucket, index) => {
          const labelText = [base, `le="${bucket}"`].filter(Boolean).join(',');
          lines.push(`${name}_bucket{${labelText}} ${entry.counts[index]}`);
        });
        const infLabels = [base, 'le="+Inf"'].filter(Boolean).join(',');
        lines.push(`${name}_bucket{${infLabels}} ${entry.count}`);
        lines.push(`${name}_sum${base ? `{${base}}` : ''} ${entry.sum}`);
        lines.push(`${name}_count${base ? `{${base}}` : ''} ${entry.count}`);
      }
    }

    return `${lines.join('\n')}\n`;
  }

  /** A JSON view, for the admin UI (which should not parse Prometheus text). */
  snapshot() {
    const out = { counters: {}, gauges: {}, histograms: {} };
    for (const [name, metric] of this.#counters) {
      out.counters[name] = [...metric.values.values()].map(({ labels, value }) => ({ labels, value }));
    }
    for (const [name, metric] of this.#gauges) {
      out.gauges[name] = [...metric.values.values()].map(({ labels, value }) => ({ labels, value }));
    }
    for (const [name, metric] of this.#histograms) {
      out.histograms[name] = [...metric.values.values()].map(({ labels, sum, count }) => ({
        labels,
        sum,
        count,
        averageSeconds: count ? sum / count : 0,
      }));
    }
    return out;
  }

  reset() {
    this.#counters.clear();
    this.#gauges.clear();
    this.#histograms.clear();
  }
}

/** The metric names the rest of the server uses, in one place. */
export const M = {
  apiRequests: 'dropbox_api_requests_total',
  apiErrors: 'dropbox_api_errors_total',
  apiRetries: 'dropbox_api_retries_total',
  authRefresh: 'dropbox_auth_refresh_total',
  syncTotal: 'dropbox_sync_total',
  syncFailures: 'dropbox_sync_failures_total',
  filesProcessed: 'dropbox_files_processed_total',
  filesSkipped: 'dropbox_files_skipped_total',
  filesArchived: 'dropbox_files_archived_total',
  filesFailed: 'dropbox_files_failed_total',
  titleResolution: 'dropbox_title_resolution_total',
  thumbnails: 'dropbox_thumbnail_generation_total',
  previews: 'dropbox_preview_generation_total',
  renames: 'dropbox_file_rename_total',
  apiLatency: 'dropbox_api_latency_seconds',
  oauthLatency: 'dropbox_oauth_latency_seconds',
  syncDuration: 'dropbox_sync_duration_seconds',
  fileProcessing: 'dropbox_file_processing_seconds',
  titleLatency: 'dropbox_title_resolution_seconds',
  httpRequests: 'http_requests_total',
  httpLatency: 'http_request_duration_seconds',
};

export const metrics = new Metrics();
