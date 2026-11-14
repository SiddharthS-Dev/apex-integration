/**
 * The gateway end to end, against fake app servers and a fake Core.
 *
 * The real server.mjs is imported (it only listens when run directly) once per
 * identity mode, each import a fresh module URL so it reads the environment
 * afresh. The registry's API ports are pointed at the fakes before that.
 *
 *   node --test apex/*.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'apex-gateway-'))
process.env.APEX_REVOKED_FILE = path.join(tmp, 'revoked')
process.env.APEX_IDENTITY_KEYS_FILE = path.join(tmp, 'identity-keys.json')
for (const k of ['APEX_IDENTITY_MODE', 'APEX_IDENTITY_MODE_SHOWCASE', 'APEX_IDENTITY_MODE_SLIDESVAULT', 'APEX_GOOGLE_CLIENT_ID']) delete process.env[k]

const { PROJECTS } = await import('./projects.mjs')
const auth = await import('./auth.mjs')
const { parseKeys, verifyAssertion } = await import('./identity.mjs')
const { keysFor, loadKeys } = await import('./identity-keys.mjs')

const project = (id) => PROJECTS.find((p) => p.id === id)

/* ------------------------------------------------------------- fakes -- */

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server.address().port)))
}

/** An app API that records every request it is sent. */
async function fakeApp() {
  const seen = []
  const server = http.createServer((req, res) => {
    seen.push({ path: req.url, headers: req.headers })
    req.resume()
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"ok":true}')
    })
  })
  const port = await listen(server)
  return { seen, port, server, last: () => seen[seen.length - 1] }
}

/** The Core: resolve (checking the gateway's service assertion) and Google sign-in. */
/** verifyToken() without its expiry, which every test would otherwise have to compute. */
const tokenView = (token) => {
  const v = auth.verifyToken(token)
  if (!v) return v
  const { expiresAt, ...rest } = v
  assert.ok(Number.isFinite(expiresAt) && expiresAt > Date.now(), 'expiresAt is the token expiry')
  return rest
}

async function fakeCore() {
  const state = { users: new Map(), resolveCalls: 0, serviceOk: [], googleCalls: 0 }
  const server = http.createServer((req, res) => {
    let text = ''
    req.on('data', (c) => (text += c))
    req.on('end', () => {
      const body = text ? JSON.parse(text) : {}
      const send = (status, json, headers = {}) => {
        res.writeHead(status, { 'Content-Type': 'application/json', ...headers })
        res.end(JSON.stringify(json))
      }
      if (req.url === '/api/core/identity/resolve') {
        state.resolveCalls += 1
        const keys = parseKeys(keysFor(loadKeys(), 'core'))
        const check = verifyAssertion(req.headers['x-apex-service'], { keys, audience: 'core', requireSubject: false })
        state.serviceOk.push(check.ok)
        if (!check.ok) return send(401, { error: 'service assertion refused' })
        const user = state.users.get(body.sub)
        return send(200, user || { active: false })
      }
      if (req.url === '/api/core/auth/google') {
        state.googleCalls += 1
        if (body.credential !== 'good-google-token') return send(401, { error: 'no' })
        return send(200, { user: { id: 'core-g', email: 'g@x.io' } }, { 'Set-Cookie': 'iea_session=core-sess; Path=/; HttpOnly' })
      }
      send(404, { error: 'not here' })
    })
  })
  const port = await listen(server)
  return { state, port, server }
}

const apps = { showcase: await fakeApp(), vault: await fakeApp() }
const core = await fakeCore()
const academia = await fakeApp() // non-identity Academia traffic is not routed to the Core fake
project('showcase').api.port = apps.showcase.port
project('vault').api.port = apps.vault.port
project('academia').api.port = core.port

core.state.users.set('core-1', {
  active: true,
  user: { id: 'core-1', email: 'one@x.io', full_name: 'User One' },
  roles: [{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }],
  links: { showcase: 'local-7', slidesvault: null },
})

/** A port nobody listens on: the Core, down. */
async function deadPort() {
  const s = http.createServer()
  const port = await listen(s)
  await new Promise((r) => s.close(r))
  return port
}

/* ----------------------------------------------------------- gateway -- */

async function gateway(tag, env = {}) {
  const saved = {}
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k]
    process.env[k] = v
  }
  const mod = await import(`./server.mjs?${tag}`)
  for (const k of Object.keys(env)) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
  const port = await listen(mod.server)
  const base = `http://127.0.0.1:${port}`
  const call = (p, { method = 'GET', headers = {}, body } = {}) =>
    fetch(base + p, { method, headers, body, redirect: 'manual' })
  return { base, call, close: () => new Promise((r) => mod.server.close(r)) }
}

const cookieFor = (token) => `${auth.APEX_COOKIE}=${token}`
const FORGED = { 'X-Apex-Identity': 'k1.eyJzdWIiOiJhZG1pbiJ9.forged', 'X-Apex-Service': 'k1.e30.forged' }

test.after(async () => {
  for (const s of [apps.showcase.server, apps.vault.server, core.server, academia.server]) s.close()
})

/* ------------------------------------------------------------- tests -- */

test('mode off: client identity headers never reach any app, and nothing is added', async () => {
  const gw = await gateway('off')
  try {
    const token = auth.issueToken('one@x.io', ['showcase', 'vault', 'academia'], 1, 'core-1')
    for (const [name, fake] of Object.entries(apps)) {
      const res = await gw.call(`${project(name).api.base}/anything`, { headers: { Cookie: cookieFor(token), ...FORGED } })
      assert.equal(res.status, 200)
      const { headers } = fake.last()
      assert.equal(headers['x-apex-identity'], undefined, `${name} got no identity header`)
      assert.equal(headers['x-apex-service'], undefined, `${name} got no service header`)
    }
    // The Academia's API too (here the Core fake answers 404, but the headers are what matter).
    const before = core.state.resolveCalls
    await gw.call('/academia/api/whatever', { headers: { Cookie: cookieFor(token), ...FORGED } })
    assert.equal(core.state.resolveCalls, before, 'mode off never asks the Core')
    assert.equal(fs.existsSync(process.env.APEX_IDENTITY_KEYS_FILE), false, 'mode off creates no keys')
  } finally {
    await gw.close()
  }
})

test('mode off: old three- and four-part session tokens are still honoured', async () => {
  const secret = fs.readFileSync(path.join(HERE, '.session-secret'), 'utf8').trim()
  const mac = (body) => crypto.createHmac('sha256', secret).update(body).digest('base64url')
  const exp = Date.now() + 3600_000
  const email = Buffer.from('old@x.io').toString('base64url')
  const three = `${email}.${exp}`
  const four = `${email}.${exp}.showcase~vault`
  const tokens = [`${three}.${mac(three)}`, `${four}.${mac(four)}`]
  assert.deepEqual(tokenView(tokens[0]), { email: 'old@x.io', apps: ['showcase', 'vault', 'academia'], sub: null })
  assert.deepEqual(tokenView(tokens[1]), { email: 'old@x.io', apps: ['showcase', 'vault'], sub: null })
  assert.equal(auth.verifyToken(auth.issueToken('new@x.io', ['showcase'], 1, 'core-9')).sub, 'core-9')

  const gw = await gateway('old-tokens')
  try {
    for (const token of tokens) {
      const res = await gw.call('/showcase/api/me', { headers: { Cookie: cookieFor(token) } })
      assert.equal(res.status, 200)
    }
  } finally {
    await gw.close()
  }
})

test('mode required: a fresh assertion per app, with the right aud and exp, replacing any client value', async () => {
  const gw = await gateway('required', { APEX_IDENTITY_MODE: 'required' })
  try {
    const token = auth.issueToken('one@x.io', ['showcase', 'vault', 'academia'], 1, 'core-1')
    const store = loadKeys()

    const res = await gw.call('/showcase/api/plates', { headers: { Cookie: cookieFor(token), ...FORGED } })
    assert.equal(res.status, 200)
    const showcaseHeader = apps.showcase.last().headers['x-apex-identity']
    assert.notEqual(showcaseHeader, FORGED['X-Apex-Identity'])
    assert.equal(apps.showcase.last().headers['x-apex-service'], undefined)
    const v = verifyAssertion(showcaseHeader, { keys: parseKeys(keysFor(store, 'showcase')), audience: 'showcase' })
    assert.equal(v.ok, true)
    assert.equal(v.claims.sub, 'core-1')
    assert.equal(v.claims.app_user_id, 'local-7')
    assert.equal(v.claims.email, 'one@x.io')
    assert.equal(v.claims.name, 'User One')
    assert.equal(v.claims.exp - v.claims.iat, 60)
    assert.ok(Math.abs(v.claims.iat - Date.now() / 1000) < 5)
    assert.deepEqual(v.claims.roles, [{ role: 'app_admin', scope_type: 'app', scope_id: 'showcase' }])

    await gw.call('/vault/api/files', { headers: { Cookie: cookieFor(token) } })
    const vaultHeader = apps.vault.last().headers['x-apex-identity']
    const vv = verifyAssertion(vaultHeader, { keys: parseKeys(keysFor(store, 'slidesvault')), audience: 'slidesvault' })
    assert.equal(vv.ok, true)
    assert.equal(vv.claims.app_user_id, null)
    assert.equal(verifyAssertion(vaultHeader, { keys: parseKeys(keysFor(store, 'showcase')), audience: 'showcase' }).ok, false, 'not valid for the other app')

    // The service assertion the Core saw verified with the core key.
    assert.ok(core.state.serviceOk.length > 0 && core.state.serviceOk.every(Boolean))
  } finally {
    await gw.close()
  }
})

test('resolve answers are cached per sub (one Core call for many requests)', async () => {
  const gw = await gateway('cache', { APEX_IDENTITY_MODE: 'optional' })
  try {
    const token = auth.issueToken('one@x.io', ['showcase', 'vault'], 1, 'core-1')
    const before = core.state.resolveCalls
    for (let i = 0; i < 5; i++) await gw.call('/showcase/api/x', { headers: { Cookie: cookieFor(token) } })
    await gw.call('/vault/api/x', { headers: { Cookie: cookieFor(token) } })
    assert.equal(core.state.resolveCalls - before, 1)
  } finally {
    await gw.close()
  }
})

test('active:false revokes the Apex session: 401, cookies cleared, token dead, app never reached', async () => {
  const gw = await gateway('revoke', { APEX_IDENTITY_MODE: 'required' })
  try {
    const token = auth.issueToken('gone@x.io', ['showcase', 'vault'], 1, 'core-gone')
    const hits = apps.showcase.seen.length
    const res = await gw.call('/showcase/api/x', { headers: { Cookie: cookieFor(token) } })
    assert.equal(res.status, 401)
    assert.equal((await res.json()).code, 'APEX_SIGNIN_REQUIRED')
    assert.ok(res.headers.getSetCookie().some((c) => c.startsWith(`${auth.APEX_COOKIE}=;`)))
    assert.equal(apps.showcase.seen.length, hits)
    assert.equal(auth.verifyToken(token), null, 'the token is revoked')

    // A page load is sent to the sign-in page instead.
    const token2 = auth.issueToken('gone@x.io', ['showcase'], 1, 'core-gone')
    const page = await gw.call('/showcase/', { headers: { Cookie: cookieFor(token2), Accept: 'text/html' } })
    assert.equal(page.status, 302)
    assert.match(page.headers.get('location'), /^\/login\?expired=1/)
  } finally {
    await gw.close()
  }
})

test('sessions ended in the Core (password change/reset, disable) revoke older Apex sessions (security review L1)', async () => {
  const gw = await gateway('epoch', { APEX_IDENTITY_MODE: 'required' })
  const base = { active: true, roles: [{ role: 'learner', scope_type: 'platform', scope_id: '' }], links: {} }
  try {
    // Sessions valid only after a moment later than this token's issue: the token must die.
    core.state.users.set('core-reset', { ...base, user: { id: 'core-reset', email: 'r@x.io', full_name: '' }, sessions_valid_after: new Date(Date.now() + 5000).toISOString() })
    const old = auth.issueToken('r@x.io', ['showcase'], auth.SESSION_HOURS, 'core-reset')
    const hits = apps.showcase.seen.length
    const res = await gw.call('/showcase/api/x', { headers: { Cookie: cookieFor(old) } })
    assert.equal(res.status, 401)
    assert.equal(apps.showcase.seen.length, hits, 'the app is never reached')
    assert.equal(auth.verifyToken(old), null, 'the Apex token is revoked')

    // A session issued after the Core's cut-off keeps working.
    core.state.users.set('core-fresh', { ...base, user: { id: 'core-fresh', email: 'f@x.io', full_name: '' }, sessions_valid_after: new Date(Date.now() - 3600_000).toISOString() })
    const fresh = auth.issueToken('f@x.io', ['showcase'], auth.SESSION_HOURS, 'core-fresh')
    assert.equal((await gw.call('/showcase/api/x', { headers: { Cookie: cookieFor(fresh) } })).status, 200)
  } finally {
    await gw.close()
  }
})

test('Core unreachable: required apps get 503 and are never reached unsigned; optional apps fall back', async () => {
  const realPort = project('academia').api.port
  project('academia').api.port = await deadPort()
  try {
    const required = await gateway('down-required', { APEX_IDENTITY_MODE_SHOWCASE: 'required', APEX_IDENTITY_MODE_SLIDESVAULT: 'optional' })
    try {
      const token = auth.issueToken('one@x.io', ['showcase', 'vault'], 1, 'core-1')
      const hits = apps.showcase.seen.length
      const res = await required.call('/showcase/api/x', { headers: { Cookie: cookieFor(token), ...FORGED } })
      assert.equal(res.status, 503)
      assert.equal((await res.json()).code, 'APEX_IDENTITY_UNAVAILABLE')
      assert.equal(apps.showcase.seen.length, hits, 'no unsigned pass-through')

      const opt = await required.call('/vault/api/x', { headers: { Cookie: cookieFor(token), ...FORGED } })
      assert.equal(opt.status, 200)
      assert.equal(apps.vault.last().headers['x-apex-identity'], undefined, 'optional: forwarded without any assertion')
    } finally {
      await required.close()
    }
  } finally {
    project('academia').api.port = realPort
  }
})

test('the sign-in page CSP allows its own inline scripts by hash and Google only when configured', async () => {
  const html = fs.readFileSync(path.join(HERE, 'public', 'login.html'), 'utf8')
  const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => crypto.createHash('sha256').update(m[1]).digest('base64'))
  assert.ok(hashes.length >= 2)

  const plain = await gateway('csp-plain')
  try {
    const res = await plain.call('/login')
    assert.equal(res.status, 200)
    const csp = res.headers.get('content-security-policy')
    for (const h of hashes) assert.ok(csp.includes(`'sha256-${h}'`), 'every inline script is allowed')
    assert.ok(!csp.includes('accounts.google.com'))
    assert.ok(!/script-src[^;]*'unsafe-inline'/.test(csp))
    assert.match(csp, /frame-ancestors 'none'/)
    assert.equal((await (await plain.call('/auth/config')).json()).googleClientId, null)
    assert.equal((await plain.call('/auth/google', { method: 'POST', headers: { Origin: plain.base } })).status, 404)
  } finally {
    await plain.close()
  }
})

test('Sign in with Google: the credential goes to the Core and the Apex session carries its sub', async () => {
  const gw = await gateway('google', { APEX_GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', APEX_IDENTITY_MODE_SLIDESVAULT: 'required' })
  try {
    assert.equal((await (await gw.call('/auth/config')).json()).googleClientId, 'cid.apps.googleusercontent.com')
    const csp = (await gw.call('/login')).headers.get('content-security-policy')
    assert.match(csp, /script-src [^;]*https:\/\/accounts\.google\.com\/gsi\/client/)
    assert.match(csp, /frame-src https:\/\/accounts\.google\.com\/gsi\//)

    const post = (body, headers = { Origin: gw.base }) =>
      gw.call('/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })

    assert.equal((await post({ credential: 'good-google-token' }, { Origin: 'https://evil.example' })).status, 403)
    const bad = await post({ credential: 'forged' })
    assert.equal(bad.status, 401)

    const ok = await post({ credential: 'good-google-token', next: '/vault/' })
    assert.equal(ok.status, 200)
    const body = await ok.json()
    assert.deepEqual(body.apps.sort(), ['academia', 'vault'])
    const cookies = ok.headers.getSetCookie()
    const apex = cookies.find((c) => c.startsWith(`${auth.APEX_COOKIE}=`)).split(';')[0].split('=')[1]
    assert.deepEqual(tokenView(apex), { email: 'g@x.io', apps: ['academia', 'vault'], sub: 'core-g' })
    assert.ok(cookies.some((c) => c.startsWith('iea_session=core-sess') && /Path=\/academia\//.test(c)))
  } finally {
    await gw.close()
  }
})

test('per-project upstream host: APEX_UPSTREAM_HOST_SHOWCASE wins over APEX_UPSTREAM_HOST, others keep it', async () => {
  const gw = await gateway('upstream')
  const saved = { all: process.env.APEX_UPSTREAM_HOST, showcase: process.env.APEX_UPSTREAM_HOST_SHOWCASE }
  // Read per request, so setting them now applies. Nothing listens on 127.0.0.2 at these ports.
  process.env.APEX_UPSTREAM_HOST = '127.0.0.2'
  process.env.APEX_UPSTREAM_HOST_SHOWCASE = '127.0.0.1'
  try {
    const token = auth.issueToken('one@x.io', ['showcase', 'vault', 'academia'], 1)
    const ok = await gw.call('/showcase/api/anything', { headers: { Cookie: cookieFor(token) } })
    assert.equal(ok.status, 200)
    assert.equal(apps.showcase.last().headers.host, `127.0.0.1:${apps.showcase.port}`)
    const before = apps.vault.seen.length
    const other = await gw.call('/vault/api/anything', { headers: { Cookie: cookieFor(token) } })
    assert.notEqual(other.status, 200, 'the vault followed APEX_UPSTREAM_HOST, where nothing listens')
    assert.equal(apps.vault.seen.length, before)
  } finally {
    for (const [k, v] of [['APEX_UPSTREAM_HOST', saved.all], ['APEX_UPSTREAM_HOST_SHOWCASE', saved.showcase]]) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    await gw.close()
  }
})
