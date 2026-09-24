/**
 * The auth service over the Inspironics API — the same surface as the local
 * `createAuthService`, so pages, context and the Google button do not know
 * which backend they are talking to.
 *
 * The session itself is an httpOnly cookie the browser holds. What is kept in
 * localStorage is only a mirror — the user's name, role and expiry — so the
 * synchronous `getSession()` the context relies on still works and other tabs
 * hear about sign-in and sign-out. `refresh()` re-checks it against the server.
 */
import { storageKeys } from '#shared/config'
import { apiRequest } from '#shared/lib/apiClient.js'
import { UnverifiedAccountError } from './errors.js'

const read = (key, store = globalThis.localStorage) => {
  try {
    return JSON.parse(store?.getItem(key) || 'null')
  } catch {
    return null
  }
}
const write = (key, value, store = globalThis.localStorage) => {
  try {
    if (value === null) store?.removeItem(key)
    else store?.setItem(key, JSON.stringify(value))
  } catch {
    /* storage full or blocked: the cookie is still the session */
  }
}

/** @param {{ request?: typeof apiRequest }} [deps] */
export function createHttpAuthService({ request = apiRequest } = {}) {
  const keep = (session) => {
    write(storageKeys.apiSession, session)
    return session
  }
  const pending = (kind, email, minutes) => write(storageKeys.apiPending, { kind, email, expiresAt: Date.now() + minutes * 60_000 })
  const devCode = (email, code) => write(storageKeys.apiDevCode, code ? { email, code } : null)

  return {
    getSession: () => read(storageKeys.apiSession),

    /** Ask the server whether the cookie is still a live session; updates the mirror. */
    async refresh() {
      try {
        const { session } = await request('/api/auth/session')
        return keep(session || null)
      } catch (error) {
        // offline: keep the mirror so the offline library stays reachable
        if (error.status === 0) return read(storageKeys.apiSession)
        return keep(null)
      }
    },

    async register({ name, email, password }) {
      const r = await request('/api/auth/register', { method: 'POST', body: { name, email, password } })
      pending('verification', r.email, 10)
      devCode(r.email, r.devCode)
      return { email: r.email, devCode: r.devCode || '' }
    },

    getPendingVerification() {
      const p = read(storageKeys.apiPending)
      return p?.kind === 'verification' && p.expiresAt > Date.now() ? { email: p.email, expiresAt: p.expiresAt } : null
    },

    getDemoCode(email) {
      const d = read(storageKeys.apiDevCode)
      return d && (!email || d.email === String(email).trim().toLowerCase()) ? d.code : ''
    },

    async resendOtp(email) {
      const r = await request('/api/auth/resend', { method: 'POST', body: { email } })
      pending('verification', r.email, 10)
      devCode(r.email, r.devCode)
      return { email: r.email, devCode: r.devCode || '' }
    },

    async verifyOtp({ email, code }) {
      const { session } = await request('/api/auth/verify', { method: 'POST', body: { email, code } })
      write(storageKeys.apiPending, null)
      devCode(null, null)
      return keep(session)
    },

    async login({ email, password }) {
      try {
        const { session } = await request('/api/auth/login', { method: 'POST', body: { email, password } })
        return keep(session)
      } catch (error) {
        if (error.code === 'UNVERIFIED') {
          const addr = error.body?.email || email
          pending('verification', addr, 10)
          devCode(addr, error.body?.devCode)
          throw new UnverifiedAccountError(addr, error.body?.devCode || '')
        }
        throw error
      }
    },

    /** `profile.credential` is the Google ID token; without one, the server's demo identity (dev only). */
    async loginWithGoogle(profile) {
      const body = profile?.credential ? { credential: profile.credential } : { demo: true }
      const { session } = await request('/api/auth/google', { method: 'POST', body })
      return keep(session)
    },

    async guest() {
      const { session } = await request('/api/auth/guest', { method: 'POST', body: {} })
      return keep(session)
    },

    async requestPasswordReset(email) {
      const r = await request('/api/auth/forgot', { method: 'POST', body: { email } })
      pending('reset', r.email, 15)
      return { email: r.email, devToken: r.devToken || null }
    },

    getPendingReset() {
      const p = read(storageKeys.apiPending)
      return p?.kind === 'reset' && p.expiresAt > Date.now() ? { email: p.email, expiresAt: p.expiresAt } : null
    },

    async resetPassword({ email, token, password }) {
      const r = await request('/api/auth/reset', { method: 'POST', body: { email, token, password } })
      write(storageKeys.apiPending, null)
      return { email: r.email }
    },

    logout() {
      keep(null)
      request('/api/auth/logout', { method: 'POST', body: {} }).catch(() => {})
    },
  }
}
