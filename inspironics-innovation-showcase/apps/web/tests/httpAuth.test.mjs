/**
 * The API-backed auth service and the API client, against a fake fetch.
 * Same surface as the local service, so the pages cannot tell them apart.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { installBrowserStubs } from './helpers.mjs'

const stubs = installBrowserStubs()
const { ApiError, apiRequest, apiUrl } = await import('../src/shared/lib/apiClient.js')
const { createHttpAuthService } = await import('../src/features/auth/api/httpAuthService.js')

/** A scripted `request`: route -> handler(body) returning data or throwing ApiError. */
function fakeRequest(routes) {
  const calls = []
  const request = async (path, { method = 'GET', body } = {}) => {
    calls.push({ method, path, body })
    const handler = routes[`${method} ${path}`]
    if (!handler) throw new ApiError(404, `no route ${method} ${path}`)
    return handler(body)
  }
  return { request, calls }
}

const session = (email, role = 'viewer') => ({ user: { id: 'u1', email, name: 'U', role }, isGuest: false, issuedAt: 1, expiresAt: Date.now() + 3600_000 })

test('apiUrl keeps same-origin paths and joins absolute bases', () => {
  assert.equal(apiUrl('/api/x'), '/api/x')
  assert.equal(apiUrl('/api/x', 'https://api.example.com/'), 'https://api.example.com/api/x')
})

test('apiRequest sends credentials and surfaces the server message', async () => {
  let seen
  const fetchImpl = async (url, init) => {
    seen = init
    return new Response(JSON.stringify({ error: { code: 'SYNC_RUNNING', message: 'A synchronization is already running.' } }), { status: 409 })
  }
  await assert.rejects(apiRequest('/api/dropbox/sync', { method: 'POST', body: {}, fetchImpl }), (e) => e.status === 409 && e.code === 'SYNC_RUNNING' && /already running/.test(e.message))
  assert.equal(seen.credentials, 'include')
  await assert.rejects(
    apiRequest('/x', { fetchImpl: async () => Promise.reject(new TypeError('Failed to fetch')) }),
    (e) => e.status === 0 && e.code === 'OFFLINE'
  )
})

test('register -> verify keeps a session mirror; logout clears it', async () => {
  stubs.reset()
  const { request, calls } = fakeRequest({
    'POST /api/auth/register': (b) => ({ email: b.email, devCode: '123456' }),
    'POST /api/auth/verify': (b) => ({ session: session(b.email) }),
    'POST /api/auth/logout': () => ({ ok: true }),
  })
  const api = createHttpAuthService({ request })
  const r = await api.register({ name: 'N', email: 'n@x.io', password: 'abcdefg1' })
  assert.equal(r.devCode, '123456')
  assert.equal(api.getPendingVerification().email, 'n@x.io')
  assert.equal(api.getDemoCode('n@x.io'), '123456')

  const s = await api.verifyOtp({ email: 'n@x.io', code: '123456' })
  assert.equal(s.user.email, 'n@x.io')
  assert.equal(api.getSession().user.email, 'n@x.io', 'mirror written for the synchronous context read')
  assert.equal(api.getPendingVerification(), null)

  api.logout()
  assert.equal(api.getSession(), null)
  assert.equal(calls.at(-1).path, '/api/auth/logout')
})

test('an unverified login becomes the same UnverifiedAccountError the pages already handle', async () => {
  stubs.reset()
  const { request } = fakeRequest({
    'POST /api/auth/login': () => {
      throw new ApiError(403, 'This account is not verified yet.', 'UNVERIFIED', { email: 'u@x.io', devCode: '654321' })
    },
  })
  const api = createHttpAuthService({ request })
  await assert.rejects(api.login({ email: 'u@x.io', password: 'p' }), (e) => e.code === 'UNVERIFIED' && e.email === 'u@x.io' && e.devCode === '654321')
})

test('refresh() trusts the server, but keeps the mirror when offline', async () => {
  stubs.reset()
  let mode = 'live'
  const { request } = fakeRequest({
    'GET /api/auth/session': () => {
      if (mode === 'offline') throw new ApiError(0, 'offline', 'OFFLINE')
      return { session: mode === 'live' ? session('a@x.io', 'admin') : null }
    },
  })
  const api = createHttpAuthService({ request })
  assert.equal((await api.refresh()).user.role, 'admin')
  mode = 'offline'
  assert.equal((await api.refresh()).user.email, 'a@x.io', 'offline: the offline library stays reachable')
  mode = 'revoked'
  assert.equal(await api.refresh(), null)
  assert.equal(api.getSession(), null)
})

test('Google sign-in sends the ID token for server-side verification', async () => {
  stubs.reset()
  const { request, calls } = fakeRequest({ 'POST /api/auth/google': () => ({ session: session('g@x.io') }) })
  const api = createHttpAuthService({ request })
  await api.loginWithGoogle({ credential: 'id-token', email: 'ignored@x.io' })
  assert.deepEqual(calls[0].body, { credential: 'id-token' }, 'the client-decoded profile is never trusted')
  await api.loginWithGoogle({ email: 'demo@x.io' })
  assert.deepEqual(calls[1].body, { demo: true })
})
