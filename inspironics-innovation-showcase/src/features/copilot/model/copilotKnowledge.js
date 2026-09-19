/**
 * Copilot knowledge layer.
 *
 * `getShowcaseKnowledge()` is the single "backend function" the copilot calls: it
 * returns the whole corpus — items, aggregates, ecosystem configuration and the
 * product enrichment map — so retrieval happens against one consistent snapshot.
 * When a server is introduced, only this function needs to become a fetch.
 *
 * Answers are composed locally from that corpus rather than by a language model,
 * so the panel works with no API key and never invents a plate that isn't there.
 */
import { PRODUCTS, PRODUCT_ENRICHMENT, loadShowcase } from '#features/showcase/model'
import { NODES, PRODUCT_NODES, STACK_LAYERS, ZONES, countMatches } from '#features/ecosystem/model'

export async function getShowcaseKnowledge() {
  const data = await loadShowcase()
  return {
    items: data.items,
    cats: data.cats,
    techs: data.techs,
    totalCount: data.totalCount,
    stats: { esgN: data.esgN, aiN: data.aiN, iotN: data.iotN, flagshipN: data.flagshipN },
    productCounts: data.productCounts,
    ecosystem: { zones: ZONES, products: PRODUCT_NODES, layers: STACK_LAYERS, nodes: NODES },
    enrichment: { products: PRODUCTS, map: PRODUCT_ENRICHMENT },
  }
}

const STOP = new Set([
  'the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'show', 'me', 'find', 'what', 'which', 'how', 'about', 'do', 'you', 'have', 'any',
  'give', 'list', 'all', 'that', 'this', 'it', 'can', 'please', 'plates', 'plate',
  'images', 'image', 'innovation', 'innovations',
])

const tokenise = (q) =>
  String(q || '')
    .toLowerCase()
    .replace(/[^\w\s/&-]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t))

/** Ranks items against a free-text query using the same haystack the gallery uses. */
export function searchKnowledge(items, query, limit = 6) {
  const tokens = tokenise(query)
  if (!tokens.length) return []
  return items
    .map((it) => {
      const title = it.title.toLowerCase()
      let score = 0
      for (const t of tokens) {
        if (title.includes(t)) score += 6
        if (it.cat.toLowerCase().includes(t)) score += 4
        if (it.tech.some((x) => x.toLowerCase().includes(t))) score += 4
        if ((it.extraKeywords || []).some((x) => x.includes(t))) score += 5
        if (it.components.some((x) => x.toLowerCase().includes(t))) score += 2
        if (it._hay.includes(t)) score += 1
      }
      if (it.flagship) score += 0.5
      return { it, score }
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.it)
}

export const SUGGESTIONS = [
  'What is Caleido Kombos?',
  'Show me digital twin architectures',
  'Which plates cover carbon and ESG?',
  'Explain the intelligence stack',
  'How many command decks are there?',
  'Find hospitality work',
]

const card = (it) =>
  `![${it.title}](${it.thumbUrl} "${it.f}")\n**${it.title}** — *${it.cat}*\n${it.objective || ''}\n${
    it.tech.length ? `\`${it.tech.join('` · `')}\`` : ''
  }\n[Open blueprint](${it.fullUrl})`

const list = (arr) => arr.map((x) => `- ${x}`).join('\n')

/**
 * Composes an answer from the corpus.
 * @returns {{ text: string, items: object[] }}
 */
export function answerQuestion(knowledge, query) {
  const q = String(query || '').trim()
  const lower = q.toLowerCase()
  const { items, cats, techs, totalCount, stats, productCounts } = knowledge

  // ---- product questions ------------------------------------------------
  const product = Object.values(PRODUCTS).find((p) => lower.includes(p.token) || lower.includes(p.name.toLowerCase()))
  if (product) {
    const node = PRODUCT_NODES.find((n) => n.id === product.key)
    const hits = items.filter((it) => it.products?.includes(product.key))
    return {
      text: [
        `### ${product.name}`,
        node?.blurb || '',
        '',
        `**${productCounts[product.key]}** of the ${totalCount} plates carry ${product.name} in the artwork.`,
        hits.length ? `\nHere are the closest ones:` : '',
      ].join('\n'),
      items: hits.slice(0, 4),
    }
  }

  // ---- counting questions ----------------------------------------------
  if (/\bhow many\b|\bcount\b|\btotal\b/.test(lower)) {
    const cat = cats.find((c) => lower.includes(c.name.toLowerCase().split(' ')[0]))
    if (cat) return { text: `There are **${cat.count}** plates in **${cat.name}**.`, items: items.filter((i) => i.cat === cat.name).slice(0, 3) }
    const tech = techs.find((t) => lower.includes(t.toLowerCase().split(' ')[0]))
    if (tech) {
      const n = countMatches(items, { type: 'tech', value: tech })
      return { text: `**${n}** plates are tagged **${tech}**.`, items: items.filter((i) => i.tech.includes(tech)).slice(0, 3) }
    }
    return {
      text: [
        `The showcase holds **${totalCount}** plates across **${cats.length}** categories and **${techs.length}** tech domains.`,
        '',
        list(cats.map((c) => `**${c.name}** — ${c.count}`)),
        '',
        `${stats.aiN} are AI-driven · ${stats.iotN} are IoT-enabled · ${stats.esgN} are ESG-linked.`,
      ].join('\n'),
      items: [],
    }
  }

  // ---- stack / ecosystem ------------------------------------------------
  if (/\bstack\b|\blayers?\b|\barchitecture of\b/.test(lower) && !/\btwin\b/.test(lower)) {
    return {
      text: [
        '### The Inspironics intelligence stack',
        ...STACK_LAYERS.map(
          (l) => `**${l.name}** — ${l.blurb} *(${countMatches(items, l.route)} plates)*`
        ),
      ].join('\n\n'),
      items: [],
    }
  }

  if (/\bzones?\b|\bindustr(y|ies)\b|\bsectors?\b|\bverticals?\b/.test(lower)) {
    return {
      text: ['### Zones in the ecosystem', list(ZONES.map((z) => `**${z.name}** — ${countMatches(items, z.route)} plates`))].join('\n\n'),
      items: [],
    }
  }

  if (/^(hi|hello|hey|yo)\b/.test(lower) || lower.length < 3) {
    return {
      text: [
        `I have all **${totalCount}** plates indexed — titles, objectives, architectures, components and the product names baked into the artwork.`,
        '',
        'Ask about a product, a technology, a category, or just describe what you are trying to build.',
      ].join('\n'),
      items: [],
    }
  }

  // ---- general retrieval -------------------------------------------------
  const hits = searchKnowledge(items, q, 5)
  if (!hits.length) {
    return {
      text: [
        `Nothing in the corpus matches “${q}”.`,
        '',
        `Try a tech domain (${techs.slice(0, 4).join(', ')}…), a category (${cats[0].name}…), or a product name (${Object.values(
          PRODUCTS
        )
          .map((p) => p.name)
          .join(', ')}).`,
      ].join('\n'),
      items: [],
    }
  }

  const catTally = hits.reduce((m, h) => ({ ...m, [h.cat]: (m[h.cat] || 0) + 1 }), {})
  const topCat = Object.entries(catTally).sort((a, b) => b[1] - a[1])[0][0]

  return {
    text: [
      `Found **${hits.length}** strong matches for “${q}” — mostly **${topCat}**.`,
      '',
      hits[0].objective ? `> ${hits[0].objective}` : '',
    ]
      .filter(Boolean)
      .join('\n'),
    items: hits,
  }
}

export const renderCards = (items) => items.map(card).join('\n\n---\n\n')

/* ------------------------------------------------------- CopilotNote ------ */

/**
 * CopilotNote store.
 *
 * Mirrors the row-level-security rule the server enforces: a note is readable and
 * writable by its owner, and by an admin. Rows are scoped by `ownerId` here so the
 * same predicate holds once this moves behind an API.
 */
const NOTES_KEY = 'inspironics.copilot.notes.v1'

const readNotes = () => {
  try {
    const v = JSON.parse(localStorage.getItem(NOTES_KEY) || '[]')
    return Array.isArray(v) ? v.filter((note) => note && typeof note === 'object') : []
  } catch {
    return []
  }
}

const canAccess = (note, user) => !!user && (note.ownerId === user.id || user.role === 'admin')

export const CopilotNote = {
  /** Notes visible to `user` — their own, or everything when they are an admin. */
  list(user, sessionId) {
    return readNotes()
      .filter((n) => canAccess(n, user))
      .filter((n) => !sessionId || n.sessionId === sessionId)
      .sort((a, b) => a.createdAt - b.createdAt)
  },

  create(user, { sessionId, role, text, itemIds = [] }) {
    if (!user) throw new Error('A session is required to persist copilot notes.')
    const note = {
      id: `note_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      ownerId: user.id,
      sessionId,
      role,
      text,
      itemIds,
      createdAt: Date.now(),
    }
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify([...readNotes(), note].slice(-400)))
    } catch {
      /* storage full or unavailable — the transcript still lives in component state */
    }
    return note
  },

  clearSession(user, sessionId) {
    const kept = readNotes().filter((n) => !(canAccess(n, user) && n.sessionId === sessionId))
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(kept))
    } catch {
      /* ignore */
    }
  },
}
