/**
 * The Dropbox credential model and client behaviour.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, fakeJpeg } from './fakes.mjs'

test('the refresh token is stored encrypted and the access token never touches the database', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    const row = await h.services.db.get('SELECT * FROM dropbox_connection')
    const dump = JSON.stringify(row)
    assert.ok(!dump.includes('rt-secret-1'), 'refresh token not in plaintext')
    assert.ok(!/at-\d/.test(dump), 'no access token in the row')
    assert.match(row.refresh_token_enc, /^v1\./)
    assert.equal(row.is_team, 1)
    assert.equal(row.root_namespace_id, 'ns-root-1')
  } finally {
    await h.close()
  }
})

test('concurrent requests after expiry collapse into a single refresh', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/a.jpg', fakeJpeg(1, 1))
    h.dropbox.state.validTokens.clear() // everything outstanding has expired
    h.services.dropboxAuth.invalidate()
    const before = h.dropbox.state.tokenCalls
    await Promise.all(Array.from({ length: 8 }, () => h.services.dropbox.rpc('files/list_folder', { path: '/Showcase', recursive: true })))
    assert.equal(h.dropbox.state.tokenCalls - before, 1)
  } finally {
    await h.close()
  }
})

test('a 401 mid-flight refreshes once and retries', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/a.jpg', fakeJpeg(1, 1))
    h.dropbox.state.validTokens.clear() // the cached token is now rejected by "Dropbox"
    const page = await h.services.dropbox.rpc('files/list_folder', { path: '/Showcase', recursive: true })
    assert.equal(page.entries.length, 1)
  } finally {
    await h.close()
  }
})

test('every call carries the root path header, and a moved team root is followed', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/a.jpg', fakeJpeg(1, 1))
    h.dropbox.state.rootNamespaceId = 'ns-root-2' // a team reorganisation
    await h.services.dropbox.rpc('files/list_folder', { path: '/Showcase', recursive: true })
    const last = h.dropbox.state.calls.at(-1)
    assert.deepEqual(JSON.parse(last.headers['dropbox-api-path-root']), { '.tag': 'root', root: 'ns-root-2' })
    assert.equal((await h.services.repos.dropbox.get()).rootNamespaceId, 'ns-root-2', 'the new namespace is stored')
  } finally {
    await h.close()
  }
})

test('a revoked refresh token flags the connection for reconnection', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    const { encrypt } = await import('../src/lib/crypto.js')
    await h.services.db.run('UPDATE dropbox_connection SET refresh_token_enc = ?', [encrypt(h.services.key, 'revoked', 'dropbox-refresh-token')])
    h.services.dropboxAuth.invalidate()
    await assert.rejects(h.services.dropboxAuth.getAccessToken(), (e) => e.code === 'DROPBOX_REAUTH')
    assert.equal((await h.services.repos.dropbox.get()).status, 'reauth_required')
  } finally {
    await h.close()
  }
})

test('OAuth: start redirects to Dropbox with offline access and a state; callback checks it', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    const res = await admin.get('/api/dropbox/oauth/start')
    assert.equal(res.status, 302)
    const loc = new URL(res.headers.get('location'))
    assert.equal(loc.host, 'www.dropbox.com')
    assert.equal(loc.searchParams.get('token_access_type'), 'offline')
    assert.equal(loc.searchParams.get('redirect_uri'), `${h.config.publicUrl}/api/dropbox/oauth/callback`)
    const state = loc.searchParams.get('state')

    const bad = await admin.get('/api/dropbox/oauth/callback?code=good-code&state=forged')
    assert.match(bad.headers.get('location'), /dropbox=bad_state/)

    const ok = await admin.get(`/api/dropbox/oauth/callback?code=good-code&state=${state}`)
    assert.match(ok.headers.get('location'), /dropbox=connected/)
    const replay = await admin.get(`/api/dropbox/oauth/callback?code=good-code&state=${state}`)
    assert.match(replay.headers.get('location'), /dropbox=bad_state/, 'state is single use')

    const viewer = await h.signIn('v@x.io')
    assert.equal((await viewer.get('/api/dropbox/oauth/start')).status, 403)
  } finally {
    await h.close()
  }
})

test('an App Folder app that refuses the path-root header keeps working without it', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('a@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/a.jpg', fakeJpeg(1, 1))
    h.dropbox.state.refuseRoot = true
    const page = await h.services.dropbox.rpc('files/list_folder', { path: '/Showcase', recursive: true })
    assert.equal(page.entries.length, 1)
    assert.equal(h.dropbox.state.calls.at(-1).headers['dropbox-api-path-root'], undefined)
    assert.equal(await h.services.repos.settings.get('dropbox.appFolder'), true, 'remembered across restarts')
  } finally {
    await h.close()
  }
})
