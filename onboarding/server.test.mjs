/**
 * The onboarding application against a fake Core: it never takes a portal port, serves the page with a
 * hashed-script CSP and no referrer, offers no sign-in of its own (only the portal's address), relays
 * the onboarding steps with the resume token kept in an HttpOnly cookie, and refuses cross-origin and
 * non-JSON writes. Nothing else is reachable.
 *
 *   cd onboarding && npm test
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { PORTAL_PORTS, createServer, settings } from './server.mjs'
import { ONBOARDING_COOKIE } from './relay.mjs'

const listen = (s) => new Promise((r) => s.listen(0, '127.0.0.1', () => r(s.address().port)))
const TOKEN_A = `tokA_${'a'.repeat(40)}`
const TOKEN_B = `tokB_${'b'.repeat(40)}`

test('port isolation: never a portal port, no fallback, shared Core on 4177 by default', () => {
  for (const p of [5173, 5174, 5175, 5176, 4175, 4176, 4177]) {
    assert.ok(PORTAL_PORTS.includes(p))
    assert.match(settings({ ONBOARDING_PORT: String(p) }).problems.join(' '), /belongs to the portal/)
  }
  const d = settings({})
  assert.deepEqual(d.problems, [])
  assert.equal(d.port, 5180)
  assert.equal(d.corePort, 4177)
  assert.equal(d.portalUrl, 'http://localhost:5173')
  assert.match(settings({ ONBOARDING_PORTAL_URL: 'javascript:alert(1)' }).problems.join(' '), /origin/)
})

test('page, config, relay and refusals, against a fake Core', async () => {
  const seen = []
  const core = http.createServer((req, res) => {
    let text = ''
    req.on('data', (c) => (text += c))
    req.on('end', () => {
      seen.push({ url: req.url, headers: req.headers, body: text ? JSON.parse(text) : null })
      const send = (status, body) => res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(body))
      const token = req.headers['x-registration-token']
      if (req.url === '/api/onboarding/config') return send(200, { enabled: true, roles: [] })
      if (req.url === '/api/onboarding/start') return send(202, { ok: true, state: 'CODE_SENT', registration_token: TOKEN_A })
      if (req.url === '/api/onboarding/status') return token === TOKEN_A ? send(200, { state: 'CODE_SENT' }) : send(401, { error: 'Start again.', details: { code: 'RESTART' } })
      if (req.url === '/api/onboarding/complete') return send(200, { state: 'PENDING_APPROVAL', registration_token: TOKEN_B })
      return send(404, { error: 'nope' })
    })
  })
  const corePort = await listen(core)
  const app = createServer({ port: 5180, corePort })
  const base = `http://127.0.0.1:${await listen(app)}`
  const post = (p, body, { origin = base, cookie = '', type = 'application/json' } = {}) =>
    fetch(base + p, { method: 'POST', headers: { ...(origin ? { Origin: origin } : {}), 'Content-Type': type, ...(cookie ? { Cookie: cookie } : {}) }, body: typeof body === 'string' ? body : JSON.stringify(body) })
  try {
    const page = await fetch(`${base}/`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-security-policy'), /script-src 'self' 'sha256-/)
    assert.doesNotMatch(page.headers.get('content-security-policy'), /unsafe-eval/)
    assert.equal(page.headers.get('referrer-policy'), 'no-referrer')
    const html = await page.text()
    assert.match(html, /Enterprise Onboarding Assistant/)
    assert.doesNotMatch(html, /localStorage|sessionStorage|innerHTML/, 'no browser storage, no HTML injection')
    assert.doesNotMatch(html, /type="password"|type='password'/, 'no password field anywhere on the page')
    assert.doesNotMatch(html, /(src|href)="https?:\/\/(?!localhost:5173)/, 'nothing loaded from another origin')
    assert.equal((await fetch(`${base}/join`)).status, 200, 'emailed response links land on the page')

    const appCfg = await (await fetch(`${base}/app-config.json`)).json()
    assert.equal(appCfg.sign_in_url, 'http://localhost:5173/login', 'existing users go to the portal sign-in')

    const start = await post('/auth/onboarding/start', { email: 'a@example.com' })
    assert.equal(start.status, 202)
    assert.equal((await start.json()).registration_token, undefined, 'the token never reaches page scripts')
    const setCookie = start.headers.get('set-cookie')
    assert.match(setCookie, new RegExp(`^${ONBOARDING_COOKIE}=${TOKEN_A};.*HttpOnly.*SameSite=Strict`))
    assert.doesNotMatch(setCookie, /apex_session|iea_session/, 'no session of any kind')
    const cookie = setCookie.split(';')[0]
    assert.equal((await (await fetch(`${base}/auth/onboarding/status`, { headers: { Cookie: cookie } })).json()).state, 'CODE_SENT')
    assert.equal(seen.find((s) => s.url === '/api/onboarding/status').headers['x-registration-token'], TOKEN_A)
    await post('/auth/onboarding/start', { email: 'b@example.com' }, { cookie })
    assert.equal(seen.filter((s) => s.url === '/api/onboarding/start').at(-1).body.previous_token, TOKEN_A, 'a restart supersedes the earlier draft')
    assert.match((await post('/auth/onboarding/complete', {}, { cookie })).headers.get('set-cookie'), new RegExp(`=${TOKEN_B};`), 'token rotates')

    assert.equal((await fetch(`${base}/auth/onboarding/status`)).status, 200, 'no cookie: nothing to resume')
    assert.equal((await post('/auth/onboarding/start', {}, { origin: 'https://evil.example' })).status, 403)
    assert.equal((await post('/auth/onboarding/start', {}, { origin: '' })).status, 403)
    assert.equal((await post('/auth/onboarding/start', 'email=x', { type: 'application/x-www-form-urlencoded' })).status, 415)
    assert.equal((await post('/auth/onboarding/start', 'x'.repeat(40 * 1024))).status, 400)
    for (const p of ['/api/auth/login', '/api/core/registrations', '/login', '/academia/api/auth/me']) assert.equal((await fetch(base + p)).status, 404, `${p} is not served here`)
  } finally {
    app.close()
    core.close()
  }
})
