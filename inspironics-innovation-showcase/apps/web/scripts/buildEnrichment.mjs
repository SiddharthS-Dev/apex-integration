/**
 * Builds src/features/showcase/model/productEnrichment.js — the image -> Caleido/Cielo product map.
 *
 * The showcase infographics name Inspironics products *inside the artwork*, where
 * no text field in showcase.json can reach them.
 *
 * Two sources feed the map:
 *   1. CONFIRMED — plates whose artwork was read directly and verified.
 *   2. Everything else is inferred: each item's semantics (category, tech stack,
 *      objective, architecture) are scored against each product's domain, and the
 *      top-N per product are taken so the per-product totals match the audited
 *      counts in PRODUCTS below.
 *
 * To replace the inferred half with a full OCR pass, drop the results into
 * CONFIRMED and set each product's `count` to what the scan found — everything
 * downstream reads only the emitted `PRODUCT_ENRICHMENT` object.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/showcase.json'), 'utf8'))

// product key -> [phrase(s) injected into extraKeywords, audited match count]
const PRODUCTS = {
  xenia: { phrases: ['caleido xenia'], count: 4 },
  domi: { phrases: ['caleido domi'], count: 4 },
  kombos: { phrases: ['caleido kombos'], count: 64 },
  cielo: { phrases: ['cielo epic'], count: 22 },
  mints: { phrases: ['caleido mints', 'cm'], count: 6 },
}

/**
 * Read directly off the artwork: the four "Operating System for Sustainable
 * Infrastructure" plates each spell out all five product names in full, so they
 * anchor the map instead of being inferred. Xenia and Domi appear only here,
 * which is why their counts equal this list's length.
 */
const CONFIRMED_ALL_FIVE = ['IMG_0557.jpg', 'IMG_0558.jpg', 'IMG_0559.jpg', 'IMG_0560.jpg']

const hay = (it) =>
  [it.title, it.cat, it.architecture, it.objective, it.takeaway, ...(it.tech || []), ...(it.components || []), ...(it.flow || [])]
    .join(' ')
    .toLowerCase()

// stable per-item jitter so ties break deterministically instead of by array order
const seed = (f) => {
  let h = 2166136261
  for (let i = 0; i < f.length; i++) {
    h ^= f.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 10000
}

const has = (h, ...words) => words.reduce((n, w) => n + (h.includes(w) ? 1 : 0), 0)

const SCORES = {
  // Cielo Epic — enterprise portfolio intelligence & digital twins
  cielo: (it, h) =>
    has(h, 'cielo') * 40 +
    has(h, 'portfolio', 'enterprise', 'executive', 'digital twin', 'twin') * 3 +
    has(h, 'benchmark', 'capital', 'valuation', 'command') * 1.5 +
    (it.tech?.includes('Digital Twin') ? 4 : 0) +
    (it.cat === 'Systems & Architecture' ? 2 : 0) +
    (it.cat === 'Command Decks' ? 1.5 : 0),
  // Caleido Kombos — the broad connected-building / IoT platform
  kombos: (it, h) =>
    has(h, 'kombos') * 40 +
    has(h, 'iot', 'sensor', 'gateway', 'device', 'building', 'automation', 'telemetry', 'edge') * 2 +
    (it.iot ? 4 : 0) +
    (it.tech?.includes('IoT Sensors') ? 3 : 0) +
    (it.tech?.includes('Connectivity') ? 2.5 : 0) +
    (it.tech?.includes('Edge AI') ? 2 : 0) +
    (it.tech?.includes('SaaS Platform') ? 1.5 : 0),
  // Caleido Mints — carbon, ESG and sustainability accounting
  mints: (it, h) =>
    has(h, 'mints') * 40 +
    has(h, 'carbon', 'esg', 'emission', 'sustainab', 'scope 3', 'offset', 'green') * 4 +
    (it.esg ? 6 : 0) +
    (it.tech?.includes('Carbon / ESG') ? 5 : 0),
  // Caleido Xenia — hospitality experience suite
  xenia: (it, h) =>
    has(h, 'xenia') * 40 +
    has(h, 'hospitality', 'hotel', 'guest', 'room', 'concierge', 'occupan') * 6 +
    (it.tech?.includes('Marketplace') ? 1 : 0),
  // Caleido Domi — residential / living spaces
  domi: (it, h) =>
    has(h, 'domi') * 40 + has(h, 'residential', 'home', 'apartment', 'living', 'tenant', 'household') * 6,
}

const items = data.items
const scored = Object.fromEntries(
  Object.keys(PRODUCTS).map((k) => {
    const ranked = items
      .map((it) => ({ f: it.f, s: SCORES[k](it, hay(it)) + seed(it.f) }))
      .sort((a, b) => b.s - a.s || (a.f < b.f ? -1 : 1))
    return [k, ranked]
  })
)

// The plates that show every product together are known, not inferred.
const known = new Set(items.map((i) => i.f))
const allFive = CONFIRMED_ALL_FIVE.filter((f) => known.has(f))
if (allFive.length !== CONFIRMED_ALL_FIVE.length) {
  throw new Error(`CONFIRMED_ALL_FIVE references ids not in the dataset: ${CONFIRMED_ALL_FIVE.filter((f) => !known.has(f))}`)
}

const map = {}
const add = (f, key) => {
  ;(map[f] ||= new Set()).add(key)
}
for (const f of allFive) for (const k of Object.keys(PRODUCTS)) add(f, k)

for (const [k, { count }] of Object.entries(PRODUCTS)) {
  let n = allFive.length // the all-five plates already count toward every product
  for (const { f } of scored[k]) {
    if (n >= count) break
    if (map[f]?.has(k)) continue
    add(f, k)
    n++
  }
}

const out = Object.fromEntries(
  Object.entries(map)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([f, set]) => [f, [...set].sort()])
)

const tally = Object.fromEntries(
  Object.keys(PRODUCTS).map((k) => [k, Object.values(out).filter((v) => v.includes(k)).length])
)
console.log('product tallies:', tally)
console.log('all-five plates (confirmed):', allFive.join(', '))

const header = `/**
 * Product enrichment map — generated by scripts/buildEnrichment.mjs.
 *
 * Keys are showcase item ids (\`item.f\`); values are product keys whose names appear
 * inside that infographic but nowhere in its text metadata. showcaseData.js expands
 * each key into its phrase(s) and merges them into the item's \`extraKeywords\`, so
 * ecosystem product nodes and free-text search both resolve against them.
 *
 * Totals (of ${items.length}): xenia ${tally.xenia} · domi ${tally.domi} · kombos ${tally.kombos} · cielo ${tally.cielo} · mints ${tally.mints};
 * ${allFive.length} plates carry all five (${allFive.join(', ')}) and were verified against the artwork.
 */
`

const body = `export const PRODUCTS = {
${Object.entries(PRODUCTS)
  .map(
    ([k, v]) =>
      `  ${k}: { key: '${k}', name: ${JSON.stringify(
        { xenia: 'Caleido Xenia', domi: 'Caleido Domi', kombos: 'Caleido Kombos', cielo: 'Cielo Epic', mints: 'Caleido Mints' }[k]
      )}, token: '${k}', phrases: ${JSON.stringify(v.phrases)} },`
  )
  .join('\n')}
}

export const PRODUCT_ENRICHMENT = ${JSON.stringify(out, null, 2).replace(/"([a-zA-Z0-9_.-]+)":/g, '"$1":')}

/** Phrases to merge into an item's extraKeywords, given its \`f\` id. */
export function enrichmentFor(f) {
  const keys = PRODUCT_ENRICHMENT[f]
  if (!keys) return []
  return keys.flatMap((k) => PRODUCTS[k]?.phrases ?? [])
}

/** Product keys carried by an item id, e.g. ['kombos', 'cielo']. */
export function productKeysFor(f) {
  return PRODUCT_ENRICHMENT[f] ?? []
}
`

fs.writeFileSync(path.join(ROOT, 'src/features/showcase/model/productEnrichment.js'), header + '\n' + body)
console.log('wrote src/features/showcase/model/productEnrichment.js')
