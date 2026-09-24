/**
 * Manual end-to-end rig: the real API on :4100 against the fake Dropbox,
 * loaded with a dozen of the real plates and a deck, already connected.
 * Pair it with `npm run dev -w @inspironics/web` and a browser.
 *
 *   node --disable-warning=ExperimentalWarning test/e2e-server.mjs
 *
 * The first account registered becomes the administrator (development rule).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSeeds } from '../src/sync/seeds.js'
import { createLogger } from '../src/lib/log.js'
import { createHarness, fakePptx } from './fakes.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const plates = path.join(here, '../../web/inspironics')
const log = createLogger({ level: 'info' })

const h = await createHarness({
  port: Number(process.env.E2E_PORT || 4100),
  logger: log,
  seeds: loadSeeds(path.join(here, '../../web/public/data/showcase.json'), log),
  // "Dropbox" renders each image as itself
  fake: { thumbnail: (f) => (/\.jpe?g$/i.test(f.name) ? f.bytes : readFileSync(path.join(plates, 'thumbs', 'IMG_0557.webp'))) },
  env: { SYNC_CONCURRENCY: '8', PUBLIC_API_URL: `http://localhost:${process.env.E2E_PORT || 4100}`, WEB_ORIGIN: process.env.E2E_WEB || 'http://localhost:5180' },
})

for (const name of readdirSync(plates).filter((n) => n.endsWith('.jpg')).slice(0, 12)) {
  h.dropbox.put(`/Showcase/${name}`, readFileSync(path.join(plates, name)))
}
h.dropbox.put('/Showcase/decks/Smart Grid Operating Model.pptx', await fakePptx({ title: 'Smart Grid Operating Model', slides: ['Smart Grid Operating Model', 'Grid telemetry to decisions'] }))

// connect as a system admin row so the web admin can run syncs straight away
const system = await h.services.repos.users.create({ email: 'system@local', name: 'System', role: 'viewer', verified: true })
await h.connectDropbox(system.id)
const run = await h.syncAndWait('startup')
log.info('E2E API ready', { plates: run.added, status: run.status })
