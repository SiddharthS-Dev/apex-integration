/**
 * The HTTP surface: auth, RBAC, the content proxy, and the rule that no
 * Dropbox URL or token ever reaches a client.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, fakeJpeg } from './fakes.mjs'

async function withLibrary(fn) {
  const h = await createHarness()
  try {
    const admin = await h.signIn('admin@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/IMG_1.jpg', fakeJpeg(800, 600))
    h.dropbox.put('/Showcase/page.html', '<html><title>Hello Plate</title><script>steal()</script><body>x</body></html>')
    await h.syncAndWait()
    await fn(h, admin)
  } finally {
    await h.close()
  }
}

test('register -> verify -> session cookie; login history recorded', async () => {
  const h = await createHarness({ env: { EXPOSE_DEV_CODES: 'true' } })
  try {
    const c = h.client()
    const reg = await c.json('POST', '/api/auth/register', { email: 'New@X.io', password: 'abcdefg1', name: 'New' })
    assert.equal(reg.status, 201)
    assert.match(reg.body.devCode, /^\d{6}$/)

    const wrong = await c.json('POST', '/api/auth/verify', { email: 'new@x.io', code: '000000' === reg.body.devCode ? '111111' : '000000' })
    assert.equal(wrong.status, 400)
    assert.match(wrong.body.error.message, /4 attempts left/)

    const ok = await c.json('POST', '/api/auth/verify', { email: 'new@x.io', code: reg.body.devCode })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.session.user.email, 'new@x.io')
    assert.equal(ok.body.session.user.role, 'admin', 'first account in development becomes admin')

    const s = await c.json('GET', '/api/auth/session')
    assert.equal(s.body.session.user.email, 'new@x.io')
    await c.json('POST', '/api/auth/logout')
    assert.equal((await c.json('GET', '/api/auth/session')).body.session, null)

    const bad = await h.client().json('POST', '/api/auth/login', { email: 'new@x.io', password: 'nope-nope1' })
    assert.equal(bad.status, 401)
    const hist = await h.services.repos.loginHistory.list()
    assert.deepEqual(hist.items.map((i) => i.success), [false, true])
  } finally {
    await h.close()
  }
})

test('password reset revokes existing sessions and cannot enumerate accounts', async () => {
  const h = await createHarness({ env: { EXPOSE_DEV_CODES: 'true' } })
  try {
    await h.signIn('a@x.io', 'admin') // otherwise r@x.io claims the role, and admins get no dev reset code
    const u = await h.signIn('r@x.io')
    const unknown = await h.client().json('POST', '/api/auth/forgot', { email: 'nobody@x.io' })
    assert.equal(unknown.status, 200)
    assert.equal(unknown.body.devToken, null)
    const f = await h.client().json('POST', '/api/auth/forgot', { email: 'r@x.io' })
    const r = await h.client().json('POST', '/api/auth/reset', { email: 'r@x.io', token: f.body.devToken, password: 'newpass12' })
    assert.equal(r.status, 200)
    assert.equal((await u.json('GET', '/api/auth/session')).body.session, null, 'old session revoked')
  } finally {
    await h.close()
  }
})

test('one-time codes stay server-side unless EXPOSE_DEV_CODES=true', async () => {
  const h = await createHarness()
  try {
    assert.equal(h.config.auth.exposeDevCodes, false, 'off by default')
    assert.equal((await h.client().json('GET', '/api/auth/config')).body.devCodes, false)
    const reg = await h.client().json('POST', '/api/auth/register', { email: 'quiet@x.io', password: 'abcdefg1' })
    assert.equal(reg.status, 201)
    assert.equal(reg.body.devCode, null)
    await h.signIn('v@x.io')
    const f = await h.client().json('POST', '/api/auth/forgot', { email: 'v@x.io' })
    assert.equal(f.status, 200)
    assert.equal(f.body.devToken, null)
    assert.ok(await h.services.repos.codes.pending('v@x.io', 'reset'), 'the code is still issued')
  } finally {
    await h.close()
  }
})

test("an administrator's reset code is never returned, even with dev codes on", async () => {
  const h = await createHarness({ env: { EXPOSE_DEV_CODES: 'true' } })
  try {
    await h.signIn('boss@x.io', 'admin')
    await h.signIn('v@x.io')
    const admin = await h.client().json('POST', '/api/auth/forgot', { email: 'boss@x.io' })
    assert.equal(admin.status, 200)
    assert.equal(admin.body.devToken, null)
    const viewer = await h.client().json('POST', '/api/auth/forgot', { email: 'v@x.io' })
    assert.match(viewer.body.devToken, /^\d{6}$/)
  } finally {
    await h.close()
  }
})

test('the catalog is behind auth and contains no Dropbox URLs or tokens', async () => {
  await withLibrary(async (h) => {
    assert.equal((await h.client().get('/api/entities/plates')).status, 401)
    const viewer = await h.signIn('v@x.io')
    const res = await viewer.get('/api/entities/plates')
    const text = await res.text()
    const body = JSON.parse(text)
    assert.equal(body.total, 2)
    assert.ok(!/dropbox(api)?\.com|id:\d|at-\d|rt-secret/.test(text), 'nothing Dropbox-shaped leaks')
    const img = body.items.find((i) => i.f === 'IMG_1.jpg')
    assert.match(img.thumbUrl, /^\/api\/dropbox\/files\/[^/]+\/thumbnail\?v=/)
    assert.equal(img.w, 640, 'dimensions from the rendered thumbnail')

    const status = await (await viewer.get('/api/dropbox/status')).json()
    assert.equal(status.account, undefined, 'viewers do not see the account')
  })
})

test('content proxy: thumbnails are cached, originals stream with Range', async () => {
  await withLibrary(async (h) => {
    const viewer = await h.signIn('v@x.io')
    const { items } = await (await viewer.get('/api/entities/plates')).json()
    const img = items.find((i) => i.f === 'IMG_1.jpg')

    const before = h.dropbox.state.thumbnailCalls
    const t1 = await viewer.get(img.thumbUrl)
    assert.equal(t1.status, 200)
    assert.equal(t1.headers.get('content-type'), 'image/jpeg')
    assert.match(t1.headers.get('cache-control'), /immutable/)
    await viewer.get(img.thumbUrl)
    assert.equal(h.dropbox.state.thumbnailCalls, before, 'served from the object store, filled during sync')

    const part = await viewer.get(img.contentUrl, { Range: 'bytes=0-3' })
    assert.equal(part.status, 206)
    assert.equal(part.headers.get('content-range'), 'bytes 0-3/20')
    assert.equal(Buffer.from(await part.arrayBuffer()).length, 4)
  })
})

test('HTML is sandboxed when served from our origin', async () => {
  await withLibrary(async (h) => {
    const viewer = await h.signIn('v@x.io')
    const { items } = await (await viewer.get('/api/entities/plates')).json()
    const page = items.find((i) => i.f === 'page.html')
    assert.equal(page.title, 'Hello Plate')
    const res = await viewer.get(page.contentUrl)
    assert.match(res.headers.get('content-security-policy'), /^sandbox;/)
  })
})

test('RBAC is enforced on the server', async () => {
  await withLibrary(async (h, admin) => {
    const viewer = await h.signIn('v@x.io')
    const guest = h.client()
    await guest.json('POST', '/api/auth/guest')
    for (const [who, expect] of [
      [viewer, 403],
      [guest, 403],
      [admin, 202],
    ]) {
      assert.equal((await who.post('/api/dropbox/sync')).status, expect)
    }
    assert.equal((await viewer.get('/api/entities/sync-logs')).status, 403)
    assert.equal((await viewer.get('/api/admin/users')).status, 403)
    assert.equal((await admin.get('/api/admin/users')).status, 200)
    // wait for the admin's run to release the lock before closing
    while (h.services.sync.progress()) await new Promise((r) => setTimeout(r, 20))
  })
})

test('the last administrator cannot be demoted', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    const r = await admin.json('PATCH', `/api/admin/users/${admin.user.id}`, { role: 'viewer' })
    assert.equal(r.status, 409)
  } finally {
    await h.close()
  }
})

test('cross-origin writes are refused', async () => {
  const h = await createHarness()
  try {
    const res = await h.client().post('/api/auth/guest', {}, { Origin: 'https://evil.example' })
    assert.equal(res.status, 403)
    const opaque = await h.client().post('/api/auth/guest', {}, { Origin: 'null' })
    assert.equal(opaque.status, 403)
  } finally {
    await h.close()
  }
})

test('cookie-authenticated writes need a matching Origin or Referer', async () => {
  const h = await createHarness()
  try {
    const v = await h.signIn('v@x.io')
    // past the guard this is a 404 (no such plate); the guard answers 403
    const write = (headers) => v.post('/api/entities/plates/nope/events', { kind: 'view' }, headers)
    assert.equal((await write({ Origin: undefined })).status, 403, 'a session cookie with neither header is refused')
    assert.equal((await write({ Origin: undefined, Referer: 'https://evil.example/page' })).status, 403)
    const goodRef = await write({ Origin: undefined, Referer: `${h.config.webOrigin}/showcase/admin` })
    assert.equal(goodRef.status, 404, 'Referer from an allowed origin stands in for Origin')

    // sign-out needs only the cookie (the Apex dashboard signs each app out that way)
    assert.equal((await v.post('/api/auth/logout', {}, { Origin: undefined })).status, 200)
    assert.equal((await v.json('GET', '/api/auth/session')).body.session, null)
    assert.equal((await h.client().post('/api/auth/logout', {}, { Origin: 'https://evil.example' })).status, 403, 'a foreign Origin is still refused')

    // no cookie: nothing to forge, so scripts and first sign-ins still work
    const anon = await h.client().post('/api/auth/guest', {}, { Origin: undefined })
    assert.equal(anon.status, 200)
  } finally {
    await h.close()
  }
})

test('archived files disappear for viewers', async () => {
  await withLibrary(async (h) => {
    const viewer = await h.signIn('v@x.io')
    const { items } = await (await viewer.get('/api/entities/plates')).json()
    const img = items.find((i) => i.f === 'IMG_1.jpg')
    h.dropbox.remove('/Showcase/IMG_1.jpg')
    await h.syncAndWait()
    assert.equal((await viewer.get(img.thumbUrl)).status, 404)
    assert.equal((await (await viewer.get('/api/entities/plates')).json()).total, 1)
  })
})

test('plate events: guests may only count views, archived plates take none, and they are rate-limited', async () => {
  await withLibrary(async (h) => {
    const viewer = await h.signIn('v@x.io')
    const guest = h.client()
    await guest.json('POST', '/api/auth/guest')
    const { items } = await (await viewer.get('/api/entities/plates')).json()
    const img = items.find((i) => i.f === 'IMG_1.jpg')
    const ev = (who, kind, id = img.id) => who.post(`/api/entities/plates/${encodeURIComponent(id)}/events`, { kind })

    assert.equal((await ev(guest, 'view')).status, 204)
    assert.equal((await ev(guest, 'download')).status, 403)
    assert.equal((await ev(guest, 'favourite')).status, 403)
    const ok = await ev(viewer, 'download')
    assert.equal(ok.status, 204)
    assert.equal(ok.headers.get('ratelimit-limit'), '2000', 'the events limiter (not just the global one) is in front')

    h.dropbox.remove('/Showcase/IMG_1.jpg')
    await h.syncAndWait()
    assert.equal((await ev(viewer, 'view')).status, 404, 'archived plates record nothing')
  })
})

test('the plate count is public and only a number', async () => {
  await withLibrary(async (h) => {
    const res = await h.client().json('GET', '/api/entities/plates/count')
    assert.equal(res.status, 200)
    assert.deepEqual(res.body, { total: 2 })
  })
})

test('analytics are for administrators only', async () => {
  await withLibrary(async (h, admin) => {
    const viewer = await h.signIn('v@x.io')
    const guest = h.client()
    await guest.json('POST', '/api/auth/guest')
    assert.equal((await guest.get('/api/entities/analytics')).status, 403)
    assert.equal((await viewer.get('/api/entities/analytics')).status, 403)
    const res = await admin.get('/api/entities/analytics')
    assert.equal(res.status, 200)
    assert.ok(Array.isArray((await res.json()).logins))
  })
})
