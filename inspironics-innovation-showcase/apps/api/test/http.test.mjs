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
  const h = await createHarness()
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
  const h = await createHarness()
  try {
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
