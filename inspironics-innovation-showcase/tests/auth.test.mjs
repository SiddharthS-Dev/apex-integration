import { strict as assert } from 'node:assert'
import test from 'node:test'
import { installBrowserStubs } from './helpers.mjs'

const stubs = installBrowserStubs()
const { api, passwordIssues, EMAIL_RE } = await import('../src/features/auth/api/authService.js')
const { decodeJwt } = await import('../src/features/auth/components/GoogleButton.jsx')
const { newSalt } = await import('../src/features/auth/model/credentials.js')

const PW = 'correct-horse1'
const fresh = () => stubs.reset()

test('password policy wants length, a letter and a digit', () => {
  assert.deepEqual(passwordIssues('abcdefg1'), [])
  assert.ok(passwordIssues('short1').includes('at least 8 characters'))
  assert.ok(passwordIssues('12345678').includes('a letter'))
  assert.ok(passwordIssues('abcdefgh').includes('a number'))
})

test('jwt decode handles standard base64url payloads without deprecated helpers', () => {
  const payload = { email: 'ada@example.com', name: 'Ada Lovelace', picture: 'https://example.com/pic.png' }
  const json = JSON.stringify(payload)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(json).toString('base64url')
  const token = `${header}.${body}.signature`

  assert.deepEqual(decodeJwt(token), payload)
  assert.throws(() => decodeJwt('not-a-jwt'), /Invalid JWT/)
})

test('newSalt falls back cleanly when WebCrypto is unavailable', () => {
  const original = globalThis.crypto
  Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true, writable: true })

  try {
    const salt = newSalt(8)
    assert.equal(salt.length, 16)
    assert.match(salt, /^[0-9a-f]+$/)
  } finally {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true, writable: true })
  }
})

test('email regex rejects the obvious shapes', () => {
  assert.ok(EMAIL_RE.test('a@b.co'))
  assert.ok(!EMAIL_RE.test('a@b'))
  assert.ok(!EMAIL_RE.test('a b@c.com'))
  assert.ok(!EMAIL_RE.test('@b.com'))
})

test('registration stretches the password and never stores it', async () => {
  fresh()
  await api.register({ name: 'Ada', email: 'Ada@Example.com', password: PW })

  const stored = JSON.parse(localStorage.getItem('inspironics.auth.users.v1'))['ada@example.com']
  assert.equal(stored.kdf, 'pbkdf2-sha256')
  assert.equal(stored.iterations, 210000)
  assert.equal(stored.salt.length, 32)
  assert.equal(stored.pw.length, 64)
  assert.ok(!JSON.stringify(stored).includes(PW), 'the password itself must not be in the record')
})

test('two accounts with the same password get different hashes', async () => {
  fresh()
  await api.register({ name: 'A', email: 'a@example.com', password: PW })
  await api.register({ name: 'B', email: 'b@example.com', password: PW })
  const all = JSON.parse(localStorage.getItem('inspironics.auth.users.v1'))
  assert.notEqual(all['a@example.com'].salt, all['b@example.com'].salt)
  assert.notEqual(all['a@example.com'].pw, all['b@example.com'].pw)
})

test('the stored verification record holds no usable code', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  const rec = JSON.parse(localStorage.getItem('inspironics.auth.pending.v1'))
  assert.ok(!('code' in rec), 'no plaintext code in the trusted record')
  assert.ok(rec.hash && rec.salt)
  assert.notEqual(rec.hash, devCode)
  assert.equal(api.getPendingVerification().code, undefined)
})

test('verification accepts the right code and consumes the token', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  const session = await api.verifyOtp({ email: 'ada@example.com', code: devCode })
  assert.equal(session.user.email, 'ada@example.com')
  assert.equal(localStorage.getItem('inspironics.auth.pending.v1'), null)
  assert.equal(api.getDemoCode('ada@example.com'), '')
})

test('verification is attempt-limited and burns the token', async () => {
  fresh()
  await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })

  const messages = []
  for (let i = 0; i < 5; i++) {
    await assert.rejects(
      () => api.verifyOtp({ email: 'ada@example.com', code: '000000' }),
      (e) => {
        messages.push(e.message)
        return true
      }
    )
  }
  assert.match(messages[0], /4 attempts left/)
  assert.match(messages[3], /1 attempt left/)
  assert.match(messages[4], /Too many incorrect attempts/)
  assert.equal(localStorage.getItem('inspironics.auth.pending.v1'), null, 'token burned')
})

test('login rejects a wrong password and accepts the right one', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  await api.verifyOtp({ email: 'ada@example.com', code: devCode })

  await assert.rejects(() => api.login({ email: 'ada@example.com', password: 'wrong-one1' }), /incorrect/)
  const session = await api.login({ email: 'ada@example.com', password: PW })
  assert.equal(session.user.email, 'ada@example.com')
  assert.ok(session.expiresAt > Date.now())
})

test('a legacy digest account is upgraded on first correct sign-in', async () => {
  fresh()
  // exactly what an earlier build wrote: no kdf, no salt, 64-bit digest
  const legacyDigest = (s) => {
    let h1 = 0xdeadbeef
    let h2 = 0x41c6ce57
    for (let i = 0; i < s.length; i++) {
      const ch = s.charCodeAt(i)
      h1 = Math.imul(h1 ^ ch, 2654435761)
      h2 = Math.imul(h2 ^ ch, 1597334677)
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
  }
  localStorage.setItem(
    'inspironics.auth.users.v1',
    JSON.stringify({
      'old@example.com': {
        id: 'old@example.com',
        email: 'old@example.com',
        name: 'Old',
        pw: legacyDigest(PW),
        verified: true,
        role: 'owner',
      },
    })
  )

  await assert.rejects(() => api.login({ email: 'old@example.com', password: 'nope1234' }), /incorrect/)
  await api.login({ email: 'old@example.com', password: PW })

  const upgraded = JSON.parse(localStorage.getItem('inspironics.auth.users.v1'))['old@example.com']
  assert.equal(upgraded.kdf, 'pbkdf2-sha256')
  assert.equal(upgraded.pw.length, 64)
  // and the upgraded record still authenticates
  assert.ok(await api.login({ email: 'old@example.com', password: PW }))
})

test('reset does not reveal whether an account exists', async () => {
  fresh()
  const unknown = await api.requestPasswordReset('nobody@example.com')
  assert.equal(unknown.devToken, null)
  assert.equal(localStorage.getItem('inspironics.auth.reset.v1'), null)
})

test('reset changes the password and invalidates the old one', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  await api.verifyOtp({ email: 'ada@example.com', code: devCode })

  const { devToken } = await api.requestPasswordReset('ada@example.com')
  await api.resetPassword({ email: 'ada@example.com', token: devToken, password: 'brand-new9' })

  await assert.rejects(() => api.login({ email: 'ada@example.com', password: PW }), /incorrect/)
  assert.ok(await api.login({ email: 'ada@example.com', password: 'brand-new9' }))
  assert.equal(localStorage.getItem('inspironics.auth.reset.v1'), null)
})

test('reset rejects a weak new password', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  await api.verifyOtp({ email: 'ada@example.com', code: devCode })
  const { devToken } = await api.requestPasswordReset('ada@example.com')
  await assert.rejects(
    () => api.resetPassword({ email: 'ada@example.com', token: devToken, password: 'short' }),
    /Password needs/
  )
})

test('a token whose account vanished gives a friendly error, not a TypeError', async () => {
  fresh()
  const { devCode } = await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  localStorage.removeItem('inspironics.auth.users.v1')
  await assert.rejects(
    () => api.verifyOtp({ email: 'ada@example.com', code: devCode }),
    (e) => e.constructor === Error && /no longer exists/.test(e.message)
  )
  assert.equal(localStorage.getItem('inspironics.auth.pending.v1'), null, 'dead token cleared')
})

test('an unverified login re-issues a code instead of signing in', async () => {
  fresh()
  await api.register({ name: 'Ada', email: 'ada@example.com', password: PW })
  await assert.rejects(
    () => api.login({ email: 'ada@example.com', password: PW }),
    (e) => e.code === 'UNVERIFIED' && e.email === 'ada@example.com' && /^\d{6}$/.test(e.devCode)
  )
})

test('guest sessions are short-lived and flagged', async () => {
  fresh()
  const s = await api.guest()
  assert.equal(s.isGuest, true)
  assert.equal(s.user.role, 'guest')
  const hours = (s.expiresAt - s.issuedAt) / 3600000
  assert.ok(hours > 11 && hours < 13, `expected ~12h, got ${hours}`)
})

test('logout clears the session', async () => {
  fresh()
  await api.guest()
  assert.ok(api.getSession())
  api.logout()
  assert.equal(api.getSession(), null)
})
