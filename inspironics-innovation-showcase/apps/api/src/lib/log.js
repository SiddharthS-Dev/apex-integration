/**
 * Structured logging on stdout.
 *
 * JSON lines in production (one event per line, ready for any collector),
 * a compact readable form in development. Anything whose key looks like a
 * credential is redacted before it is written — the Dropbox access token in
 * particular must never reach a log, and this is the backstop if a call site
 * forgets.
 */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 99 }
const SECRET_KEY = /token|secret|password|authorization|cookie|api[-_]?key|refresh|encryption/i

export function redact(value, depth = 0) {
  if (depth > 6 || value === null || typeof value !== 'object') return value
  if (value instanceof Error) return { name: value.name, message: value.message, code: value.code, stack: value.stack }
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1))
  const out = {}
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)
  return out
}

export function createLogger({ level = 'info', json = false, base = {}, write = (s) => process.stdout.write(s) } = {}) {
  const min = LEVELS[level] ?? LEVELS.info

  const emit = (lvl, msg, fields) => {
    if (LEVELS[lvl] < min) return
    const event = { time: new Date().toISOString(), level: lvl, msg, ...redact({ ...base, ...fields }) }
    if (json) return write(JSON.stringify(event) + '\n')
    const extra = Object.keys(event).length > 3 ? ' ' + JSON.stringify({ ...event, time: undefined, level: undefined, msg: undefined }) : ''
    write(`${event.time.slice(11, 19)} ${lvl.toUpperCase().padEnd(5)} ${msg}${extra}\n`)
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    child: (fields) => createLogger({ level, json, base: { ...base, ...fields }, write }),
  }
}

/** A logger that swallows everything — for tests. */
export const silentLogger = createLogger({ level: 'silent' })
