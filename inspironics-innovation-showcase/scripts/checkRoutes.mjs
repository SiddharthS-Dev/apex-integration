/**
 * Asserts that every clickable node in the Ecosystem Explorer routes to a
 * non-empty gallery. A node that filters down to nothing is a dead end, so this
 * runs in CI alongside the build.
 *
 *   node scripts/checkRoutes.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const data = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/showcase.json'), 'utf8'))

const { NODES, countMatches } = await import(pathToFileURL(path.join(ROOT, 'src/features/ecosystem/model/ecosystemData.js')))
const { enrichmentFor } = await import(pathToFileURL(path.join(ROOT, 'src/features/showcase/model/productEnrichment.js')))

// Mirror showcaseData.haystack so the check sees exactly what the gallery sees.
const items = data.items.map((it) => ({
  ...it,
  _hay: [
    it.title,
    it.cat,
    ...(it.tech || []),
    ...(it.components || []),
    ...(it.flow || []),
    it.objective,
    it.architecture,
    it.takeaway,
    ...enrichmentFor(it.f),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase(),
}))

const MIN = 1
let failed = 0

for (const node of NODES) {
  const n = countMatches(items, node.route)
  const label = `${node.category} · ${node.name}`.padEnd(34)
  const route = `${node.route.type}:${node.route.value || '*'}`.padEnd(26)
  if (n < MIN) {
    console.log(`  DEAD  ${label} ${route} -> ${n}`)
    failed++
  } else {
    console.log(`  ok    ${label} ${route} -> ${n}`)
  }
}

if (failed) {
  console.error(`\n${failed} node(s) route to an empty gallery.`)
  process.exit(1)
}
console.log(`\nAll ${NODES.length} ecosystem routes resolve.`)
