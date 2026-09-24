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
