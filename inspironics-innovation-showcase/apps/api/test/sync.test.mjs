/**
 * The sync pipeline end to end against the fake Dropbox.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHarness, fakeJpeg, fakePptx } from './fakes.mjs'

const SEEDS = {
  size: 1,
  match: (name) =>
    name.toLowerCase().startsWith('img_0557.')
      ? { title: 'Operating System for Sustainable Infrastructure', meta: { cat: 'Systems & Architecture', tech: ['Digital Twin'], esg: true, w: 1461, h: 1821 } }
      : null,
}

async function setup(opts = {}) {
  const h = await createHarness({ seeds: SEEDS, ...opts })
  const admin = await h.signIn('admin@inspironics.test', 'admin')
  await h.connectDropbox(admin.user.id)
  h.dropbox.put('/Showcase/IMG_0557.JPG', fakeJpeg(1461, 1821))
  h.dropbox.put('/Showcase/decks/Grid Ops Review.pptx', await fakePptx({ title: 'Grid Operations Quarterly Review', slides: ['Grid Operations', 'Outcomes'] }))
  h.dropbox.put('/Showcase/scan.pdf', Buffer.from('%PDF-1.4\n1 0 obj << /Title (Carbon Ledger Playbook) >> endobj\n'), { thumbable: false })
  h.dropbox.put('/Showcase/notes.txt', 'not indexed')
  h.dropbox.put('/Elsewhere/outside.jpg', fakeJpeg(10, 10))
  return { h, admin }
}

test('first sync indexes supported files under the root, titled and classified', async () => {
  const { h } = await setup()
  try {
    const run = await h.syncAndWait()
    assert.equal(run.status, 'success')
    assert.equal(run.discovered, 3, 'txt and files outside the root are ignored')
    assert.equal(run.added, 3)

    const plates = new Map((await h.services.repos.files.listActive()).map((r) => [r.name, r]))
    const seed = plates.get('IMG_0557.JPG')
    assert.equal(seed.title, 'Operating System for Sustainable Infrastructure')
    assert.equal(seed.title_source, 'seed')
    assert.equal(seed.classification_status, 'seed')
    assert.equal(seed.width, 1461)

    const deck = plates.get('Grid Ops Review.pptx')
    assert.equal(deck.title, 'Grid Operations Quarterly Review')
    assert.equal(deck.title_source, 'metadata')
    assert.equal(deck.classification_status, 'unclassified', 'AI is off')

    const pdf = plates.get('scan.pdf')
    assert.equal(pdf.title, 'Carbon Ledger Playbook')
    assert.match(pdf.warnings, /No thumbnail: unsupported_image/, 'a thumbnail failure is a warning, not a failure')
    assert.ok(run.warnings.some((w) => w.file === '/Showcase/scan.pdf'))
  } finally {
    await h.close()
  }
})

test('second sync skips unchanged files, reprocesses changed ones, archives vanished ones', async () => {
  const { h } = await setup()
  try {
    await h.syncAndWait()
    const thumbsBefore = h.dropbox.state.thumbnailCalls
    h.dropbox.put('/Showcase/decks/Grid Ops Review.pptx', await fakePptx({ title: 'Grid Operations Review v2', slides: ['x'] }))
    h.dropbox.remove('/Showcase/scan.pdf')

    const run = await h.syncAndWait()
    assert.equal(run.status, 'success')
    assert.deepEqual([run.unchanged, run.updated, run.added, run.archived], [1, 1, 0, 1])
    assert.equal(h.dropbox.state.thumbnailCalls - thumbsBefore, 1, 'only the changed file is re-rendered')

    const counts = await h.services.repos.files.counts()
    assert.deepEqual(counts, { active: 2, archived: 1 })

    // it comes back: reactivated, not duplicated
    h.dropbox.put('/Showcase/scan.pdf', Buffer.from('%PDF-1.4'), { thumbable: false })
    const again = await h.syncAndWait()
    assert.equal(again.archived, 0)
    assert.equal((await h.services.repos.files.counts()).active, 3)
  } finally {
    await h.close()
  }
})

test('a discovery failure archives nothing', async () => {
  const { h } = await setup()
  try {
    await h.syncAndWait()
    await h.services.repos.settings.set('dropbox.rootPath', '/Missing')
    const run = await h.syncAndWait()
    assert.equal(run.status, 'failed')
    assert.match(run.errors[0].message, /does not exist/)
    assert.equal((await h.services.repos.files.counts()).active, 3, 'library untouched')
  } finally {
    await h.close()
  }
})

test('an empty listing of the folder the library came from archives nothing', async () => {
  const { h } = await setup()
  try {
    await h.syncAndWait()
    for (const p of ['/Showcase/IMG_0557.JPG', '/Showcase/decks/Grid Ops Review.pptx', '/Showcase/scan.pdf']) h.dropbox.remove(p)
    // the folder still exists (notes.txt) but lists no supported file
    const run = await h.syncAndWait()
    assert.equal(run.status, 'failed', 'flagged for attention')
    assert.equal(run.archived, 0)
    assert.match(run.errors[0].message, /nothing was archived/)
    assert.equal((await h.services.repos.files.counts()).active, 3, 'library untouched')

    // re-pointing the sync at another (empty) folder is deliberate: that does archive
    h.dropbox.put('/Fresh/readme.txt', 'nothing supported here')
    await h.services.repos.settings.set('dropbox.rootPath', '/Fresh')
    const moved = await h.syncAndWait()
    assert.equal(moved.status, 'success')
    assert.equal(moved.archived, 3)
  } finally {
    await h.close()
  }
})

test('only one sync runs at a time', async () => {
  const { h } = await setup()
  try {
    const first = await h.services.sync.start({ trigger: 'manual' })
    await assert.rejects(h.services.sync.start({ trigger: 'manual' }), /already running/)
    await first.done
    const second = await h.services.sync.start({ trigger: 'manual' })
    await second.done
  } finally {
    await h.close()
  }
})

test('narrowing the sync folder archives everything outside it', async () => {
  const { h } = await setup()
  try {
    await h.syncAndWait()
    await h.services.repos.settings.set('dropbox.rootPath', '/Showcase/decks')
    const run = await h.syncAndWait()
    assert.equal(run.archived, 2)
    assert.equal((await h.services.repos.files.counts()).active, 1)
  } finally {
    await h.close()
  }
})

test('AI classification runs when enabled, and a declined file is retried next sync', async () => {
  let calls = 0
  let decline = true
  const enricher = {
    enabled: true,
    async enrich({ filename, image }) {
      calls++
      assert.ok(image?.length || filename.endsWith('.pdf'), 'the thumbnail is the vision input')
      if (filename === 'scan.pdf' && decline) return null
      return { title: 'Grid Ledger', confidence: 0.8, meta: { cat: 'Data & Analytics', tech: ['Analytics'], esg: false, ai: true, iot: false } }
    },
  }
  const { h } = await setup({ enricher })
  try {
    const run = await h.syncAndWait()
    assert.equal(calls, 2, 'the seeded plate costs no model call')
    const rows = new Map((await h.services.repos.files.listActive()).map((r) => [r.name, r]))
    assert.equal(rows.get('Grid Ops Review.pptx').classification_status, 'classified')
    assert.equal(rows.get('Grid Ops Review.pptx').title_source, 'metadata', 'embedded title beats the model')
    assert.equal(rows.get('scan.pdf').classification_status, 'failed')
    assert.equal(run.status, 'success')

    decline = false
    const again = await h.syncAndWait()
    assert.equal(again.updated, 1, 'only the failed file is retried')
    assert.equal(calls, 3)
  } finally {
    await h.close()
  }
})

test('files first synced since the Claude Skills start are filed under Claude Skill Up Tools; seeds keep theirs', async () => {
  const { h } = await setup({ env: { CLAUDE_SKILLS_SINCE: '2020-01-01T00:00:00Z' } })
  try {
    await h.syncAndWait()
    const plates = new Map((await h.services.repos.files.listActive()).map((r) => [r.name, r]))

    const deck = plates.get('Grid Ops Review.pptx')
    assert.equal(deck.classification_status, 'classified')
    const meta = JSON.parse(deck.meta)
    assert.equal(meta.cat, 'Claude Skill Up Tools')
    assert.equal(meta.ai, true)
    assert.deepEqual(meta.tech, ['Agentic AI'])

    assert.equal(JSON.parse(plates.get('IMG_0557.JPG').meta).cat, 'Systems & Architecture', 'a curated seed is not claimed')
  } finally {
    await h.close()
  }
})

test('a file indexed as unclassified is filed under Claude Skill Up Tools by the next sync once it qualifies', async () => {
  const { h } = await setup()
  try {
    await h.syncAndWait()
    h.services.config.sync.claudeSkillsSince = '2020-01-01T00:00:00.000Z'
    const run = await h.syncAndWait()
    assert.equal(run.updated, 2, 'the deck and the pdf, both unclassified')
    const deck = (await h.services.repos.files.listActive()).find((r) => r.name === 'Grid Ops Review.pptx')
    assert.equal(JSON.parse(deck.meta).cat, 'Claude Skill Up Tools')
  } finally {
    await h.close()
  }
})

test('with AI on, images are read at the vision size, and collection plates filed while AI was off are enriched', async () => {
  const sizes = []
  const seen = []
  const ai = { on: false }
  const enricher = {
    get enabled() {
      return ai.on
    },
    async enrich({ filename, image }) {
      seen.push({ filename, bytes: image?.length || 0 })
      return { title: '', confidence: 0.9, meta: { cat: 'Data & Analytics', tech: ['Analytics'], objective: 'Read from the artwork.' } }
    },
  }
  const { h } = await setup({ enricher, env: { CLAUDE_SKILLS_SINCE: '2020-01-01T00:00:00Z' }, fake: { thumbnail: (f, size) => (sizes.push(size), fakeJpeg(10, 10)) } })
  try {
    h.dropbox.put('/Showcase/Context7 Infographic.png', fakeJpeg(1536, 1024))
    await h.syncAndWait()
    let row = (await h.services.repos.files.listActive()).find((r) => r.name === 'Context7 Infographic.png')
    assert.equal(JSON.parse(row.meta).cat, 'Claude Skill Up Tools', 'filed by the rule while AI is off')
    assert.equal(JSON.parse(row.meta).objective, undefined)
    assert.ok(!sizes.includes('w2048h1536'), 'no large render without AI')

    ai.on = true
    await h.syncAndWait()
    row = (await h.services.repos.files.listActive()).find((r) => r.name === 'Context7 Infographic.png')
    const meta = JSON.parse(row.meta)
    assert.equal(meta.objective, 'Read from the artwork.', 'content extracted once AI is on')
    assert.equal(meta.cat, 'Claude Skill Up Tools', 'the collection still outranks the model category')
    assert.ok(meta.tech.includes('Analytics') && meta.tech.includes('Agentic AI'), 'model tags kept, collection tag added')
    assert.ok(sizes.includes('w2048h1536'), 'the image was read at the vision size')
    assert.ok(seen.some((s) => s.filename === 'Context7 Infographic.png'))

    const calls = seen.length
    await h.syncAndWait()
    assert.equal(seen.length, calls, 'an enriched plate is not re-read')
  } finally {
    await h.close()
  }
})

test('a flipped plate with an empty back is described on demand, once; curated plates are left alone', async () => {
  const calls = []
  const ai = { on: false }
  const enricher = {
    get enabled() {
      return ai.on
    },
    async enrich({ filename, image }) {
      calls.push({ filename, bytes: image?.length || 0 })
      await new Promise((r) => setTimeout(r, 20))
      return { title: 'Context Engineering Playbook', confidence: 0.8, meta: { tech: ['Analytics'], objective: 'Written on flip.', components: ['Retriever'] } }
    },
  }
  const { h, admin } = await setup({ enricher, env: { CLAUDE_SKILLS_SINCE: '2020-01-01T00:00:00Z' } })
  try {
    h.dropbox.put('/Showcase/IMG_9001.png', fakeJpeg(1536, 1024))
    await h.syncAndWait()
    const rows = new Map((await h.services.repos.files.listActive()).map((r) => [r.name, r]))
    const fresh = rows.get('IMG_9001.png')
    const seed = rows.get('IMG_0557.JPG')

    const off = await admin.json('POST', `/api/entities/plates/${fresh.id}/describe`)
    assert.equal(off.status, 503)
    assert.equal(off.body.error.code, 'AI_DISABLED')

    ai.on = true
    const [a, b] = await Promise.all([
      admin.json('POST', `/api/entities/plates/${fresh.id}/describe`),
      admin.json('POST', `/api/entities/plates/${fresh.id}/describe`),
    ])
    assert.equal(a.status, 200)
    assert.equal(calls.length, 1, 'concurrent flips share one model call')
    assert.equal(a.body.plate.objective, 'Written on flip.')
    assert.deepEqual(b.body.plate.components, ['Retriever'])
    assert.equal(a.body.plate.cat, 'Claude Skill Up Tools', 'the collection keeps its category')
    assert.equal(a.body.plate.title, 'Context Engineering Playbook', 'a filename title gives way to the read one')
    assert.equal(a.body.plate.classification, 'classified')

    await admin.json('POST', `/api/entities/plates/${fresh.id}/describe`)
    assert.equal(calls.length, 1, 'a described plate is not read again')

    const curated = await admin.json('POST', `/api/entities/plates/${seed.id}/describe`)
    assert.equal(curated.status, 200)
    assert.equal(curated.body.plate.title, 'Operating System for Sustainable Infrastructure')
    assert.equal(calls.length, 1, 'seed plates never reach the model')

    await h.syncAndWait()
    // the deck and pdf, filed while AI was off, are now enriched by the sync; the described plate is not
    assert.equal(calls.filter((c) => c.filename === 'IMG_9001.png').length, 1, 'the next sync does not re-read it either')
  } finally {
    await h.close()
  }
})
