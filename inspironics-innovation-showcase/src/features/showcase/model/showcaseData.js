/**
 * Loads public/data/showcase.json, folds in the product-enrichment keywords and
 * the locally-added items, and derives the aggregates the UI needs.
 *
 * Images are served from /images (see the `inspironics-images` plugin in
 * vite.config.js, which maps that prefix onto ./inspironics in dev and copies the
 * folder into dist/images on build).
 */
import { showcaseConfig } from '#shared/config'
import { enrichmentFor, productKeysFor, PRODUCTS } from './productEnrichment.js'
import { loadCustomItems } from './customItems.js'

// Both carry the app's mount path (see shared/config): under the Apex gateway
// this app lives at /showcase/, so a bare '/images' would point outside it.
export const BASE = showcaseConfig.imageBase
export const DATA_URL = showcaseConfig.dataUrl

export const CATEGORIES = [
  'Data & Analytics',
  'Blueprints & Schematics',
  'Command Decks',
  'Value Frameworks',
  'Systems & Architecture',
  'Intelligence Stack',
]

export const TECHS = [
  'Agentic AI',
  'Analytics',
  'Carbon / ESG',
  'Connectivity',
  'Digital Twin',
  'Edge AI',
  'IoT Sensors',
  'Machine Learning',
  'Marketplace',
  'SaaS Platform',
  'Security',
]

const joinUrl = (rel) => {
  if (!rel) return ''
  if (/^(https?:|data:|blob:|\/)/i.test(rel)) return rel
  return `${BASE}/${rel.replace(/^\/+/, '')}`
}

export const thumbUrl = (item) => item?.thumbUrl || joinUrl(item?.t)
export const fullUrl = (item) => item?.fullUrl || joinUrl(item?.full || item?.t)

/** Everything free-text search and q-routes match against. */
export function haystack(item) {
  return [
    item.title,
    item.cat,
    ...(item.tech || []),
    ...(item.components || []),
    ...(item.flow || []),
    item.objective,
    item.architecture,
    item.takeaway,
    ...(item.extraKeywords || []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()
}

function enrich(raw, flagshipSet) {
  const item = {
    ...raw,
    tech: raw.tech || [],
    components: raw.components || [],
    flow: raw.flow || [],
    bizben: raw.bizben || [],
    techben: raw.techben || [],
    esg: !!raw.esg,
    ai: !!raw.ai,
    iot: !!raw.iot,
    flagship: raw.flagship ?? flagshipSet.has(raw.f),
    extraKeywords: [...new Set([...(raw.extraKeywords || []), ...enrichmentFor(raw.f)])],
    products: productKeysFor(raw.f),
  }
  item.thumbUrl = thumbUrl(item)
  item.fullUrl = fullUrl(item)
  item._hay = haystack(item)
  return item
}

function aggregate(items) {
  const counts = new Map()
  const techSet = new Set()
  for (const it of items) {
    counts.set(it.cat, (counts.get(it.cat) || 0) + 1)
    it.tech.forEach((t) => techSet.add(t))
  }
  return {
    cats: [...counts.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    techs: [...techSet].sort(),
    totalCount: items.length,
    esgN: items.filter((i) => i.esg).length,
    aiN: items.filter((i) => i.ai).length,
    iotN: items.filter((i) => i.iot).length,
    flagshipN: items.filter((i) => i.flagship).length,
    productCounts: Object.fromEntries(
      Object.keys(PRODUCTS).map((k) => [k, items.filter((i) => i.products?.includes(k)).length])
    ),
  }
}

let cache = null

/** Fetch + enrich the dataset. Cached for the lifetime of the page. */
export async function loadShowcase({ force = false } = {}) {
  if (cache && !force) return cache
  const res = await fetch(DATA_URL)
  if (!res.ok) throw new Error(`Could not load showcase data (${res.status})`)
  const raw = await res.json()
  const flagshipSet = new Set(raw.flagship || [])
  const base = (raw.items || []).map((r) => enrich(r, flagshipSet))
  const custom = loadCustomItems().map((r) => enrich({ ...r, custom: true }, flagshipSet))
  const items = [...custom, ...base]
  cache = { items, baseItems: base, customItems: custom, ...aggregate(items), raw }
  return cache
}

/** Re-derive the dataset after localStorage custom items change. */
export function rebuildWithCustom() {
  if (!cache) return null
  const flagshipSet = new Set(cache.raw.flagship || [])
  const custom = loadCustomItems().map((r) => enrich({ ...r, custom: true }, flagshipSet))
  const items = [...custom, ...cache.baseItems]
  cache = { ...cache, items, customItems: custom, ...aggregate(items) }
  return cache
}

/** Item shown by the Daily Spotlight — rotates by day-of-year. */
export function spotlightFor(items, date = new Date()) {
  if (!items?.length) return null
  const start = Date.UTC(date.getUTCFullYear(), 0, 0)
  const day = Math.floor((Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - start) / 864e5)
  const pool = items.filter((i) => i.flagship).length >= 12 ? items.filter((i) => i.flagship) : items
  return pool[day % pool.length]
}

/** Items sharing a category or tech with `item`, nearest first. */
export function relatedTo(items, item, limit = 6) {
  if (!item) return []
  return items
    .filter((i) => i.f !== item.f)
    .map((i) => ({
      i,
      score:
        (i.cat === item.cat ? 3 : 0) +
        i.tech.filter((t) => item.tech.includes(t)).length * 2 +
        (i.products || []).filter((p) => (item.products || []).includes(p)).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.i)
}
