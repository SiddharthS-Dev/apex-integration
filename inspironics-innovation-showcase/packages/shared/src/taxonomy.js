/**
 * The classification vocabulary — what a plate can be filed under.
 *
 * The web client filters and aggregates by these names, and the API's
 * classifier is only allowed to answer with them, so a model can never invent
 * a category the gallery has no pill for. Adding a value here is a contract
 * change for both sides.
 */

/** Primary domain. `tag` is the short key the gallery's filter pills use. */
export const CATEGORIES = [
  { name: 'Data & Analytics', tag: 'analytics' },
  { name: 'Blueprints & Schematics', tag: 'blueprint' },
  { name: 'Command Decks', tag: 'command' },
  { name: 'Value Frameworks', tag: 'value' },
  { name: 'Systems & Architecture', tag: 'systems' },
  { name: 'Intelligence Stack', tag: 'stack' },
]

export const CATEGORY_NAMES = CATEGORIES.map((c) => c.name)

/** Filed here until something better is known. The gallery shows it as its own pill. */
export const UNCLASSIFIED = 'Unclassified'

/** Category name -> tag, falling back to a slug for anything off-list. */
export function tagForCategory(name) {
  const hit = CATEGORIES.find((c) => c.name === name)
  if (hit) return hit.tag
  return String(name || UNCLASSIFIED)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Technology sub-domains. A plate carries any number. */
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

/** Products named inside the artwork. Keys match the web enrichment map. */
export const PRODUCTS = [
  { key: 'xenia', name: 'Caleido Xenia' },
  { key: 'domi', name: 'Caleido Domi' },
  { key: 'kombos', name: 'Caleido Kombos' },
  { key: 'cielo', name: 'Cielo Epic' },
  { key: 'mints', name: 'Caleido Mints' },
]

/** Boolean facets the dashboard counts. */
export const FLAGS = ['esg', 'ai', 'iot']
