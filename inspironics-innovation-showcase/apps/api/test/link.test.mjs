/**
 * POST /api/apex/link-proof (R1 linking addendum): the account-holder ownership
 * check the Apex gateway asks for when someone links this app's account to their
 * Apex account. Gateway only, the legacy password check with its limiter and
 * lockout, no session, a short proof bound to the challenge and the account.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { issueAssertion, verifyLinkProof, parseKeys } from '../src/lib/apexIdentity.js'
import { hashPassword } from '../src/lib/crypto.js'
import { createHarness } from './fakes.mjs'

const KEY = crypto.randomBytes(32)
const OLD = crypto.randomBytes(32)
const KEYS = JSON.stringify({ kold: OLD.toString('base64'), knew: KEY.toString('base64') })
const PASSWORD = 'Legacy-Pa55word'

const service = ({ audience = 'showcase', key = KEY, kid = 'knew' } = {}) => issueAssertion({ audience, kid, key, claims: { purpose: 'link-proof' } })

async function withApp(env, fn) {
  const h = await createHarness({ env: { APEX_IDENTITY_KEYS: KEYS, ...env } })
  try {
    await fn(h)
  } finally {
    await h.close()
  }
}

async function user(h, email, fields = {}) {
  const { repos } = h.services
  const row = await repos.users.create({ email, name: email, passwordHash: await hashPassword(PASSWORD), verified: true, ...fields })
  return row
}

/** As the gateway calls it: no Origin, no cookie, the service credential. */
const ask = (h, body, headers = { 'X-Apex-Service': service() }) => h.client().post('/api/apex/link-proof', body, { Origin: undefined, ...headers })

const sessionCount = async (h) => Number((await h.services.repos.db.get('SELECT COUNT(*) AS n FROM sessions')).n)

test('required mode: a proof for the right password, bound to the challenge and the account, 60 s, no session', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'required' }, async (h) => {
    const u = await user(h, 'owner@x.io')
    const before = await sessionCount(h)
    const res = await ask(h, { email: 'Owner@X.io', password: PASSWORD, challenge_id: 'ch-123' })
    assert.equal(res.status, 200)
    assert.equal(res.headers.get('set-cookie'), null, 'no cookie')
    assert.equal(await sessionCount(h), before, 'no session')
    const { proof } = await res.json()
    assert.equal(proof.split('.')[0], 'knew', 'signed with the current (last listed) kid')
    const v = verifyLinkProof(proof, { keys: parseKeys(KEYS), app: 'showcase', challengeId: 'ch-123' })
    assert.equal(v.ok, true)
    assert.equal(v.claims.app_user_id, u.id)
    assert.equal(v.claims.aud, 'apex-link')
    assert.equal(v.claims.exp - v.claims.iat, 60)
    assert.equal(verifyLinkProof(proof, { keys: parseKeys(KEYS), app: 'showcase', challengeId: 'ch-124' }).ok, false)
    // The account row is untouched (no last-login stamp, no rehash).
    assert.deepEqual(await h.services.repos.users.findById(u.id), u)
    // A proof is no identity assertion.
    assert.equal((await h.client().get('/api/auth/me', { 'X-Apex-Identity': proof })).status, 401)
    // The legacy sign-in itself stays closed in required mode.
    assert.equal((await h.client().post('/api/auth/login', { email: 'owner@x.io', password: PASSWORD })).status, 403)
  })
})

test('APEX_IDENTITY_KID picks the signing key', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional', APEX_IDENTITY_KID: 'kold' }, async (h) => {
    await user(h, 'kid@x.io')
    const { proof } = await (await ask(h, { email: 'kid@x.io', password: PASSWORD, challenge_id: 'c1' })).json()
    assert.equal(proof.split('.')[0], 'kold')
  })
})

test('wrong password is 401 and counts toward the same lockout as the sign-in', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional', LOGIN_MAX_FAILURES: '3' }, async (h) => {
    await user(h, 'lock@x.io')
    for (let i = 0; i < 3; i++) assert.equal((await ask(h, { email: 'lock@x.io', password: 'wrong-1', challenge_id: 'c1' })).status, 401)
    const locked = await ask(h, { email: 'lock@x.io', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(locked.status, 429, 'locked even with the right password')
    assert.ok(Number(locked.headers.get('retry-after')) > 0)
    const login = await h.client().post('/api/auth/login', { email: 'lock@x.io', password: PASSWORD })
    assert.equal(login.status, 429, 'the legacy sign-in shares the lockout')
    // Unknown emails answer like a wrong password.
    assert.equal((await ask(h, { email: 'nobody@x.io', password: PASSWORD, challenge_id: 'c1' })).status, 401)
  })
})

test('only the gateway: untrusted source, missing or forged service credential are 403; no keys is 503', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'required', APEX_IDENTITY_TRUSTED_SOURCES: '10.0.0.0/8' }, async (h) => {
    await user(h, 'a@x.io')
    const r = await ask(h, { email: 'a@x.io', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(r.status, 403)
    assert.equal((await r.json()).error.code, 'APEX_GATEWAY_ONLY')
  })
  await withApp({ APEX_IDENTITY_MODE: 'off' }, async (h) => {
    await user(h, 'a@x.io')
    const body = { email: 'a@x.io', password: PASSWORD, challenge_id: 'c1' }
    assert.equal((await ask(h, body, {})).status, 403, 'no credential')
    assert.equal((await ask(h, body, { 'X-Apex-Service': service({ key: crypto.randomBytes(32) }) })).status, 403, 'wrong key')
    assert.equal((await ask(h, body, { 'X-Apex-Service': service({ audience: 'slidesvault' }) })).status, 403, 'other audience')
    assert.equal((await ask(h, body)).status, 200, 'mode off works too when keys are configured')
  })
  const h = await createHarness({ env: { APEX_IDENTITY_KEYS: '' } })
  try {
    await user(h, 'a@x.io')
    const r = await ask(h, { email: 'a@x.io', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(r.status, 503)
  } finally {
    await h.close()
  }
})

test('guest, disabled, unverified and Google-only accounts are refused clearly', async () => {
  await withApp({ APEX_IDENTITY_MODE: 'optional' }, async (h) => {
    const { repos } = h.services
    await repos.users.guest()
    const guest = await ask(h, { email: 'guest@local', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(guest.status, 403)

    const d = await user(h, 'disabled@x.io')
    await repos.users.update(d.id, { disabled: 1 })
    const disabled = await ask(h, { email: 'disabled@x.io', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(disabled.status, 403)
    assert.equal((await disabled.json()).error.code, 'APEX_LINK_DISABLED')

    await user(h, 'new@x.io', { verified: false })
    assert.equal((await ask(h, { email: 'new@x.io', password: PASSWORD, challenge_id: 'c1' })).status, 403)

    await repos.users.create({ email: 'g@x.io', name: 'G', provider: 'google', verified: true })
    const google = await ask(h, { email: 'g@x.io', password: PASSWORD, challenge_id: 'c1' })
    assert.equal(google.status, 422)
    assert.match((await google.json()).error.message, /Google/)

    assert.equal((await ask(h, { email: 'g@x.io', password: PASSWORD, challenge_id: 'bad id!' })).status, 400)
  })
})
