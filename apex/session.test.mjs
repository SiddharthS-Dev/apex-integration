/**
 * Sign-out revocation and the Secure flag. Each case imports auth.mjs afresh
 * (a distinct module URL) after setting the environment it reads at load.
 *
 *   node --test apex/*.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-session-'))
process.env.APEX_REVOKED_FILE = path.join(tmp, 'revoked')

test('a signed-out token stops verifying, and stays revoked after a restart', async () => {
  const auth = await import('./auth.mjs?revoke-1')
  const token = auth.issueToken('Someone@Example.com')
  assert.equal(auth.verify(token), 'someone@example.com')

  const req = { headers: { cookie: `${auth.APEX_COOKIE}=${token}` } }
  const cleared = await auth.signOut(req)
  assert.ok(cleared.some((c) => c.startsWith(`${auth.APEX_COOKIE}=;`)))
  assert.equal(auth.verify(token), null, 'revoked in this process')

  const restarted = await import('./auth.mjs?revoke-2')
  assert.equal(restarted.verify(token), null, 'revoked after a restart')
  assert.equal(restarted.verify(restarted.issueToken('other@example.com')), 'other@example.com', 'others unaffected')
})

test('revokeToken ignores forged or empty tokens', async () => {
  const auth = await import('./auth.mjs?revoke-3')
  assert.equal(auth.revokeToken(undefined), false)
  assert.equal(auth.revokeToken('a.b.c.d'), false)
})

test('cookies are Secure only behind an https public URL', async () => {
  const before = process.env.APEX_PUBLIC_URL
  try {
    delete process.env.APEX_PUBLIC_URL
    const plain = await import('./auth.mjs?plain')
    assert.equal(plain.COOKIE_SECURE, false)
    assert.ok(!plain.clearCookie(plain.APEX_COOKIE).some((c) => /;\s*Secure/i.test(c)))

    process.env.APEX_PUBLIC_URL = 'https://apex.example.com'
    const secure = await import('./auth.mjs?secure')
    assert.equal(secure.COOKIE_SECURE, true)
    assert.ok(secure.clearCookie(secure.APEX_COOKIE).every((c) => /;\s*Secure/i.test(c)))
  } finally {
    if (before === undefined) delete process.env.APEX_PUBLIC_URL
    else process.env.APEX_PUBLIC_URL = before
  }
})

test('APEX_SESSION_SECRET_FILE moves the signing secret, and it survives a restart', async () => {
  const file = path.join(tmp, 'state', 'session-secret')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const before = process.env.APEX_SESSION_SECRET_FILE
  process.env.APEX_SESSION_SECRET_FILE = file
  try {
    const first = await import('./auth.mjs?secret-file-1')
    assert.ok(fs.readFileSync(file, 'utf8').trim().length >= 32, 'created at the configured path')
    const token = first.issueToken('someone@example.com')
    const restarted = await import('./auth.mjs?secret-file-2')
    assert.equal(restarted.verify(token), 'someone@example.com', 'same secret after a restart')
  } finally {
    if (before === undefined) delete process.env.APEX_SESSION_SECRET_FILE
    else process.env.APEX_SESSION_SECRET_FILE = before
  }
  const fallback = await import('./auth.mjs?secret-file-3')
  assert.equal(fallback.verify(fallback.issueToken('x@example.com')), 'x@example.com', 'unset: apex/.session-secret as before')
})
