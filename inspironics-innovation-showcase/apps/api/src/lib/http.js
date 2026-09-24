/**
 * HTTP error type and the request-validation helpers the routes use.
 *
 * Validation is a handful of functions rather than a schema library: each
 * route states what it accepts in a few lines, and anything else is a 400 with
 * a message a person can act on.
 */
export class HttpError extends Error {
  /** @param {number} status @param {string} message @param {string} [code] */
  constructor(status, message, code) {
    super(message)
    this.status = status
    this.code = code || STATUS_CODES[status] || 'ERROR'
  }
}

const STATUS_CODES = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  413: 'TOO_LARGE',
  429: 'RATE_LIMITED',
  502: 'UPSTREAM',
  503: 'UNAVAILABLE',
}

export const badRequest = (msg) => new HttpError(400, msg)
export const notFound = (msg = 'Not found.') => new HttpError(404, msg)

/** Wrap an async handler so a rejection reaches the error middleware. */
export const route = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next)

/** Read a required, trimmed, length-limited string field. */
export function field(body, name, { max = 500, optional = false } = {}) {
  const v = body?.[name]
  if (v === undefined || v === null || v === '') {
    if (optional) return ''
    throw badRequest(`${name} is required.`)
  }
  if (typeof v !== 'string') throw badRequest(`${name} must be a string.`)
  const s = v.trim()
  if (s.length > max) throw badRequest(`${name} is too long.`)
  if (!s && !optional) throw badRequest(`${name} is required.`)
  return s
}

export function intParam(value, fallback, { min = 0, max = 10_000 } = {}) {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
