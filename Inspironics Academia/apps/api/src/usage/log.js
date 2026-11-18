import crypto from 'node:crypto';
import { db } from '../db/index.js';
import { log } from '../lib/logger.js';
import { currentGeneration } from './context.js';

// The generation log: one row per AI call, voice-over or render (including cache hits and failures).
// It is the only source for the usage dashboard, the history and the budget checks.

// process = document processing (extraction): 'ok' when done, 'reused' when an unchanged revision was
// not processed again.
const KINDS = new Set(['ai', 'tts', 'render', 'process']);

export async function recordGeneration(entry) {
  if (!KINDS.has(entry.kind)) throw new Error(`Unknown generation kind ${entry.kind}`);
  const ctx = currentGeneration();
  const row = {
    id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    kind: entry.kind,
    operation: entry.operation || ctx.operation || null,
    provider: entry.provider || null,
    model: entry.model || null,
    status: entry.status || 'ok',
    input_tokens: Math.round(entry.input_tokens || 0),
    output_tokens: Math.round(entry.output_tokens || 0),
    characters: Math.round(entry.characters || 0),
    seconds: +(entry.seconds || 0),
    cost_usd: entry.cost_usd ?? null,
    duration_ms: Math.round(entry.duration_ms || 0),
    error: entry.error ? String(entry.error).slice(0, 500) : null,
    ref_type: entry.ref_type || ctx.refType || null,
    ref_id: entry.ref_id || ctx.refId || null,
    user_id: entry.user_id || ctx.userId || null,
    output_ref: entry.output_ref || null,
  };
  try {
    const cols = Object.keys(row);
    await db().run(`INSERT INTO generation_log (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`, cols.map((c) => row[c]));
  } catch (err) {
    // Usage logging must never break a generation that already happened (and was paid for).
    log.error('usage.log_failed', { error: err.message });
  }
  return row;
}

const monthStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
const dayStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();
export { monthStart, dayStart };

/** Totals since `since` for paid work (cache hits are free and excluded from spend). */
export async function totalsSince(since) {
  const rows = await db().query(
    `SELECT kind, status, count(*) AS n, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
            sum(characters) AS characters, sum(seconds) AS seconds, sum(cost_usd) AS cost, sum(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unpriced
       FROM generation_log WHERE created_at >= ? GROUP BY kind, status`,
    [since],
  );
  const out = { ai: blank(), tts: blank(), render: blank(), process: blank() };
  for (const r of rows) {
    const t = out[r.kind];
    if (!t) continue;
    const n = Number(r.n) || 0;
    if (r.status === 'cached' || r.status === 'reused') { t.cached += n; continue; }
    if (r.status === 'error' || r.status === 'blocked' || r.status === 'cancelled') { t.failed += n; continue; }
    t.requests += n;
    t.input_tokens += Number(r.input_tokens) || 0;
    t.output_tokens += Number(r.output_tokens) || 0;
    t.characters += Number(r.characters) || 0;
    t.seconds += Number(r.seconds) || 0;
    t.cost_usd += Number(r.cost) || 0;
    t.unpriced += Number(r.unpriced) || 0;
  }
  for (const t of Object.values(out)) t.cost_usd = +t.cost_usd.toFixed(4);
  return out;
}
function blank() {
  return { requests: 0, cached: 0, failed: 0, input_tokens: 0, output_tokens: 0, characters: 0, seconds: 0, cost_usd: 0, unpriced: 0 };
}

export async function byProviderSince(since) {
  return db().query(
    `SELECT kind, provider, count(*) AS n, sum(input_tokens) AS input_tokens, sum(output_tokens) AS output_tokens,
            sum(characters) AS characters, sum(seconds) AS seconds, sum(cost_usd) AS cost_usd
       FROM generation_log WHERE created_at >= ? AND status = 'ok' GROUP BY kind, provider ORDER BY kind, n DESC`,
    [since],
  );
}

export async function recentGenerations({ limit = 100, kind, offset = 0 } = {}) {
  const lim = Math.min(Math.max(Number(limit) || 100, 1), 500);
  const where = kind && KINDS.has(kind) ? 'WHERE kind = ?' : '';
  return db().query(
    `SELECT * FROM generation_log ${where} ORDER BY created_at DESC LIMIT ${lim} OFFSET ${Math.max(0, Number(offset) || 0)}`,
    where ? [kind] : [],
  );
}
