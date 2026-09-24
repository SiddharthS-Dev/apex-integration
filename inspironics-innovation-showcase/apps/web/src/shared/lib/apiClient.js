/**
 * The one way the client talks to the API.
 *
 * Every request goes to our own origin (see `env.apiBaseUrl`) with the session
 * cookie. The browser never talks to Dropbox: catalog records carry
 * same-origin paths, and file bytes are proxied by the API.
 */
import { env } from '#shared/config'

export class ApiError extends Error {
  /** @param {number} status @param {string} message @param {string} [code] @param {any} [body] */
  constructor(status, message, code, body) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code || 'ERROR'
    this.body = body
  }
}

/** Absolute-or-rooted URL for an API path such as '/api/entities/plates'. */
export function apiUrl(path, base = env.apiBaseUrl) {
  if (/^https?:\/\//i.test(path)) return path
  if (base === '/') return path
  return base.replace(/\/$/, '') + path
}

/**
 * JSON request. Resolves to the parsed body (null for 204); rejects with an
 * ApiError carrying the server's message, or status 0 when offline.
 *
 * @param {string} path
 * @param {{ method?: string, body?: any, signal?: AbortSignal, fetchImpl?: typeof fetch }} [opts]
 */
export async function apiRequest(path, { method = 'GET', body, signal, fetchImpl = globalThis.fetch } = {}) {
  let res
  try {
    res = await fetchImpl(apiUrl(path), {
      method,
      credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
  } catch (error) {
    if (error?.name === 'AbortError') throw error
    throw new ApiError(0, 'Cannot reach the server — check your connection.', 'OFFLINE')
  }
  // read the body even when it is empty: an unread 204 shows up in DevTools as a cancelled request
  const text = await res.text()
  if (res.status === 204) return null
  let data = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    /* non-JSON error page from a proxy */
  }
  if (!res.ok) {
    const message = data?.error?.message || `Request failed (${res.status}).`
    throw new ApiError(res.status, message, data?.error?.code, data)
  }
  return data
}
