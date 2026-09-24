/**
 * Loads the corpus, folds in the product-enrichment keywords and the
 * locally-added items, and derives the aggregates the UI needs.
 *
 * Where the corpus comes from depends on the backend (`env.backend`):
 *
 *   api    GET /api/entities/plates — the Dropbox-synced catalog. Records carry
 *          same-origin URLs for thumbnails, previews and originals; the API
 *          proxies the bytes. The last good copy is kept in IndexedDB, so the
 *          gallery still opens offline.
 *   local  public/data/showcase.json, with images served from /images (the
 *          `inspironics-images` plugin in vite.config.js).
 */
import { CATEGORY_NAMES, TECHS } from '@inspironics/shared'
import { env, showcaseConfig } from '#shared/config'
import { apiRequest, apiUrl } from '#shared/lib/apiClient.js'
import { idbGet, idbPut } from '#shared/lib/idb.js'
import { enrichmentFor, productKeysFor, PRODUCTS } from './productEnrichment.js'
import { loadCustomItems } from './customItems.js'

// Both carry the app's mount path (see shared/config): under the Apex gateway
// this app lives at /showcase/, so a bare '/images' would point outside it.
export const BASE = showcaseConfig.imageBase
export const DATA_URL = showcaseConfig.dataUrl

/**
 * The API describes a plate's bytes as paths on itself ('/api/dropbox/…').
 * Those need the same prefix as every API call — under Apex the API is reached
 * at /showcase/api — or the <img>, the viewer iframe and downloads all miss it.
 * A no-op when the API base is '/'.
 */
const onApi = (u) => (typeof u === 'string' && u.startsWith('/api/') ? apiUrl(u) : u)

/**
 * The taxonomy is a contract with the API's classifier, so it comes from the
 * shared package both sides import rather than being restated here.
 */
export const CATEGORIES = CATEGORY_NAMES
export { TECHS }

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
  item.thumbUrl = onApi(thumbUrl(item))
  item.fullUrl = onApi(fullUrl(item))
  if (item.contentUrl) item.contentUrl = onApi(item.contentUrl)
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

const SNAPSHOT_KEY = 'catalog'

/**
 * The raw corpus from whichever backend is configured.
 * @returns {Promise<{ items: object[], flagship?: string[], offline?: boolean, savedAt?: string }>}
 */
async function fetchCorpus() {
  if (env.backend === 'local') {
    const res = await fetch(DATA_URL)
    if (!res.ok) throw new Error(`Could not load showcase data (${res.status})`)
    return res.json()
  }
  try {
    const raw = await apiRequest('/api/entities/plates')
    idbPut('meta', SNAPSHOT_KEY, { ...raw, savedAt: new Date().toISOString() })
    return raw
  } catch (error) {
    if (error.status !== 0) throw error
    const snapshot = await idbGet('meta', SNAPSHOT_KEY)
    if (!snapshot) throw error
    return { ...snapshot, offline: true }
  }
}

/** Fetch + enrich the dataset. Cached for the lifetime of the page. */
export async function loadShowcase({ force = false } = {}) {
  if (cache && !force) return cache
  const raw = await fetchCorpus()
  const flagshipSet = new Set(raw.flagship || [])
  const base = (raw.items || []).map((r) => enrich(r, flagshipSet))
  const custom = loadCustomItems().map((r) => enrich({ ...r, custom: true }, flagshipSet))
  const items = [...custom, ...base]
  cache = { items, baseItems: base, customItems: custom, ...aggregate(items), raw, offline: !!raw.offline, savedAt: raw.savedAt }
  return cache
}

/**
 * Record a view / download / favourite for the dashboard. Fire-and-forget,
 * API backend only, and only for synced plates (custom ones have no server id).
 * @param {{ id?: string, custom?: boolean }} item
 * @param {'view'|'download'|'favourite'|'offline'} kind
 */
export function trackPlateEvent(item, kind) {
  if (env.backend !== 'api' || !item?.id || item.custom) return
  apiRequest(`/api/entities/plates/${encodeURIComponent(item.id)}/events`, { method: 'POST', body: { kind } }).catch(() => {})
}

/** URL that downloads the original file (API) or the full image (demo). */
export const downloadUrl = (item) => (item?.contentUrl ? `${item.contentUrl}${item.contentUrl.includes('?') ? '&' : '?'}download=1` : fullUrl(item))

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
