/**
 * Security hardening: guest access off by default, paid AI for members only,
 * zip-bomb limits on extraction, and sign-in lockout / timing.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import JSZip from 'jszip'
import { loadConfig } from '../src/config.js'
import { extractContent, extractPdf, extractPptx } from '../src/sync/extract.js'
import { createLoginLockout } from '../src/routes/auth.js'
import { createHarness, fakeJpeg } from './fakes.mjs'

/* ------------------------------------------------------------- guest ------ */

test('guest access is off unless GUEST_ENABLED=true', async () => {
  assert.equal(loadConfig({}).auth.guestEnabled, false)
  assert.equal(loadConfig({ GUEST_ENABLED: 'true' }).auth.guestEnabled, true)

  const h = await createHarness({ env: { GUEST_ENABLED: undefined } })
  try {
    assert.equal((await h.client().json('GET', '/api/auth/config')).body.guestEnabled, false, 'the web app learns it from /config')
    assert.equal((await h.client().json('POST', '/api/auth/guest')).status, 403)
  } finally {
    await h.close()
  }
})

test('the shared guest identity cannot trigger an AI description (members only)', async () => {
  const h = await createHarness()
  try {
    const admin = await h.signIn('admin@x.io', 'admin')
    await h.connectDropbox(admin.user.id)
    h.dropbox.put('/Showcase/IMG_1.jpg', fakeJpeg(800, 600))
    await h.syncAndWait()
    const { items } = await (await admin.get('/api/entities/plates')).json()
    const id = encodeURIComponent(items[0].id)

    const guest = h.client()
    assert.equal((await guest.json('POST', '/api/auth/guest')).status, 200)
    const g = await guest.json('POST', `/api/entities/plates/${id}/describe`)
    assert.equal(g.status, 403)
    assert.match(g.body.error.message, /Create an account/)

    assert.equal((await h.client().json('POST', `/api/entities/plates/${id}/describe`)).status, 401, 'anonymous')
    const viewer = await h.signIn('v@x.io')
    assert.notEqual((await viewer.json('POST', `/api/entities/plates/${id}/describe`)).status, 403, 'a member gets past the gate')
  } finally {
    await h.close()
  }
})

/* --------------------------------------------------------- zip bombs ------ */

const bombPptx = async ({ slides = 3, slideBytes = 4 * 1048576, extraEntries = 0 } = {}) => {
  const zip = new JSZip()
  zip.file('docProps/core.xml', '<cp:coreProperties><dc:title>Bomb</dc:title></cp:coreProperties>')
  const filler = 'A'.repeat(slideBytes)
  for (let i = 1; i <= slides; i++) zip.file(`ppt/slides/slide${i}.xml`, `<p:sld><a:p><a:t>Slide ${i}</a:t></a:p>${filler}</p:sld>`)
  for (let i = 0; i < extraEntries; i++) zip.file(`junk/${i}.txt`, '')
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}

test('pptx: decompression stops at the byte budget and returns what it read', async () => {
  const buf = await bombPptx()
  assert.ok(buf.length < 200_000, `the crafted archive is small (${buf.length} bytes) but inflates to 12 MB`)
  const warnings = []
  const log = { warn: (msg, meta) => warnings.push({ msg, meta }) }

  const out = await extractPptx(buf, { maxBytes: 6 * 1048576, log })
  assert.equal(out.truncated, true)
  assert.equal(out.metadataTitle, 'Bomb')
  assert.equal(out.slideCount, 1, 'slide 1 fits, slide 2 crosses the budget')
  assert.match(out.text, /Slide 1/)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0].msg, /size limit/)

  const whole = await extractPptx(buf, { maxBytes: 64 * 1048576 })
  assert.equal(whole.slideCount, 3)
  assert.equal(whole.truncated, undefined)
})

test('pptx: an archive with too many entries is not read at all', async () => {
  const buf = await bombPptx({ slides: 1, slideBytes: 10, extraEntries: 50 })
  const warnings = []
  const out = await extractContent('pptx', buf, { maxEntries: 20, log: { warn: (m) => warnings.push(m) } })
  assert.deepEqual(out, { metadataTitle: '', text: '', slideCount: 0, truncated: true })
  assert.match(warnings[0], /too many archive entries/)
})

test('pdf: Flate streams share the decompression budget', () => {
  const big = deflateSync(Buffer.from(`BT (Huge) Tj ET ${' '.repeat(2 * 1048576)}`))
  const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n<< /Filter /FlateDecode >> stream\n'), big, Buffer.from('\nendstream\n')])
  assert.match(extractPdf(pdf).text, /Huge/)
  assert.equal(extractPdf(pdf, { maxBytes: 1048576 }).text, '', 'over the budget the stream is skipped')
})

test('unzip limits are configurable', () => {
  const c = loadConfig({ MAX_UNZIP_MB: '7', MAX_ZIP_ENTRIES: '99' })
  assert.equal(c.sync.maxUnzipMb, 7)
  assert.equal(c.sync.maxZipEntries, 99)
  assert.equal(loadConfig({}).sync.maxUnzipMb, 50)
})

/* ------------------------------------------------------------ sign-in ----- */

test('login lockout: N consecutive failures lock the account (429), success resets', async () => {
  assert.equal(loadConfig({}).auth.loginMaxFailures, 10)
  const h = await createHarness({ env: { LOGIN_MAX_FAILURES: '3' } })
  try {
    await h.signIn('a@x.io', 'admin')
    await h.signIn('b@x.io')
    const login = (email, password) => h.client().json('POST', '/api/auth/login', { email, password })

    // two failures, then a success, resets the count
    assert.equal((await login('b@x.io', 'wrong-pass1')).status, 401)
    assert.equal((await login('b@x.io', 'wrong-pass1')).status, 401)
    assert.equal((await login('b@x.io', 'Passw0rd1')).status, 200)
    assert.equal((await login('b@x.io', 'wrong-pass1')).status, 401)
    assert.equal((await login('b@x.io', 'wrong-pass1')).status, 401)
    assert.equal((await login('b@x.io', 'Passw0rd1')).status, 200, 'not locked: the success reset the count')

    for (let i = 0; i < 3; i++) assert.equal((await login('a@x.io', 'wrong-pass1')).status, 401)
    const locked = await login('a@x.io', 'Passw0rd1')
    assert.equal(locked.status, 429, 'even the right password is refused while locked')
    assert.match(locked.body.error.message, /Too many failed sign-in attempts/)
    assert.equal((await login('b@x.io', 'Passw0rd1')).status, 200, 'other accounts are unaffected')

    // unknown emails lock the same way, so a lockout reveals nothing about which accounts exist
    for (let i = 0; i < 3; i++) assert.equal((await login('ghost@x.io', 'wrong-pass1')).status, 401)
    assert.equal((await login('ghost@x.io', 'wrong-pass1')).status, 429)
  } finally {
    await h.close()
  }
})

test('login lockout expires after the window', () => {
  let t = 0
  const l = createLoginLockout({ maxFailures: 2, windowMs: 1000, now: () => t })
  l.fail('x')
  t = 1500 // the first failure has aged out: this starts a new run
  l.fail('x')
  assert.equal(l.lockedFor('x'), 0)
  l.fail('x')
  assert.equal(l.lockedFor('x'), 1000)
  t += 999
  assert.equal(l.lockedFor('x'), 1)
  t += 1
  assert.equal(l.lockedFor('x'), 0)
  l.fail('x')
  assert.equal(l.lockedFor('x'), 0, 'a fresh run after the lock ends')
})

test('an unknown email still pays for a scrypt compare (no timing oracle)', async () => {
  const h = await createHarness()
  try {
    await h.signIn('known@x.io')
    const time = async (email) => {
      const t0 = performance.now()
      assert.equal((await h.client().json('POST', '/api/auth/login', { email, password: 'wrong-pass1' })).status, 401)
      return performance.now() - t0
    }
    await time('warmup@x.io') // builds the dummy hash once
    const known = Math.min(await time('known@x.io'), await time('known@x.io'))
    const unknown = Math.min(await time('nobody1@x.io'), await time('nobody2@x.io'))
    assert.ok(unknown > known * 0.4, `unknown ${unknown.toFixed(0)} ms vs known ${known.toFixed(0)} ms`)
  } finally {
    await h.close()
  }
})
