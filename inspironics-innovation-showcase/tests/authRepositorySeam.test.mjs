/**
 * The point of the repository seam is that the auth flows do not care where
 * state lives. This runs the whole service against an in-memory repository
 * that touches no browser API at all — no localStorage stub, nothing.
 *
 * If this file ever needs a DOM to pass, the seam has leaked.
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'

const { createAuthService } = await import('../src/features/auth/api/authService.js')

/** @returns {import('../src/features/auth/api/authRepository.js').AuthRepository} */
function createMemoryRepository() {
  const state = { users: {}, session: null, tokens: {}, demo: null }
  const calls = []
  const track = (name, fn) => (...args) => {
    calls.push(name)
    return fn(...args)
  }
  return {
    calls,
    state,
    readUsers: track('readUsers', () => state.users),
    writeUsers: track('writeUsers', (u) => void (state.users = u)),
    readSession: track('readSession', () => state.session),
    writeSession: track('writeSession', (s) => void (state.session = s)),
    clearSession: track('clearSession', () => void (state.session = null)),
    readToken: track('readToken', (k) => state.tokens[k] ?? null),
    writeToken: track('writeToken', (k, r) => void (state.tokens[k] = r)),
    clearToken: track('clearToken', (k) => {
      delete state.tokens[k]
      state.demo = null
    }),
    writeDemoCode: track('writeDemoCode', (email, code) => void (state.demo = { email, code })),
    readDemoCode: track('readDemoCode', (email) =>
      state.demo && (!email || state.demo.email === email) ? state.demo.code : ''
    ),
    clearDemoCode: track('clearDemoCode', () => void (state.demo = null)),
    // an HTTP repository would await a real request here
    latency: track('latency', () => Promise.resolve()),
  }
}

test('the full register → verify → login → reset flow runs on a memory repository', async () => {
  const repo = createMemoryRepository()
  const auth = createAuthService(repo)

  const { devCode } = await auth.register({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse1' })
  assert.match(devCode, /^\d{6}$/)
  assert.equal(repo.state.users['ada@example.com'].verified, false)

  const session = await auth.verifyOtp({ email: 'ada@example.com', code: devCode })
  assert.equal(session.user.email, 'ada@example.com')
  assert.equal(repo.state.session.user.email, 'ada@example.com')
  assert.equal(repo.state.tokens.verification, undefined, 'token consumed')

  await assert.rejects(() => auth.login({ email: 'ada@example.com', password: 'nope1234' }), /incorrect/)
  assert.ok(await auth.login({ email: 'ada@example.com', password: 'correct-horse1' }))

  const { devToken } = await auth.requestPasswordReset('ada@example.com')
  await auth.resetPassword({ email: 'ada@example.com', token: devToken, password: 'brand-new9' })
  assert.ok(await auth.login({ email: 'ada@example.com', password: 'brand-new9' }))

  auth.logout()
  assert.equal(repo.state.session, null)
})

test('the service only ever reaches storage through the repository contract', async () => {
  const repo = createMemoryRepository()
  const auth = createAuthService(repo)
  await auth.register({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse1' })

  // every call the service made must be a method the contract declares
  const contract = new Set([
    'readUsers',
    'writeUsers',
    'readSession',
    'writeSession',
    'clearSession',
    'readToken',
    'writeToken',
    'clearToken',
    'writeDemoCode',
    'readDemoCode',
    'clearDemoCode',
    'latency',
  ])
  const unexpected = repo.calls.filter((c) => !contract.has(c))
  assert.deepEqual(unexpected, [])
  assert.ok(repo.calls.includes('writeUsers'))
  assert.ok(repo.calls.includes('writeToken'))
})

test('two services on separate repositories do not share accounts', async () => {
  const a = createAuthService(createMemoryRepository())
  const b = createAuthService(createMemoryRepository())

  const { devCode } = await a.register({ name: 'Ada', email: 'ada@example.com', password: 'correct-horse1' })
  await a.verifyOtp({ email: 'ada@example.com', code: devCode })

  assert.ok(await a.login({ email: 'ada@example.com', password: 'correct-horse1' }))
  await assert.rejects(() => b.login({ email: 'ada@example.com', password: 'correct-horse1' }), /incorrect/)
})

test('a guest session is short-lived and never written to the user table', async () => {
  const repo = createMemoryRepository()
  const auth = createAuthService(repo)
  const session = await auth.guest()
  assert.equal(session.isGuest, true)
  assert.deepEqual(repo.state.users, {})
  const hours = (session.expiresAt - session.issuedAt) / 3600000
  assert.ok(hours > 11 && hours < 13, `expected ~12h, got ${hours}`)
})
