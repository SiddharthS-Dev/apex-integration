/**
 * Account-holder ownership proof at the gateway (R1 linking addendum): /link and
 * /auth/link/*, end to end against a fake Core and fake application APIs.
 *
 * The fake Core speaks the Core's exact shapes (every refusal is { error, reason }):
 *   POST /api/core/link-challenges { sub, app, core_password }
 *     -> 201 { id, challenge_id, nonce, app, expires_at } | 400 invalid_request | 401 wrong_core_password
 *        | 403 user_inactive | 429 rate_limited (Retry-After)
 *   POST /api/core/identity-links/possession { sub, challenge_id, nonce, app, app_user_id }
 *     -> 200 { linked, app, app_user_id, link_id, evidence, result } | 404 unknown_challenge | 403 wrong_user|wrong_app|wrong_nonce
 *        | 409 replayed|app_account_linked_elsewhere|core_user_linked_elsewhere|conflict | 410 expired
 *   a failed service check -> 401 { error: 'Service authentication required' }
 * The fake apps speak the link-proof shape (200 { proof } | 401 | 422 ...).
 *   App   POST /api/apex/link-proof { email, password, challenge_id } -> 200 { proof } | 401 | ...
 *
 *   node --test apex/link.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-link-'))
process.env.APEX_REVOKED_FILE = path.join(tmp, 'revoked')
process.env.APEX_IDENTITY_KEYS_FILE = path.join(tmp, 'identity-keys.json')
for (const k of ['APEX_IDENTITY_MODE', 'APEX_IDENTITY_MODE_SHOWCASE', 'APEX_IDENTITY_MODE_SLIDESVAULT', 'APEX_GOOGLE_CLIENT_ID', 'APEX_TRUST_PROXY']) delete process.env[k]

const { PROJECTS } = await import('./projects.mjs')
const auth = await import('./auth.mjs')
const { issueLinkProof, parseKeys, verifyAssertion, verifyLinkProof } = await import('./identity.mjs')
const { keysFor, loadKeys, signingKey } = await import('./identity-keys.mjs')

const project = (id) => PROJECTS.find((p) => p.id === id)
const store = loadKeys()

/* ---------------------------------------------------------- console -- */

const logged = []
for (const level of ['log', 'warn', 'error', 'info', 'debug']) {
  const original = console[level].bind(console)
  console[level] = (...args) => {
    logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, Object.getOwnPropertyNames(a || {})))).join(' '))
    original(...args)
  }
}

/* ------------------------------------------------------------- fakes -- */

const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))

const readBody = (req) =>
  new Promise((resolve) => {
    let text = ''
    req.on('data', (c) => (text += c))
    req.on('end', () => resolve(text ? JSON.parse(text) : {}))
  })

const send = (res, status, json, headers = {}) => {
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
  res.end(JSON.stringify(json))
}

const CORE_PASSWORD = 'Core-Secret-Pa55!'
const APP_PASSWORD = 'App-Secret-Pa55!'

async function fakeCore() {
  const state = { challenges: new Map(), possession: [], starts: [], possessionAnswer: null, startAnswer: null, seq: 0, serviceOk: [] }
  const users = new Map([
    ['core-1', { active: true, user: { id: 'core-1', email: 'one@x.io', full_name: 'User One' }, roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }], links: { showcase: null, slidesvault: null } }],
    ['core-2', { active: true, user: { id: 'core-2', email: 'two@x.io', full_name: 'User Two' }, roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }], links: { showcase: null, slidesvault: null } }],
  ])
  state.users = users
  const coreKeys = parseKeys(keysFor(store, 'core'))
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req)
    const check = verifyAssertion(req.headers['x-apex-service'], { keys: coreKeys, audience: 'core', requireSubject: false })
    state.serviceOk.push(check.ok)
    if (!check.ok) return send(res, 401, { error: 'Service authentication required' })
    if (req.url === '/api/core/identity/resolve') {
      state.resolveCalls = (state.resolveCalls || 0) + 1
      return send(res, 200, users.get(body.sub) || { active: false })
    }
    if (req.url === '/api/core/link-challenges') {
      state.starts.push(body)
      if (state.startAnswer) return send(res, state.startAnswer.status, state.startAnswer.body, state.startAnswer.headers)
      if (body.core_password !== CORE_PASSWORD) return send(res, 401, { error: 'Wrong password', reason: 'wrong_core_password' })
      const id = `ch-${++state.seq}`
      const nonce = crypto.randomBytes(32).toString('base64url')
      state.challenges.set(id, { sub: body.sub, app: body.app, nonce })
      return send(res, 201, { id, challenge_id: id, nonce, app: body.app, expires_at: new Date(Date.now() + 300_000).toISOString() })
    }
    if (req.url === '/api/core/identity-links/possession') {
      state.possession.push(body)
      if (state.possessionAnswer) return send(res, state.possessionAnswer.status, state.possessionAnswer.body)
      const ch = state.challenges.get(body.challenge_id)
      if (!ch) return send(res, 404, { error: 'Unknown challenge', reason: 'unknown_challenge' })
      if (ch.used) return send(res, 409, { error: 'Challenge already used', reason: 'replayed' })
      if (ch.sub !== body.sub) return send(res, 403, { error: 'Wrong user', reason: 'wrong_user' })
      ch.used = true
      if (ch.app !== body.app) return send(res, 403, { error: 'Wrong app', reason: 'wrong_app' })
      if (ch.nonce !== body.nonce) return send(res, 403, { error: 'Wrong nonce', reason: 'wrong_nonce' })
      users.get(body.sub).links[body.app] = body.app_user_id
      return send(res, 200, { linked: true, app: body.app, app_user_id: body.app_user_id, link_id: 'l-1', evidence: 'possession', result: 'created' })
    }
    send(res, 404, { error: 'not here' })
  })
  return { state, server, port: await listen(server) }
}

/**
 * An application's link-proof endpoint. `behaviour` decides what proof comes back:
 * good | wrong-challenge | other-key | expired | wrong-iss | 401 | 422.
 */
async function fakeApp(audience, appUserId) {
  const state = { calls: [], behaviour: 'good', serviceOk: [] }
  const appKeys = parseKeys(keysFor(store, audience))
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req)
    if (req.url !== '/api/apex/link-proof') return send(res, 200, { ok: true })
    state.calls.push({ body, headers: req.headers })
    state.serviceOk.push(verifyAssertion(req.headers['x-apex-service'], { keys: appKeys, audience, requireSubject: false }).ok)
    const b = state.behaviour
    if (b === '401') return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Email or password is incorrect.' } })
    if (b === '422') return send(res, 422, { error: { code: 'NO_PASSWORD', message: 'This account signs in with Google only.' } })
    if (body.password !== APP_PASSWORD) return send(res, 401, { error: 'no' })
    const own = signingKey(store, audience)
    const other = signingKey(store, audience === 'showcase' ? 'slidesvault' : 'showcase')
    const proof =
      b === 'wrong-challenge'
        ? issueLinkProof({ app: audience, ...own, appUserId, challengeId: 'ch-999' })
        : b === 'other-key'
          ? issueLinkProof({ app: audience, ...other, appUserId, challengeId: body.challenge_id })
          : b === 'expired'
            ? issueLinkProof({ app: audience, ...own, appUserId, challengeId: body.challenge_id, now: Date.now() - 120_000 })
            : b === 'wrong-iss'
              ? issueLinkProof({ app: audience === 'showcase' ? 'slidesvault' : 'showcase', ...own, appUserId, challengeId: body.challenge_id })
              : issueLinkProof({ app: audience, ...own, appUserId, challengeId: body.challenge_id })
    send(res, 200, { proof })
  })
  return { state, server, port: await listen(server) }
}

const core = await fakeCore()
const apps = { showcase: await fakeApp('showcase', 'sc-user-7'), slidesvault: await fakeApp('slidesvault', 'sv-user-3') }
project('academia').api.port = core.port
project('showcase').api.port = apps.showcase.port
project('vault').api.port = apps.slidesvault.port

test.after(() => {
  for (const s of [core.server, apps.showcase.server, apps.slidesvault.server]) s.close()
})

/* ----------------------------------------------------------- gateway -- */

async function gateway(tag, env = { APEX_IDENTITY_MODE: 'required' }) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  const mod = await import(`./server.mjs?link-${tag}`)
  for (const k of Object.keys(env)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  const port = await listen(mod.server)
  const base = `http://127.0.0.1:${port}`
  const cookie = (sub, email = 'one@x.io') => `${auth.APEX_COOKIE}=${auth.issueToken(email, ['showcase', 'vault', 'academia'], 1, sub)}`
  const post = async (p, body, { sub = 'core-1', headers = {} } = {}) => {
    const res = await fetch(base + p, {
      method: 'POST',
      redirect: 'manual',
      headers: { Origin: base, 'Content-Type': 'application/json', ...(sub !== null ? { Cookie: cookie(sub) } : {}), ...headers },
      body: JSON.stringify(body),
    })
    return { status: res.status, body: await res.json().catch(() => null), headers: res.headers }
  }
  const get = (p, { sub = 'core-1', headers = {} } = {}) =>
    fetch(base + p, { redirect: 'manual', headers: { ...(sub !== null ? { Cookie: cookie(sub) } : {}), ...headers } })
  return { base, post, get, close: () => new Promise((r) => mod.server.close(r)) }
}

const start = (gw, app = 'showcase', opts) => gw.post('/auth/link/start', { app, core_password: CORE_PASSWORD }, opts)
const complete = (gw, ch, app = 'showcase', opts, extra = {}) =>
  gw.post('/auth/link/complete', { app, challenge_id: ch.challenge_id, nonce: ch.nonce, app_email: 'Legacy@X.io', app_password: APP_PASSWORD, ...extra }, opts)

/* ------------------------------------------------------------- tests -- */

test('full flow: Core password, app password, verified proof, confirmed link, cache cleared', async () => {
  const gw = await gateway('flow')
  try {
    // The state the page shows before linking (this also fills the resolve cache).
    const before = await (await gw.get('/auth/link/state')).json()
    assert.equal(before.core, true)
    assert.equal(before.enabled, true)
    assert.equal(before.user.email, 'one@x.io')
    assert.deepEqual(before.apps.map((a) => [a.app, a.linked, a.available]), [['showcase', false, true], ['slidesvault', false, true]])

    const s = await start(gw)
    assert.equal(s.status, 201)
    assert.match(s.body.challenge_id, /^ch-\d+$/)
    assert.ok(s.body.nonce && s.body.expires_at)
    assert.deepEqual(core.state.starts.at(-1), { sub: 'core-1', app: 'showcase', core_password: CORE_PASSWORD })

    const c = await complete(gw, s.body)
    assert.equal(c.status, 200, JSON.stringify(c.body))
    assert.deepEqual(c.body, { linked: true, app: 'showcase', app_user_id: 'sc-user-7', result: 'created' })

    // The application was asked on its own port, with the app's service credential and the browser's address.
    const call = apps.showcase.state.calls.at(-1)
    assert.deepEqual(call.body, { email: 'legacy@x.io', password: APP_PASSWORD, challenge_id: s.body.challenge_id })
    assert.equal(apps.showcase.state.serviceOk.at(-1), true)
    assert.ok(call.headers['x-forwarded-for'])
    assert.deepEqual(core.state.possession.at(-1), { sub: 'core-1', challenge_id: s.body.challenge_id, nonce: s.body.nonce, app: 'showcase', app_user_id: 'sc-user-7' })
    assert.ok(core.state.serviceOk.every(Boolean))

    // The resolve cache was cleared: the new link shows at once.
    const after = await (await gw.get('/auth/link/state')).json()
    assert.equal(after.apps.find((a) => a.app === 'showcase').linked, true)
    assert.equal(after.apps.find((a) => a.app === 'showcase').app_user_id, 'sc-user-7')

    // Replaying the same challenge is refused by the Core, and the refusal is passed on.
    const replay = await complete(gw, s.body)
    assert.equal(replay.status, 409)
    assert.equal(replay.body.reason, 'replayed')
    assert.match(replay.body.error, /already used/)
  } finally {
    core.state.users.get('core-1').links.showcase = null
    await gw.close()
  }
})

test('start without a Core user in the session is 401; signed out is 401; cross-origin and non-JSON are refused', async () => {
  const gw = await gateway('guards')
  try {
    const noSub = await gw.post('/auth/link/start', { app: 'showcase', core_password: CORE_PASSWORD }, { sub: '' })
    assert.equal(noSub.status, 401)
    assert.equal(noSub.body.code, 'APEX_CORE_SIGNIN_REQUIRED')
    assert.equal((await gw.post('/auth/link/start', { app: 'showcase', core_password: CORE_PASSWORD }, { sub: null })).status, 401)

    const evil = await gw.post('/auth/link/start', { app: 'showcase', core_password: CORE_PASSWORD }, { headers: { Origin: 'https://evil.example' } })
    assert.equal(evil.status, 403)
    const noOrigin = await gw.post('/auth/link/complete', {}, { headers: { Origin: '' } })
    assert.equal(noOrigin.status, 403, 'neither Origin nor Referer: refused')

    const form = await fetch(`${gw.base}/auth/link/start`, {
      method: 'POST',
      headers: { Origin: gw.base, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: `${auth.APEX_COOKIE}=${auth.issueToken('one@x.io', ['showcase'], 1, 'core-1')}` },
      body: 'app=showcase&core_password=x',
    })
    assert.equal(form.status, 415)
    assert.equal((await gw.get('/auth/link/start')).status, 405)
    assert.equal(core.state.starts.filter((b) => b.sub === '').length, 0, 'the Core was never asked without a sub')

    // The page itself: signed-in only, with a hash-only script policy.
    const page = await gw.get('/link')
    assert.equal(page.status, 200)
    const csp = page.headers.get('content-security-policy')
    const html = fs.readFileSync(new URL('./public/link.html', import.meta.url), 'utf8')
    for (const m of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
      assert.ok(csp.includes(`'sha256-${crypto.createHash('sha256').update(m[1]).digest('base64')}'`))
    }
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp))
    assert.match(csp, /frame-ancestors 'none'/)
    const out = await gw.get('/link', { sub: null, headers: { Accept: 'text/html' } })
    assert.equal(out.status, 302)
    assert.match(out.headers.get('location'), /^\/login\?next=%2Flink/)

    // An application's gateway-only route is never reachable through the proxy.
    const hits = apps.showcase.state.calls.length
    for (const p of ['/showcase/api/apex/link-proof', '/showcase/api/%61pex/link-proof', '/vault/api/APEX/link-proof']) {
      const r = await gw.post(p, { email: 'a@x.io', password: 'x', challenge_id: 'ch-1' })
      assert.equal(r.status, 404, p)
    }
    assert.equal(apps.showcase.state.calls.length, hits)
  } finally {
    await gw.close()
  }
})

test('a proof for another challenge, signed with the other app key, naming another app or expired is refused; the Core is never asked', async () => {
  const gw = await gateway('bad-proofs')
  try {
    for (const behaviour of ['wrong-challenge', 'other-key', 'wrong-iss', 'expired']) {
      apps.showcase.state.behaviour = behaviour
      const s = await start(gw)
      assert.equal(s.status, 201)
      const before = core.state.possession.length
      const c = await complete(gw, s.body)
      assert.equal(c.status, 502, behaviour)
      assert.equal(c.body.code, 'LINK_PROOF_INVALID', behaviour)
      assert.equal(core.state.possession.length, before, `${behaviour}: Core possession never called`)
    }
  } finally {
    apps.showcase.state.behaviour = 'good'
    await gw.close()
  }
})

test('wrong passwords and Core refusals come back as clear errors', async () => {
  const gw = await gateway('errors')
  try {
    const wrongCore = await gw.post('/auth/link/start', { app: 'showcase', core_password: 'nope' })
    assert.equal(wrongCore.status, 401)
    assert.equal(wrongCore.body.reason, 'wrong_core_password')
    assert.equal(wrongCore.body.error, 'That is not your Apex password.')

    core.state.startAnswer = { status: 429, body: { error: 'Too many failed password attempts for this account. Try again in 15 minutes.', reason: 'rate_limited' }, headers: { 'Retry-After': '900' } }
    const locked = await start(gw, 'slidesvault')
    assert.equal(locked.status, 429)
    assert.equal(locked.body.reason, 'rate_limited')
    assert.match(locked.body.error, /15 minutes/)
    assert.equal(locked.headers.get('retry-after'), '900')
    core.state.startAnswer = { status: 403, body: { error: 'User inactive', reason: 'user_inactive', active: false } }
    const inactive = await start(gw, 'slidesvault')
    assert.deepEqual([inactive.status, inactive.body.reason, inactive.body.active], [403, 'user_inactive', false])
    core.state.startAnswer = null

    const s = await start(gw, 'slidesvault')
    apps.slidesvault.state.behaviour = '401'
    const wrongApp = await complete(gw, s.body, 'slidesvault')
    assert.equal(wrongApp.status, 401)
    assert.equal(wrongApp.body.code, 'LINK_APP_PASSWORD')
    apps.slidesvault.state.behaviour = '422'
    const google = await complete(gw, s.body, 'slidesvault')
    assert.equal(google.status, 422)
    assert.match(google.body.error, /Google/)
    apps.slidesvault.state.behaviour = 'good'

    core.state.possessionAnswer = { status: 409, body: { error: 'conflict', reason: 'app_account_linked_elsewhere' } }
    const elsewhere = await complete(gw, s.body, 'slidesvault')
    assert.deepEqual([elsewhere.status, elsewhere.body.reason], [409, 'app_account_linked_elsewhere'])
    assert.match(elsewhere.body.error, /SlidesVault account is already linked to another Apex account/)
    core.state.possessionAnswer = { status: 409, body: { error: 'conflict', reason: 'core_user_linked_elsewhere' } }
    const mine = await complete(gw, s.body, 'slidesvault')
    assert.deepEqual([mine.status, mine.body.reason], [409, 'core_user_linked_elsewhere'])
    assert.match(mine.body.error, /already linked a different SlidesVault account/)
    core.state.possessionAnswer = { status: 410, body: { error: 'expired', reason: 'expired' } }
    const expired = await complete(gw, s.body, 'slidesvault')
    assert.deepEqual([expired.status, expired.body.reason], [410, 'expired'])
    assert.match(expired.body.error, /expired\. Start again/)
    core.state.possessionAnswer = { status: 404, body: { error: 'Unknown challenge', reason: 'unknown_challenge' } }
    assert.equal((await complete(gw, s.body, 'slidesvault')).status, 404)
    core.state.possessionAnswer = { status: 401, body: { error: 'Service authentication required' } }
    const service = await complete(gw, s.body, 'slidesvault')
    assert.deepEqual([service.status, service.body.reason], [502, 'link_core_service'], 'a refused gateway credential is not blamed on the person')

    assert.equal((await gw.post('/auth/link/start', { app: 'academia', core_password: CORE_PASSWORD })).status, 400)
  } finally {
    core.state.startAnswer = null
    core.state.possessionAnswer = null
    apps.slidesvault.state.behaviour = 'good'
    await gw.close()
  }
})

test('identity off: linking answers 503 and the Core is never asked', async () => {
  const gw = await gateway('off', {})
  try {
    const before = core.state.starts.length
    const r = await start(gw)
    assert.equal(r.status, 503)
    assert.equal(r.body.code, 'LINK_UNAVAILABLE')
    assert.equal(core.state.starts.length, before)
    const state = await (await gw.get('/auth/link/state')).json()
    assert.equal(state.enabled, false)
  } finally {
    await gw.close()
  }
  // One application off, the other required: only the one that asserts identity can be linked.
  const mixed = await gateway('mixed', { APEX_IDENTITY_MODE_SLIDESVAULT: 'required' })
  try {
    assert.equal((await start(mixed, 'showcase')).status, 503)
    assert.equal((await start(mixed, 'slidesvault')).status, 201)
  } finally {
    await mixed.close()
  }
})

test('rate limits: 5 starts and 10 completes per 15 minutes per address; per Core user across addresses', async () => {
  const gw = await gateway('limits')
  try {
    for (let i = 0; i < 5; i++) assert.equal((await gw.post('/auth/link/start', { app: 'showcase', core_password: 'wrong' })).status, 401)
    const sixth = await start(gw)
    assert.equal(sixth.status, 429)
    assert.ok(Number(sixth.headers.get('retry-after')) > 0)
    assert.equal((await start(gw, 'showcase', { sub: 'core-2' })).status, 429, 'the address is limited for every user')

    const before = apps.showcase.state.calls.length
    const ch = { challenge_id: 'ch-1', nonce: 'x'.repeat(43) }
    for (let i = 0; i < 10; i++) await complete(gw, ch, 'showcase', undefined, { app_password: 'wrong' })
    assert.equal((await complete(gw, ch)).status, 429)
    assert.equal(apps.showcase.state.calls.length - before, 10, 'the eleventh never reached the app')
  } finally {
    await gw.close()
  }

  const proxied = await gateway('limits-sub', { APEX_IDENTITY_MODE: 'required', APEX_TRUST_PROXY: '1' })
  try {
    for (let i = 0; i < 5; i++) {
      const r = await proxied.post('/auth/link/start', { app: 'showcase', core_password: 'wrong' }, { headers: { 'X-Forwarded-For': `203.0.113.${i + 1}` } })
      assert.equal(r.status, 401)
    }
    const sameUser = await proxied.post('/auth/link/start', { app: 'showcase', core_password: CORE_PASSWORD }, { headers: { 'X-Forwarded-For': '203.0.113.99' } })
    assert.equal(sameUser.status, 429, 'per Core user, from any address')
    const otherUser = await proxied.post('/auth/link/start', { app: 'showcase', core_password: CORE_PASSWORD }, { sub: 'core-2', headers: { 'X-Forwarded-For': '203.0.113.99' } })
    assert.equal(otherUser.status, 201)
  } finally {
    await proxied.close()
  }
})

test('admin console page: signed-in only, strict CSP covering its inline scripts, GET only', async () => {
  const gw = await gateway('admin', { APEX_IDENTITY_MODE: 'off' })
  try {
    const out = await gw.get('/admin', { sub: null, headers: { Accept: 'text/html' } })
    assert.ok([302, 303].includes(out.status), 'signed out: sent to the sign-in page')
    assert.match(out.headers.get('location') || '', /^\/login\?next=/)
    const page = await gw.get('/admin')
    assert.equal(page.status, 200)
    const csp = page.headers.get('content-security-policy') || ''
    assert.match(csp, /script-src 'self' 'sha256-/)
    assert.match(csp, /frame-ancestors 'none'/)
    assert.doesNotMatch(csp, /unsafe-eval|script-src[^;]*unsafe-inline/)
    const html = await page.text()
    const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${crypto.createHash('sha256').update(m[1].replace(/\r\n?/g, '\n'), 'utf8').digest('base64')}'`)
    assert.ok(hashes.length >= 2 && hashes.every((h) => csp.includes(h)), 'every inline script is allowed by hash')
    assert.doesNotMatch(html, /\son[a-z]+="/i, 'no inline event handlers (they would be blocked)')
    assert.equal((await gw.get('/admin.html')).headers.get('location'), '/admin')
    assert.equal((await gw.post('/admin', {})).status, 405)
  } finally {
    await gw.close()
  }
})

test('the proof helpers: bound to the app, the challenge and 60 s', () => {
  const own = signingKey(store, 'showcase')
  const keys = parseKeys(keysFor(store, 'showcase'))
  const proof = issueLinkProof({ app: 'showcase', ...own, appUserId: 'u1', challengeId: 'ch-1' })
  const v = verifyLinkProof(proof, { keys, app: 'showcase', challengeId: 'ch-1' })
  assert.equal(v.ok, true)
  assert.equal(v.claims.exp - v.claims.iat, 60)
  assert.equal(v.claims.aud, 'apex-link')
  assert.equal(verifyLinkProof(proof, { keys, app: 'showcase', challengeId: 'ch-2' }).reason, 'challenge')
  assert.equal(verifyLinkProof(proof, { keys, app: 'slidesvault', challengeId: 'ch-1' }).reason, 'issuer')
  assert.equal(verifyLinkProof(proof, { keys, app: 'showcase', challengeId: 'ch-1', now: Date.now() + 61_000 }).reason, 'expired')
  assert.equal(verifyLinkProof(proof, { keys: parseKeys(keysFor(store, 'slidesvault')), app: 'showcase', challengeId: 'ch-1' }).ok, false)
  // A proof is never an identity assertion, nor the reverse.
  assert.equal(verifyAssertion(proof, { keys, audience: 'showcase' }).ok, false)
})

test('passwords never appear in anything the gateway logged', () => {
  const all = logged.join('\n')
  for (const secret of [CORE_PASSWORD, APP_PASSWORD]) assert.ok(!all.includes(secret), 'a password was logged')
  assert.ok(logged.some((l) => l.includes('link: proof from showcase refused')), 'refusals are logged (without secrets)')
})
