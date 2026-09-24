/**
 * Pure pieces: crypto, titles, extraction, concurrency, logging.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { deflateSync } from 'node:zlib'
import { decrypt, encrypt, hashPassword, parseKey, verifyPassword } from '../src/lib/crypto.js'
import { createSingleFlight, mapPool } from '../src/lib/concurrency.js'
import { redact } from '../src/lib/log.js'
import { extractHtml, extractPdf, extractPptx, imageSize } from '../src/sync/extract.js'
import { humaniseFilename, isNoBetterThanFilename, resolveTitle } from '../src/sync/titles.js'
import { fakeJpeg, fakePptx } from './fakes.mjs'

test('AES-256-GCM round-trips, and tampering or the wrong purpose fails', () => {
  const key = parseKey('b'.repeat(64))
  const box = encrypt(key, 'refresh-token', 'purpose')
  assert.equal(decrypt(key, box, 'purpose'), 'refresh-token')
  assert.throws(() => decrypt(key, box, 'other-purpose'))
  const parts = box.split('.')
  parts[3] = Buffer.from('tampered').toString('base64url')
  assert.throws(() => decrypt(key, parts.join('.'), 'purpose'))
  assert.throws(() => parseKey('short'))
})

test('scrypt passwords verify, and only the right one', async () => {
  const h = await hashPassword('Passw0rd1')
  assert.ok(await verifyPassword('Passw0rd1', h))
  assert.ok(!(await verifyPassword('Passw0rd2', h)))
  assert.ok(!(await verifyPassword('x', 'garbage')))
})

test('titles: generic and filename-like candidates are rejected', () => {
  assert.ok(isNoBetterThanFilename('PowerPoint Presentation', 'deck.pptx'))
  assert.ok(isNoBetterThanFilename('Slide 1', 'deck.pptx'))
  assert.ok(isNoBetterThanFilename('IMG_0557', 'IMG_0557.jpg'))
  assert.ok(isNoBetterThanFilename('grid-ops-review', 'Grid Ops Review.pptx'))
  assert.ok(!isNoBetterThanFilename('Grid Operations Quarterly Review', 'Grid Ops Review.pptx'))

  assert.deepEqual(resolveTitle({ filename: 'x.pptx', metadata: 'PowerPoint Presentation', text: '[Slide 1]\nSmart Water Network Plan\n' }), {
    title: 'Smart Water Network Plan',
    source: 'content',
  })
  assert.deepEqual(resolveTitle({ filename: 'IMG_1.jpg', vision: 'Edge AI Command Deck' }), { title: 'Edge AI Command Deck', source: 'vision' })
  assert.deepEqual(resolveTitle({ filename: 'q3_grid-review.pptx' }), { title: 'Q3 Grid Review', source: 'filename' })
  assert.equal(humaniseFilename('5CKzjBILHJWvOhy44mWZR.jpg'), '5CKzjBILHJWvOhy44mWZR', 'random ids are left alone')
})

test('pptx: metadata title and slide text in order', async () => {
  const out = await extractPptx(await fakePptx({ title: 'Deck &amp; Title', slides: ['One', 'Two', 'Three'] }))
  assert.equal(out.metadataTitle, 'Deck & Title')
  assert.match(out.text, /\[Slide 1\]\nOne[\s\S]*\[Slide 3\]\nThree/)
})

test('pdf: /Title (incl. UTF-16) and Flate-compressed text', () => {
  const content = deflateSync(Buffer.from('BT /F1 12 Tf (Water Loss Analytics) Tj ET BT [(Dash)-200(board)] TJ ET'))
  const utf16 = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('Ünïcode', 'utf16le').swap16()]).toString('hex')
  const pdf = Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj << /Title <${utf16}> >> endobj\n2 0 obj << /Length ${content.length} /Filter /FlateDecode >>\nstream\n`),
    content,
    Buffer.from('\nendstream\nendobj\n'),
  ])
  const out = extractPdf(pdf)
  assert.equal(out.metadataTitle, 'Ünïcode')
  assert.match(out.text, /Water Loss Analytics/)
  assert.match(out.text, /Dashboard/)
})

test('html: title and visible text, scripts dropped', () => {
  const out = extractHtml(Buffer.from('<title>A &amp; B</title><script>x()</script><h1>Head</h1><p>Body</p>'))
  assert.equal(out.metadataTitle, 'A & B')
  assert.equal(out.text, 'Head\nBody')
})

test('image dimensions from headers', () => {
  assert.deepEqual(imageSize(fakeJpeg(1461, 1821)), { width: 1461, height: 1821 })
  const png = Buffer.alloc(24)
  png.writeUInt32BE(0x89504e47, 0)
  png.writeUInt32BE(300, 16)
  png.writeUInt32BE(200, 20)
  assert.deepEqual(imageSize(png), { width: 300, height: 200 })
  assert.equal(imageSize(Buffer.from('nope')), null)
})

test('single flight collapses concurrent calls; pool bounds concurrency and isolates failures', async () => {
  const flight = createSingleFlight()
  let n = 0
  const work = () => new Promise((r) => setTimeout(() => r(++n), 10))
  const results = await Promise.all([flight('k', work), flight('k', work), flight('k', work)])
  assert.deepEqual(results, [1, 1, 1])

  let live = 0
  let peak = 0
  const out = await mapPool([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    live++
    peak = Math.max(peak, live)
    await new Promise((r) => setTimeout(r, 5))
    live--
    if (x === 4) throw new Error('bad file')
    return x * 2
  })
  assert.equal(peak, 3)
  assert.equal(out[3].ok, false)
  assert.equal(out[6].value, 14)
})

test('the logger redacts credential-shaped keys', () => {
  const r = redact({ accessToken: 'at-1', nested: { refresh_token: 'rt', password: 'p', ok: 1 }, authorization: 'Bearer x' })
  assert.deepEqual(r, { accessToken: '[redacted]', nested: { refresh_token: '[redacted]', password: '[redacted]', ok: 1 }, authorization: '[redacted]' })
})
