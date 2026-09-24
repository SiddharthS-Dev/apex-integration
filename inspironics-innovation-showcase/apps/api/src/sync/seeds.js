/**
 * The curated corpus as a classification overlay.
 *
 * The original showcase shipped 235 plates with hand-written metadata
 * (category, stack, objective, flow, benefits…). When a synced file's name
 * matches one of them, that metadata is used as-is — it is better than
 * anything a model would produce, and it costs nothing. Matching is by
 * filename stem, case-insensitive, so IMG_0557.JPG and IMG_0557.png both match
 * the seed for IMG_0557.jpg.
 */
import { existsSync, readFileSync } from 'node:fs'

const stem = (name) => String(name || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').trim()

const SEED_FIELDS = ['cat', 'tag', 'tech', 'esg', 'ai', 'iot', 'objective', 'flow', 'components', 'architecture', 'bizben', 'techben', 'takeaway']

export function loadSeeds(file, log) {
  if (!file || !existsSync(file)) {
    log?.info('No seed corpus found; every file will be titled and classified from its content', { file })
    return { size: 0, match: () => null }
  }
  const raw = JSON.parse(readFileSync(file, 'utf8'))
  const flagship = new Set(raw.flagship || [])
  const byStem = new Map()
  for (const item of raw.items || []) {
    const meta = Object.fromEntries(SEED_FIELDS.filter((k) => item[k] !== undefined).map((k) => [k, item[k]]))
    meta.flagship = flagship.has(item.f)
    if (item.w && item.h) Object.assign(meta, { w: item.w, h: item.h })
    byStem.set(stem(item.f), { title: item.title, meta })
  }
  log?.info('Loaded seed corpus', { plates: byStem.size })
  return {
    size: byStem.size,
    /** @returns {{ title: string, meta: object } | null} */
    match: (filename) => byStem.get(stem(filename)) || null,
  }
}
