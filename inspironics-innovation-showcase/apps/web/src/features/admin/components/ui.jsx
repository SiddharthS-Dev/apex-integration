/** Small presentational pieces the admin console shares. */

/** @param {{ title?: string, right?: any, children?: any, className?: string }} props */
export function Card({ title = '', right = null, children, className = '' }) {
  return (
    <section className={`glass rounded-2xl p-5 sm:p-6 ${className}`}>
      {(title || right) && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && <h2 className="text-base font-semibold text-chalk">{title}</h2>}
          {right}
        </div>
      )}
      {children}
    </section>
  )
}

/** @param {{ label: string, value: any, hint?: string }} props */
export function Stat({ label, value, hint = '' }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-4">
      <p className="label-mono">{label}</p>
      <p className="mt-2 text-2xl font-black tracking-tight text-chalk">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

const TONES = {
  success: 'border-emerald-400/40 text-emerald-300',
  partial: 'border-amber-400/40 text-amber-300',
  failed: 'border-rose-400/40 text-rose-300',
  running: 'border-cyan-glow/50 text-cyan-glow',
  ok: 'border-emerald-400/40 text-emerald-300',
  reauth_required: 'border-rose-400/40 text-rose-300',
  disconnected: 'border-white/15 text-muted',
}

export function Badge({ tone, children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TONES[tone] || TONES.disconnected}`}>
      {children}
    </span>
  )
}

/** Horizontal bars — enough charting for a count-by-category panel, with no chart library. */
export function Bars({ rows, max = 10, empty = 'No data yet.' }) {
  const top = rows.slice(0, max)
  const peak = Math.max(1, ...top.map((r) => r.count))
  if (!top.length) return <p className="text-sm text-muted">{empty}</p>
  return (
    <ul className="space-y-2">
      {top.map((r) => (
        <li key={r.name} className="grid grid-cols-[minmax(0,10rem)_1fr_3rem] items-center gap-3 text-xs">
          <span className="truncate text-muted" title={r.name}>
            {r.name}
          </span>
          <span className="h-2 overflow-hidden rounded-full bg-white/5">
            <span className="block h-full rounded-full bg-cyan-glow/70" style={{ width: `${(r.count / peak) * 100}%` }} />
          </span>
          <span className="text-right font-mono text-chalk">{r.count}</span>
        </li>
      ))}
    </ul>
  )
}

/** Daily columns for the last N days. `series` maps day -> count. */
export function DayColumns({ days, series, label }) {
  const today = new Date()
  const cols = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - (days - 1 - i)))
    const key = d.toISOString().slice(0, 10)
    return { key, count: series[key] || 0 }
  })
  const peak = Math.max(1, ...cols.map((c) => c.count))
  return (
    <div>
      <div className="flex h-24 items-end gap-[3px]" role="img" aria-label={label}>
        {cols.map((c) => (
          <span
            key={c.key}
            title={`${c.key}: ${c.count}`}
            className="flex-1 rounded-t bg-cyan-glow/60"
            style={{ height: `${Math.max(c.count ? 6 : 2, (c.count / peak) * 100)}%`, opacity: c.count ? 1 : 0.25 }}
          />
        ))}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>{cols[0].key.slice(5)}</span>
        <span>{cols.at(-1).key.slice(5)}</span>
      </div>
    </div>
  )
}

export const formatDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '—')

export const formatDuration = (ms) => {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms} ms`
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}

export const formatBytes = (n) => {
  if (!n) return '0 B'
  const u = ['B', 'KB', 'MB', 'GB']
  const i = Math.min(u.length - 1, Math.floor(Math.log(n) / Math.log(1024)))
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`
}
