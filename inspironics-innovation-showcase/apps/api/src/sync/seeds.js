/**
 * The curated corpus as a classification overlay.
 *
 * The original showcase shipped 235 plates with hand-written metadata
 * (category, stack, objective, flow, benefits…). When a synced file is one of
 * them, that metadata is used as-is — it is better than anything a model would
 * produce, and it costs nothing.
 *
 * "Is one of them" is deliberately strict, because a false match pins someone
 * else's curated story on an unrelated file:
 *   - the whole filename must match, extension included (case-insensitive), so
 *     IMG_0557.JPG matches IMG_0557.jpg but IMG_0557.png does not;
 *   - a camera-style name (IMG_0600, DSC_1234, PXL_…) is not evidence on its
 *     own — every phone produces one — so it must also have the seed's shape:
 *     the synced image's aspect ratio (from its thumbnail) within 2% of the
 *     seed's recorded width/height. No dimensions, no match.
 * The corpus's random-id names (5CKzjBILHJWvOhy44mWZR.jpg) are distinctive
 * enough to match by name alone.
 */
import { existsSync, readFileSync } from 'node:fs'

const nameKey = (name) => String(name || '').trim().toLowerCase()
const stem = (name) => nameKey(name).replace(/\.[a-z0-9]+$/, '')

/** Names cameras, phones and screenshot tools generate: a common prefix and a counter or timestamp. */
export const isGenericName = (name) =>
  /^(img|dsc|dscn|dscf|dcim|pxl|mvimg|photo|image|pic|picture|screenshot|screen shot|scan|untitled)[ _-]?[\d_ -]*\d[\d_ -]*$/i.test(stem(name)) ||
  /^\d[\d_ -]*$/.test(stem(name))

const ASPECT_TOLERANCE = 0.02

const sameShape = (seed, dims) => {
  if (!seed.w || !seed.h || !dims?.width || !dims?.height) return false
  const a = seed.w / seed.h
  const b = dims.width / dims.height
  return Math.abs(a - b) / a <= ASPECT_TOLERANCE
}

const SEED_FIELDS = ['cat', 'tag', 'tech', 'esg', 'ai', 'iot', 'objective', 'flow', 'components', 'architecture', 'bizben', 'techben', 'takeaway']

export function loadSeeds(file, log) {
  if (!file || !existsSync(file)) {
    log?.info('No seed corpus found; every file will be titled and classified from its content', { file })
    return { size: 0, match: () => null }
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const flagship = new Set(raw.flagship || [])
  const byName = new Map()
  for (const item of raw.items || []) {
    const meta = Object.fromEntries(SEED_FIELDS.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]))
    meta.flagship = flagship.has(item.f)
    if (item.w && item.h) Object.assign(meta, { w: item.w, h: item.h })
    byName.set(nameKey(item.f), { title: item.title, meta, w: item.w, h: item.h })
  }
  log?.info('Loaded seed corpus', { plates: byName.size })
  return {
    size: byName.size,
    /**
     * @param {string} filename
     * @param {{ width: number, height: number } | null} [dims]  the synced image's dimensions, if known
     * @returns {{ title: string, meta: object } | null}
     */
    match(filename, dims) {
      const seed = byName.get(nameKey(filename))
      if (!seed) return null
      if (isGenericName(filename) && !sameShape(seed, dims)) return null
      return { title: seed.title, meta: seed.meta }
    },
  }
}
